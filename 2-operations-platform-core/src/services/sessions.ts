import type pg from 'pg';
import { tx, DomainError } from '../db.js';
import type { Actor } from '../permissions.js';
import { loadSchedule } from './attendance.js';
import { computeDay, localIso } from '../attendance.js';
export interface Policy { logoutPolicy: 'ALWAYS' | 'LAST_SESSION'; idleMinutes: number }
async function policy(c: pg.Pool | pg.PoolClient): Promise<Policy> { const r = (await c.query("SELECT value FROM app_settings WHERE key='attendance.policy'")).rows[0]; return { logoutPolicy: 'ALWAYS', idleMinutes: 30, ...(r?.value ?? {}) }; }
/** Login: authenticates elsewhere; here we create/resume the attendance session and link it to this portal session. Host is exempt. A refresh or second tab never creates a second attendance session. */
export async function startPortalSession(pool: pg.Pool, a: { actor: Actor; tokenHash: string; userAgent?: string; now?: Date }) {
  const now = a.now ?? new Date();
  return tx(pool, async c => {
    if (a.actor.role === 'HOST' || a.actor.type !== 'EMPLOYEE') { const s = (await c.query('INSERT INTO portal_sessions (employee_id, token_hash, user_agent, created_at, last_seen_at) VALUES ($1,$2,$3,$4,$4) RETURNING id', [a.actor.id, a.tokenHash, a.userAgent ?? null, now])).rows[0]; return { sessionId: s.id as string, shiftSessionId: null as string | null, attendance: 'EXEMPT' as const, resumed: false }; }
    await c.query('SELECT 1 FROM employees WHERE id=$1 FOR UPDATE', [a.actor.id]);                       // one login at a time per employee
    const sch = await loadSchedule(c), workDate = localIso(now, sch.timezone); let resumed = false;
    let open = (await c.query("SELECT *, to_char(work_date,'YYYY-MM-DD') AS work_date_s FROM shift_sessions WHERE employee_id=$1 AND clock_out IS NULL", [a.actor.id])).rows[0];
    if (open && open.work_date_s !== workDate) {      // forgot to sign out on an earlier day: close at last known activity and FLAG it; never invent hours
      const seen = (await c.query('SELECT max(last_seen_at) AS m FROM portal_sessions WHERE shift_session_id=$1', [open.id])).rows[0].m as Date | null; let end = seen && seen > open.clock_in ? seen : new Date(open.clock_in.getTime() + 60000);
      await c.query("UPDATE shift_sessions SET clock_out=$2, missing_clock_out=true, needs_recovery=true, recovery_reason='Previous day was never signed out. End time is the last known activity; correct it if needed.', ended_by='SYSTEM_RECOVERY' WHERE id=$1", [open.id, end]);
      await c.query("UPDATE portal_sessions SET ended_at=$2, end_reason='EXPIRED' WHERE shift_session_id=$1 AND ended_at IS NULL", [open.id, now]); open = null;
    }
    if (open) { resumed = true; if (open.needs_recovery) await c.query("UPDATE shift_sessions SET needs_recovery=false, recovery_reason=NULL WHERE id=$1", [open.id]); }
    else open = (await c.query("INSERT INTO shift_sessions (employee_id, work_date, clock_in, login_at, source) VALUES ($1,$2,$3,$3,'PORTAL') RETURNING *", [a.actor.id, workDate, now])).rows[0];
    const s = (await c.query('INSERT INTO portal_sessions (employee_id, shift_session_id, token_hash, user_agent, created_at, last_seen_at) VALUES ($1,$2,$3,$4,$5,$5) RETURNING id', [a.actor.id, open.id, a.tokenHash, a.userAgent ?? null, now])).rows[0];
    return { sessionId: s.id as string, shiftSessionId: open.id as string, attendance: 'ACTIVE' as const, resumed };
  });
}
/** Called on every request / page refresh: keeps the session alive. A refresh is NOT a sign-out. */
export async function touchPortalSession(pool: pg.Pool, tokenHash: string, now = new Date()) {
  const r = (await pool.query('UPDATE portal_sessions SET last_seen_at=$2 WHERE token_hash=$1 AND ended_at IS NULL RETURNING id, shift_session_id', [tokenHash, now])).rows[0]; if (!r) throw new DomainError('SESSION_ENDED', 'Please sign in again'); return { sessionId: r.id as string, shiftSessionId: r.shift_session_id as string | null };
}
/** Intentional sign-out: ends the portal session and the attendance together; hours are computed once (lunch deducted once). Idempotent. */
export async function endPortalSession(pool: pg.Pool, a: { tokenHash: string; now?: Date }) {
  const now = a.now ?? new Date();
  return tx(pool, async c => {
    const s = (await c.query('SELECT * FROM portal_sessions WHERE token_hash=$1 FOR UPDATE', [a.tokenHash])).rows[0]; if (!s) throw new DomainError('NOT_FOUND', 'Session not found'); if (s.ended_at) return { alreadyEnded: true as const };
    await c.query("UPDATE portal_sessions SET ended_at=$2, end_reason='LOGOUT' WHERE id=$1", [s.id, now]); if (!s.shift_session_id) return { alreadyEnded: false as const, attendanceClosed: false };
    const pol = await policy(c);
    if (pol.logoutPolicy === 'LAST_SESSION' && (await c.query('SELECT 1 FROM portal_sessions WHERE shift_session_id=$1 AND ended_at IS NULL', [s.shift_session_id])).rowCount) return { alreadyEnded: false as const, attendanceClosed: false };
    const sh = (await c.query('SELECT * FROM shift_sessions WHERE id=$1 FOR UPDATE', [s.shift_session_id])).rows[0]; if (sh.clock_out) return { alreadyEnded: false as const, attendanceClosed: false };
    const out = now > sh.clock_in ? now : new Date(sh.clock_in.getTime() + 1000), sch = await loadSchedule(c), d = computeDay(sh.clock_in, out, sch);
    await c.query("UPDATE shift_sessions SET clock_out=$2, logout_at=$2, net_minutes=$3, late_minutes=$4, early_minutes=$5, ended_by='LOGOUT', needs_recovery=false WHERE id=$1", [sh.id, out, d.netMinutes, d.lateMinutes, d.earlyMinutes]);
    await c.query("UPDATE portal_sessions SET ended_at=$2, end_reason='LOGOUT' WHERE shift_session_id=$1 AND ended_at IS NULL", [sh.id, now]);
    return { alreadyEnded: false as const, attendanceClosed: true, netMinutes: d.netMinutes as number, lateMinutes: d.lateMinutes as number, earlyMinutes: d.earlyMinutes as number };
  });
}
/** Scheduler: portal sessions idle longer than the policy expire. The attendance is NOT closed with an invented time; it is flagged for recovery/correction by an authorised person. */
export async function expireIdleSessions(pool: pg.Pool, now = new Date()) {
  const pol = await policy(pool), cutoff = new Date(now.getTime() - pol.idleMinutes * 60000);
  return tx(pool, async c => {
    const r = (await c.query("UPDATE portal_sessions SET ended_at=$2, end_reason='EXPIRED' WHERE ended_at IS NULL AND last_seen_at < $1 RETURNING shift_session_id", [cutoff, now])).rows;
    const ids = [...new Set(r.map(x => x.shift_session_id).filter(Boolean))];
    for (const id of ids) if (!(await c.query('SELECT 1 FROM portal_sessions WHERE shift_session_id=$1 AND ended_at IS NULL', [id])).rowCount)
      await c.query("UPDATE shift_sessions SET needs_recovery=true, recovery_reason='The portal session expired without a sign-out. Confirm the end time.' WHERE id=$1 AND clock_out IS NULL", [id]);
    return { expired: r.length, flagged: ids.length };
  });
}
