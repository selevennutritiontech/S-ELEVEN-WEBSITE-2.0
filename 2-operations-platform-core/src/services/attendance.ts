import type pg from 'pg';
import { tx, DomainError } from '../db.js';
import { Actor, assertCan, can } from '../permissions.js';
import { Schedule, localIso, monthReport, isoDate } from '../attendance.js';

export async function loadSchedule(c: pg.Pool | pg.PoolClient): Promise<Schedule> { return (await c.query("SELECT value FROM app_settings WHERE key='work_schedule'")).rows[0].value as Schedule; }
/** Attendance applies to every department EXCEPT Host. Employees can clock in/out for themselves only; they cannot edit past records. */
export async function clockIn(pool: pg.Pool, actor: Actor, now = new Date()) {
  if (actor.role === 'HOST' || actor.type !== 'EMPLOYEE') throw new DomainError('NOT_APPLICABLE', 'Attendance does not apply to this account');
  assertCan(actor, 'attendance.own'); const s = await loadSchedule(pool);
  try { return (await pool.query('INSERT INTO shift_sessions (employee_id, work_date, clock_in) VALUES ($1,$2,$3) RETURNING id', [actor.id, localIso(now, s.timezone), now])).rows[0].id as string; }
  catch (e: any) { if (e.code === '23505') throw new DomainError('ALREADY_CLOCKED_IN', 'You are already clocked in'); throw e; }
}
export async function clockOut(pool: pg.Pool, actor: Actor, now = new Date()) {
  if (actor.role === 'HOST' || actor.type !== 'EMPLOYEE') throw new DomainError('NOT_APPLICABLE', 'Attendance does not apply to this account');
  const open = (await pool.query('SELECT id, clock_in FROM shift_sessions WHERE employee_id=$1 AND clock_out IS NULL', [actor.id])).rows[0];
  if (!open) throw new DomainError('NOT_CLOCKED_IN', 'You are not clocked in'); if (now <= open.clock_in) throw new DomainError('INVALID_SEQUENCE', 'Clock-out must be after clock-in');
  await pool.query('UPDATE shift_sessions SET clock_out=$2 WHERE id=$1', [open.id, now]); return open.id as string;
}
/** Shifts still open after their day ended are flagged once for Host review (run from the scheduler). */
export async function flagMissingClockOuts(pool: pg.Pool, now: Date): Promise<number> {
  const s = await loadSchedule(pool), today = localIso(now, s.timezone);
  const rows = (await pool.query("UPDATE shift_sessions SET missing_clock_out=true WHERE clock_out IS NULL AND work_date < $1 AND NOT missing_clock_out RETURNING id, employee_id", [today])).rows;
  for (const r of rows) await pool.query("INSERT INTO notifications (kind, recipient_department, payload) VALUES ('MISSING_CLOCK_OUT','HOST',$1)", [JSON.stringify({ employeeId: r.employee_id, sessionId: r.id })]);
  return rows.length;
}
export async function requestCorrection(pool: pg.Pool, actor: Actor, a: { employeeId: string; workDate: string; newIn: Date; newOut: Date; reason: string }) {
  if (actor.id !== a.employeeId && !can(actor, 'hr.write')) throw new DomainError('FORBIDDEN', 'You can only request corrections for yourself');
  return (await pool.query('INSERT INTO attendance_corrections (employee_id, work_date, new_clock_in, new_clock_out, reason, requested_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id', [a.employeeId, a.workDate, a.newIn, a.newOut, a.reason, actor.id])).rows[0].id as string;
}
/** Only the Host approves, and never their own request or one for themselves (employees cannot edit their own attendance). */
export async function approveCorrection(pool: pg.Pool, actor: Actor, id: string) {
  assertCan(actor, 'hr.write');
  return tx(pool, async c => {
    const r = (await c.query('SELECT * FROM attendance_corrections WHERE id=$1 FOR UPDATE', [id])).rows[0]; if (!r) throw new DomainError('NOT_FOUND', 'Correction not found'); if (r.status !== 'PENDING') throw new DomainError('ALREADY_DECIDED', 'Already decided');
    await c.query('DELETE FROM shift_sessions WHERE employee_id=$1 AND work_date=$2', [r.employee_id, r.work_date]);
    await c.query("INSERT INTO shift_sessions (employee_id, work_date, clock_in, clock_out, source) VALUES ($1,$2,$3,$4,'CORRECTION')", [r.employee_id, r.work_date, r.new_clock_in, r.new_clock_out]);
    await c.query("UPDATE attendance_corrections SET status='APPROVED', decided_by=$2, decided_at=now() WHERE id=$1", [id, actor.id]);
    await c.query("INSERT INTO audit_logs (actor_type, actor_id, action, entity, entity_id, after) VALUES ('EMPLOYEE',$1,'ATTENDANCE_CORRECTION','shift_sessions',$2,$3)", [actor.id, r.employee_id, JSON.stringify({ date: r.work_date, reason: r.reason })]);
  });
}
/** Month view for the employee (own) or the Host (any employee): present/absent, late, early, hours, approved leave and holidays. */
export async function monthlyAttendance(pool: pg.Pool, actor: Actor, employeeId: string, year: number, month: number, now = new Date()) {
  if (actor.id !== employeeId && !can(actor, 'hr.read')) throw new DomainError('FORBIDDEN', 'You can only view your own attendance');
  const s = await loadSchedule(pool), from = isoDate(year, month, 1), to = isoDate(year, month, new Date(Date.UTC(year, month, 0)).getUTCDate());
  const ses = (await pool.query('SELECT clock_in, clock_out FROM shift_sessions WHERE employee_id=$1 AND work_date BETWEEN $2 AND $3', [employeeId, from, to])).rows.map(r => ({ in: r.clock_in as Date, out: r.clock_out as Date | null }));
  const hol: Record<string, string> = {}; (await pool.query("SELECT to_char(day,'YYYY-MM-DD') AS d, name FROM holidays WHERE day BETWEEN $1 AND $2", [from, to])).rows.forEach(r => { hol[r.d] = r.name; });
  const lv = (await pool.query("SELECT to_char(l.from_date,'YYYY-MM-DD') AS f, to_char(l.to_date,'YYYY-MM-DD') AS t, l.leave_type, t.paid, l.half_day FROM leave_requests l JOIN leave_types t ON t.code=l.leave_type WHERE l.employee_id=$1 AND l.status='APPROVED' AND l.to_date >= $2 AND l.from_date <= $3", [employeeId, from, to])).rows.map(r => ({ from: r.f, to: r.t, type: r.leave_type, paid: r.paid, half: r.half_day }));
  return monthReport({ year, month, schedule: s, sessions: ses, holidays: hol, leaves: lv, todayIso: localIso(now, s.timezone) });
}
