import type pg from 'pg';
import { tx, DomainError, LOCK_SHIFT } from '../db.js';
import { Actor, assertCan } from '../permissions.js';

export class ShiftBlockedError extends DomainError { constructor(public blockers: { id: string; order_number: string; status: string }[]) { super('SHIFT_BLOCKED', `${blockers.length} order(s) still need packing`, blockers); } }
const UNPACKED = ['PAID_AWAITING_LOGISTICS', 'INVOICE_ATTACHED', 'AWAITING_WAREHOUSE', 'PACKING_IN_PROGRESS', 'ON_HOLD'];
/** COMPANY-WIDE: every non-cancelled order that needs packing and is not yet packed, whoever it belongs to. */
export const blockingOrders = async (c: pg.Pool | pg.PoolClient) => (await c.query('SELECT id, order_number, status FROM orders WHERE requires_packing AND status = ANY($1::order_status[]) ORDER BY created_at', [UNPACKED])).rows;

export async function openShift(pool: pg.Pool, actor: Actor) {
  assertCan(actor, 'shift.open');
  try { return (await pool.query('INSERT INTO warehouse_shifts (opened_by) VALUES ($1) RETURNING id', [actor.id])).rows[0].id as string; }
  catch (e: any) { if (e.code === '23505') throw new DomainError('SHIFT_ALREADY_OPEN', 'A shift is already open'); throw e; }
}
export { startPacking, markPacked } from './packing.js';
export async function closeShift(pool: pg.Pool, shiftId: string, actor: Actor) {
  assertCan(actor, 'shift.close');
  return tx(pool, async c => {
    await c.query('SELECT pg_advisory_xact_lock($1)', [LOCK_SHIFT]);                       // waits for in-flight payment captures; blocks new ones until we finish
    const blockers = await blockingOrders(c); if (blockers.length) throw new ShiftBlockedError(blockers);   // re-checked on the server at closure time
    const r = await c.query("UPDATE warehouse_shifts SET status='CLOSED', closed_by=$2, closed_at=now(), close_kind='NORMAL' WHERE id=$1 AND status='OPEN'", [shiftId, actor.id]);
    if (!r.rowCount) throw new DomainError('SHIFT_NOT_OPEN', 'This shift is not open'); return { closed: true };
  });
}
export async function hostOverrideClose(pool: pg.Pool, shiftId: string, actor: Actor, reason: string) {
  assertCan(actor, 'shift.override');                                                       // only HOST holds '*'
  if (!reason || reason.trim().length < 10) throw new DomainError('REASON_REQUIRED', 'A reason of at least 10 characters is required');
  return tx(pool, async c => {
    await c.query('SELECT pg_advisory_xact_lock($1)', [LOCK_SHIFT]);
    const blockers = await blockingOrders(c);
    const r = await c.query("UPDATE warehouse_shifts SET status='CLOSED', closed_by=$2, closed_at=now(), close_kind='HOST_OVERRIDE' WHERE id=$1 AND status='OPEN'", [shiftId, actor.id]);
    if (!r.rowCount) throw new DomainError('SHIFT_NOT_OPEN', 'This shift is not open');
    await c.query('INSERT INTO shift_overrides (shift_id, host_id, reason, blocking_orders) VALUES ($1,$2,$3,$4)', [shiftId, actor.id, reason.trim(), JSON.stringify(blockers)]);
    await c.query("INSERT INTO audit_logs (actor_type, actor_id, action, entity, entity_id, after) VALUES ('EMPLOYEE',$1,'SHIFT_OVERRIDE','warehouse_shifts',$2,$3)", [actor.id, shiftId, JSON.stringify({ reason: reason.trim(), blockers })]);
    return { closed: true, overridden: blockers.length };
  });
}
