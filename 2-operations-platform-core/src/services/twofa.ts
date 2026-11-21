import type pg from 'pg';
import { tx, DomainError } from '../db.js';
import type { Actor } from '../permissions.js';
import { newSecret, otpauthUri, sealSecret, openSecret, matchStep } from '../totp.js';
import { recordActivity } from './activity.js';
export const MAX_FAILS = 5, LOCK_MS = 5 * 60_000;

/** Step 1 of enrolment: create a pending secret and return it (shown once as a QR code / key). */
export async function beginEnrollment(pool: pg.Pool, employeeId: string) {
  const e = (await pool.query('SELECT employee_code FROM employees WHERE id=$1', [employeeId])).rows[0]; if (!e) throw new DomainError('NOT_FOUND', 'Employee not found');
  const cur = (await pool.query('SELECT pending FROM staff_totp WHERE employee_id=$1', [employeeId])).rows[0]; if (cur && !cur.pending) throw new DomainError('ALREADY_ENROLLED', 'Google Authenticator is already set up. Ask the Host to reset it.');
  const secret = newSecret();
  await pool.query('INSERT INTO staff_totp (employee_id, secret, pending, last_step, failed_attempts) VALUES ($1,$2,true,0,0) ON CONFLICT (employee_id) DO UPDATE SET secret=EXCLUDED.secret, pending=true, last_step=0, failed_attempts=0, locked_until=NULL', [employeeId, sealSecret(secret)]);
  return { secret, uri: otpauthUri(e.employee_code, secret) };
}
/** Step 2: the employee types the first code from the app; only then is two-factor switched on. */
export async function confirmEnrollment(pool: pg.Pool, a: { employeeId: string; token: string; now?: Date }) {
  const now = a.now ?? new Date();
  await tx(pool, async c => {
    const r = (await c.query('SELECT secret, pending FROM staff_totp WHERE employee_id=$1 FOR UPDATE', [a.employeeId])).rows[0]; if (!r || !r.pending) throw new DomainError('NO_PENDING', 'Start the set-up first');
    const step = matchStep(openSecret(r.secret), a.token, now); if (step === null) throw new DomainError('BAD_CODE', 'That code is not correct');
    await c.query('UPDATE staff_totp SET pending=false, enabled_at=$2, last_step=$3 WHERE employee_id=$1', [a.employeeId, now, step]);
  });
  await recordActivity(pool, { actorId: a.employeeId, action: 'Two-factor enabled', kind: 'security' });
}
/** Second step of every sign-in. A code works once; 5 wrong codes lock the account for 5 minutes. Row-locked so two parallel attempts with the same code cannot both pass. */
export async function verifyLogin(pool: pg.Pool, a: { employeeId: string; token: string; now?: Date }) {
  const now = a.now ?? new Date();
  const out = await tx(pool, async c => {
    const r = (await c.query('SELECT secret, pending, last_step, failed_attempts, locked_until FROM staff_totp WHERE employee_id=$1 FOR UPDATE', [a.employeeId])).rows[0];
    if (!r || r.pending) return { err: 'NOT_ENROLLED' };
    if (r.locked_until && new Date(r.locked_until) > now) return { err: 'LOCKED' };
    const step = matchStep(openSecret(r.secret), a.token, now), reused = step !== null && step <= Number(r.last_step);
    if (step === null || reused) {
      const fails = r.failed_attempts + 1, lock = fails >= MAX_FAILS;
      await c.query('UPDATE staff_totp SET failed_attempts=$2, locked_until=$3 WHERE employee_id=$1', [a.employeeId, lock ? 0 : fails, lock ? new Date(now.getTime() + LOCK_MS) : r.locked_until]);
      return { err: lock ? 'LOCKED' : reused ? 'CODE_REUSED' : 'BAD_CODE' };
    }
    await c.query('UPDATE staff_totp SET last_step=$2, failed_attempts=0, locked_until=NULL WHERE employee_id=$1', [a.employeeId, step]); return { err: null };
  });   // the failed-attempt counter is committed BEFORE the error is raised, so it cannot be rolled back
  if (out.err) throw new DomainError(out.err, { NOT_ENROLLED: 'Set up Google Authenticator first', LOCKED: 'Too many wrong codes. Try again in 5 minutes.', CODE_REUSED: 'That code was already used', BAD_CODE: 'That code is not correct' }[out.err]!);
  await recordActivity(pool, { actorId: a.employeeId, action: 'Signed in', kind: 'signin' });
}
/** Lost phone: only the Host can reset; the employee scans a new QR code at the next sign-in. */
export async function resetTotp(pool: pg.Pool, a: { actor: Actor; employeeId: string }) {
  if (a.actor.role !== 'HOST') throw new DomainError('FORBIDDEN', 'Only the Host can reset two-factor');
  await pool.query('DELETE FROM staff_totp WHERE employee_id=$1', [a.employeeId]);
  await recordActivity(pool, { actorId: a.actor.id, action: 'Two-factor reset', detail: a.employeeId, kind: 'security' });
}
