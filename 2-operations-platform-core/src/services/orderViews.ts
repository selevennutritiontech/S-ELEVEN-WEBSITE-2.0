import type pg from 'pg';
import { tx, DomainError } from '../db.js';
import { assertCan, can, type Actor } from '../permissions.js';
const NOT_ELIGIBLE = ['PENDING_PAYMENT', 'EXPIRED', 'CANCELLED'];
/** Marks an order as SEEN by the Warehouse only when a Warehouse employee opens the order detail (never because it appeared in a list). Every view is kept. */
export async function recordOrderView(pool: pg.Pool, actor: Actor, orderId: string, kind: 'VIEWED' | 'ACKNOWLEDGED' = 'VIEWED', now = new Date()) {
  assertCan(actor, 'order.mark.seen'); if (actor.role !== 'WAREHOUSE') throw new DomainError('FORBIDDEN', 'Only Warehouse employees mark an order as seen');
  return tx(pool, async c => {
    const o = (await c.query('SELECT status FROM orders WHERE id=$1 FOR UPDATE', [orderId])).rows[0]; if (!o) throw new DomainError('NOT_FOUND', 'Order not found'); if (NOT_ELIGIBLE.includes(o.status)) throw new DomainError('NOT_ELIGIBLE', 'This order is not ready for the Warehouse yet');
    await c.query('INSERT INTO order_view_events (order_id, employee_id, kind, at) VALUES ($1,$2,$3,$4)', [orderId, actor.id, kind, now]);
    const r = (await c.query('INSERT INTO order_warehouse_seen (order_id, first_seen_at, first_seen_by, last_seen_at, last_seen_by) VALUES ($1,$3,$2,$3,$2) ON CONFLICT (order_id) DO UPDATE SET last_seen_at=EXCLUDED.last_seen_at, last_seen_by=EXCLUDED.last_seen_by, seen_count=order_warehouse_seen.seen_count+1 RETURNING seen_count, first_seen_at', [orderId, actor.id, now])).rows[0];
    return { seenCount: r.seen_count as number, firstSeenAt: r.first_seen_at as Date };
  });
}
export interface OrderFilter { page?: number; pageSize?: number; q?: string; status?: string; dealerCode?: string; salesEmployeeId?: string; paymentStatus?: string; warehouse?: string }
const BASE = `SELECT o.id, o.dealer_id, o.order_number, o.status, o.total_paise, o.paid_paise, o.created_at, o.paid_at, d.dealer_code, d.name AS dealer_name, o.sales_employee_id, o.sales_employee_code, o.sales_employee_name, o.attribution_status,
  o.creator_kind, o.creator_code, o.creator_name, o.creator_role,
  CASE WHEN o.paid_paise >= o.total_paise THEN 'PAID' WHEN o.paid_paise > 0 THEN 'PARTIALLY_PAID' WHEN EXISTS (SELECT 1 FROM payment_proofs p WHERE p.order_id=o.id AND p.status='AWAITING_VERIFICATION') THEN 'VERIFICATION_PENDING' ELSE 'UNPAID' END AS payment_status,
  EXISTS (SELECT 1 FROM payment_proofs p WHERE p.order_id=o.id AND p.status='AWAITING_VERIFICATION') AS proof_pending,
  CASE WHEN o.status IN ('PENDING_PAYMENT','EXPIRED','CANCELLED') THEN NULL WHEN o.status IN ('PACKED_READY','READY_FOR_DISPATCH','SHIPPED','DELIVERED') THEN 'PACKED' WHEN o.status = 'PACKING_IN_PROGRESS' THEN 'PACKING_STARTED' WHEN w.first_seen_at IS NOT NULL THEN 'SEEN' ELSE 'NOT_SEEN' END AS warehouse_state,
  w.first_seen_at, w.last_seen_at, w.seen_count, w.last_seen_by, (SELECT employee_code FROM employees e WHERE e.id = w.last_seen_by) AS last_seen_by_code
  FROM orders o JOIN dealers d ON d.id = o.dealer_id LEFT JOIN order_warehouse_seen w ON w.order_id = o.id`;
/** One paged, server-filtered list for every department. Each role sees only what it is allowed to. The status is the single authoritative orders.status. */
export async function listOrders(pool: pg.Pool, actor: Actor, f: OrderFilter = {}) {
  const scope: string[] = [], p: unknown[] = [];
  if (actor.type === 'DEALER') { if (!can(actor, 'order.read.own')) throw new DomainError('FORBIDDEN', 'Not allowed'); p.push(actor.id); scope.push(`dealer_id = $${p.length}`); }
  else if (can(actor, 'order.read.all')) { /* Host and Finance: everything */ }
  else if (can(actor, 'order.read.paid')) scope.push(`status NOT IN ('PENDING_PAYMENT','EXPIRED','CANCELLED')`);
  else if (can(actor, 'order.read.own_dealers')) { p.push(actor.id); scope.push(`sales_employee_id = $${p.length}`); }
  else throw new DomainError('FORBIDDEN', 'Not allowed');
  const add = (sql: string, v: unknown) => { p.push(v); scope.push(sql.replace('?', `$${p.length}`)); };
  if (f.status) add('status = ?::order_status', f.status); if (f.dealerCode) add('dealer_code = ?', f.dealerCode); if (f.salesEmployeeId) add('sales_employee_id = ?', f.salesEmployeeId); if (f.paymentStatus) add('payment_status = ?', f.paymentStatus); if (f.warehouse) add('warehouse_state = ?', f.warehouse);
  if (f.q) { p.push(`%${f.q}%`); const i = p.length; scope.push(`(order_number ILIKE $${i} OR dealer_code ILIKE $${i} OR dealer_name ILIKE $${i})`); }
  const pageSize = Math.min(Math.max(f.pageSize ?? 25, 1), 100), page = Math.max(f.page ?? 1, 1); p.push(pageSize, (page - 1) * pageSize);
  const where = scope.length ? 'WHERE ' + scope.join(' AND ') : '', sql = `SELECT *, count(*) OVER() AS total FROM (${BASE}) x ${where} ORDER BY created_at DESC, id LIMIT $${p.length - 1} OFFSET $${p.length}`;
  const rows = (await pool.query(sql, p)).rows, showWh = actor.type === 'EMPLOYEE' && (actor.role === 'HOST' || actor.role === 'WAREHOUSE' || can(actor, 'order.view.indicator'));
  return { page, pageSize, total: rows[0] ? Number(rows[0].total) : 0, rows: rows.map(r => ({
    id: r.id as string, orderNumber: r.order_number as string, status: r.status as string, paymentStatus: r.payment_status as string, proofPending: r.proof_pending as boolean, totalPaise: BigInt(r.total_paise), paidPaise: BigInt(r.paid_paise), createdAt: r.created_at as Date,
    dealer: { code: r.dealer_code as string, name: r.dealer_name as string },
    salesEmployee: r.attribution_status === 'ASSIGNED' ? { code: r.sales_employee_code as string, name: r.sales_employee_name as string } : null, attribution: r.attribution_status as string,
    generatedBy: { kind: r.creator_kind as string, code: r.creator_code as string, name: r.creator_name as string, role: r.creator_role as string },
    warehouse: showWh && r.warehouse_state ? { state: r.warehouse_state as string, firstSeenAt: r.first_seen_at as Date | null, lastSeenAt: r.last_seen_at as Date | null, lastSeenByCode: r.last_seen_by_code as string | null, seenCount: r.seen_count as number | null } : null })) };
}
export async function getOrderStatusView(pool: pg.Pool, actor: Actor, orderId: string) {
  const r = await listOrders(pool, actor, { pageSize: 100 }), row = r.rows.find(x => x.id === orderId); if (!row) throw new DomainError('NOT_FOUND', 'Order not found');
  const hist = (await pool.query('SELECT from_status, to_status, actor_type, actor_id, at FROM order_status_history WHERE order_id=$1 ORDER BY id', [orderId]).catch(() => ({ rows: [] }))).rows; return { ...row, history: hist };
}
