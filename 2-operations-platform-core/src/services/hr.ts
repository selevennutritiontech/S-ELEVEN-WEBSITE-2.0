import type pg from 'pg';
import { tx, DomainError } from '../db.js';
import { Actor, assertCan, can } from '../permissions.js';
import { loadSchedule } from './attendance.js';
import { isoDate } from '../attendance.js';

export async function ensureBalances(c: pg.Pool | pg.PoolClient, employeeId: string, year: number) {
  await c.query("INSERT INTO leave_balances (employee_id, leave_type, year, entitled) SELECT $1, code, $2, yearly_days FROM leave_types WHERE NOT unlimited ON CONFLICT DO NOTHING", [employeeId, year]);
}
/** Year-end: unused days carry forward up to the policy maximum; the rest expire. Idempotent. */
export async function rolloverBalances(pool: pg.Pool, actor: Actor, employeeId: string, fromYear: number) {
  assertCan(actor, 'hr.write'); await ensureBalances(pool, employeeId, fromYear); await ensureBalances(pool, employeeId, fromYear + 1);
  await pool.query(`UPDATE leave_balances nb SET carried = LEAST(t.carry_forward_max, GREATEST(0, ob.entitled + ob.carried - ob.used)) FROM leave_balances ob JOIN leave_types t ON t.code=ob.leave_type
    WHERE nb.employee_id=$1 AND nb.year=$2 AND ob.employee_id=nb.employee_id AND ob.leave_type=nb.leave_type AND ob.year=$3`, [employeeId, fromYear + 1, fromYear]);
}
export function countLeaveDays(from: string, to: string, half: boolean, holidays: Set<string>, weeklyOff: number[]): number {
  if (half) return 0.5; let n = 0; const a = new Date(from + 'T00:00:00Z'), b = new Date(to + 'T00:00:00Z');
  for (let t = a.getTime(); t <= b.getTime(); t += 86400000) { const d = new Date(t), iso = isoDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()); if (!holidays.has(iso) && !weeklyOff.includes(d.getUTCDay())) n++; }
  return n;
}
export async function requestLeave(pool: pg.Pool, actor: Actor, a: { type: string; from: string; to: string; half?: boolean; reason?: string }) {
  if (actor.type !== 'EMPLOYEE' || actor.role === 'HOST') throw new DomainError('NOT_APPLICABLE', 'Leave requests apply to employees');
  if (a.from.slice(0, 4) !== a.to.slice(0, 4)) throw new DomainError('SPANS_YEARS', 'Please split a request that spans two years');
  return tx(pool, async c => {
    const lt = (await c.query('SELECT * FROM leave_types WHERE code=$1', [a.type])).rows[0]; if (!lt) throw new DomainError('UNKNOWN_LEAVE_TYPE', 'Unknown leave type');
    const s = await loadSchedule(c), hol = new Set((await c.query("SELECT to_char(day,'YYYY-MM-DD') AS d FROM holidays WHERE day BETWEEN $1 AND $2", [a.from, a.to])).rows.map(r => r.d as string));
    const days = countLeaveDays(a.from, a.to, !!a.half, hol, s.weeklyOff); if (days <= 0) throw new DomainError('NO_WORKING_DAYS', 'The selected dates are holidays or weekly offs');
    const year = +a.from.slice(0, 4);
    if (!lt.unlimited) {
      await ensureBalances(c, actor.id, year);
      const b = (await c.query('SELECT entitled + carried - used AS free FROM leave_balances WHERE employee_id=$1 AND leave_type=$2 AND year=$3 FOR UPDATE', [actor.id, a.type, year])).rows[0];
      const pend = (await c.query("SELECT COALESCE(SUM(days),0)::float AS p FROM leave_requests WHERE employee_id=$1 AND leave_type=$2 AND status='PENDING' AND EXTRACT(YEAR FROM from_date)=$3", [actor.id, a.type, year])).rows[0].p as number;
      if (+b.free - pend < days) throw new DomainError('INSUFFICIENT_BALANCE', `Only ${(+b.free - pend).toFixed(1)} day(s) of ${lt.name} are available`);
    }
    try { return (await c.query('INSERT INTO leave_requests (employee_id, leave_type, from_date, to_date, half_day, days, reason) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id', [actor.id, a.type, a.from, a.to, !!a.half, days, a.reason ?? null])).rows[0].id as string; }
    catch (e: any) { if (e.code === '23P01') throw new DomainError('LEAVE_OVERLAP', 'This overlaps another pending or approved leave'); throw e; }
  });
}
/** Approval is idempotent: a request can only be decided once, so a balance can never be deducted twice. */
export async function approveLeave(pool: pg.Pool, actor: Actor, id: string) {
  assertCan(actor, 'hr.write');
  return tx(pool, async c => {
    const r = (await c.query('SELECT * FROM leave_requests WHERE id=$1 FOR UPDATE', [id])).rows[0]; if (!r) throw new DomainError('NOT_FOUND', 'Request not found'); if (r.status !== 'PENDING') throw new DomainError('ALREADY_DECIDED', `Request is already ${r.status}`);
    const lt = (await c.query('SELECT unlimited FROM leave_types WHERE code=$1', [r.leave_type])).rows[0];
    if (!lt.unlimited) { const u = await c.query('UPDATE leave_balances SET used = used + $4 WHERE employee_id=$1 AND leave_type=$2 AND year=$3 AND used + $4 <= entitled + carried', [r.employee_id, r.leave_type, r.from_date.getUTCFullYear?.() ?? +String(r.from_date).slice(0, 4), r.days]); if (!u.rowCount) throw new DomainError('INSUFFICIENT_BALANCE', 'Balance is no longer sufficient'); }
    await c.query("UPDATE leave_requests SET status='APPROVED', decided_by=$2, decided_at=now() WHERE id=$1", [id, actor.id]);
    await c.query("INSERT INTO audit_logs (actor_type, actor_id, action, entity, entity_id, after) VALUES ('EMPLOYEE',$1,'LEAVE_APPROVED','leave_requests',$2,$3)", [actor.id, id, JSON.stringify({ days: +r.days })]);
  });
}
export async function rejectLeave(pool: pg.Pool, actor: Actor, id: string) { assertCan(actor, 'hr.write'); const r = await pool.query("UPDATE leave_requests SET status='REJECTED', decided_by=$2, decided_at=now() WHERE id=$1 AND status='PENDING'", [id, actor.id]); if (!r.rowCount) throw new DomainError('ALREADY_DECIDED', 'Request is not pending'); }
export async function cancelApprovedLeave(pool: pg.Pool, actor: Actor, id: string) {
  return tx(pool, async c => {
    const r = (await c.query('SELECT * FROM leave_requests WHERE id=$1 FOR UPDATE', [id])).rows[0]; if (!r) throw new DomainError('NOT_FOUND', 'Request not found'); if (r.employee_id !== actor.id && !can(actor, 'hr.write')) throw new DomainError('FORBIDDEN', 'Not allowed');
    if (!['PENDING', 'APPROVED'].includes(r.status)) throw new DomainError('ALREADY_DECIDED', 'Request is already closed');
    const lt = (await c.query('SELECT unlimited FROM leave_types WHERE code=$1', [r.leave_type])).rows[0];
    if (r.status === 'APPROVED' && !lt.unlimited) await c.query('UPDATE leave_balances SET used = used - $4 WHERE employee_id=$1 AND leave_type=$2 AND year=$3', [r.employee_id, r.leave_type, +String(r.from_date.toISOString?.().slice(0, 4) ?? r.from_date).slice(0, 4), r.days]);
    await c.query("UPDATE leave_requests SET status='CANCELLED' WHERE id=$1", [id]);
  });
}
/** HR data is Host-only by default. */
export async function listLeaveRequests(pool: pg.Pool, actor: Actor) { assertCan(actor, 'hr.read'); return (await pool.query('SELECT * FROM leave_requests ORDER BY created_at DESC')).rows; }
export async function leaveBalance(pool: pg.Pool, actor: Actor, employeeId: string, year: number) {
  if (actor.id !== employeeId && !can(actor, 'hr.read')) throw new DomainError('FORBIDDEN', 'Not allowed'); await ensureBalances(pool, employeeId, year);
  return (await pool.query('SELECT leave_type, entitled::float, carried::float, used::float, (entitled+carried-used)::float AS remaining FROM leave_balances WHERE employee_id=$1 AND year=$2 ORDER BY leave_type', [employeeId, year])).rows;
}
