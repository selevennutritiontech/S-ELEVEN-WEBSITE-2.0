import type pg from 'pg';
import { DomainError, TZ } from '../db.js';
import { Actor, can } from '../permissions.js';
import { loadSchedule } from './attendance.js';
import { localIso } from '../attendance.js';
import { blockingOrders } from './warehouse.js';

/** Everything the Create Order screen needs beside the form: profile, the assigned Sales employee (looked up automatically), paged history, preorders, offers. */
export async function dealerContext(pool: pg.Pool, actor: Actor, dealerId: string, opts: { limit?: number; offset?: number } = {}) {
  if (actor.role === 'DEALER' ? actor.id !== dealerId : !(can(actor, 'dealer.read') || can(actor, 'order.read.all'))) throw new DomainError('FORBIDDEN', 'Not allowed');
  const d = (await pool.query(`SELECT d.*, e.employee_code AS sales_code, e.name AS sales_name FROM dealers d LEFT JOIN employees e ON e.id=d.sales_employee_id WHERE d.id=$1`, [dealerId])).rows[0]; if (!d) throw new DomainError('NOT_FOUND', 'Dealer not found');
  const limit = Math.min(50, opts.limit ?? 10), off = opts.offset ?? 0;
  const orders = (await pool.query(`SELECT o.id, o.order_number, o.created_at, o.total_paise, o.status, (o.paid_at IS NOT NULL) AS paid, s.tracking_number,
      (SELECT string_agg(DISTINCT i.brand_code, ', ') FROM order_items i WHERE i.order_id=o.id) AS brands FROM orders o LEFT JOIN shipments s ON s.order_id=o.id WHERE o.dealer_id=$1 ORDER BY o.created_at DESC LIMIT $2 OFFSET $3`, [dealerId, limit, off])).rows;
  const total = (await pool.query('SELECT COUNT(*)::int AS n FROM orders WHERE dealer_id=$1', [dealerId])).rows[0].n as number;
  const pre = (await pool.query('SELECT preorder_number, status, created_at FROM preorders WHERE dealer_id=$1 ORDER BY created_at DESC LIMIT 10', [dealerId])).rows;
  const offers = (await pool.query("SELECT code, name, kind FROM promotions WHERE active AND starts_at <= now() AND ends_at > now() AND (all_dealers OR EXISTS (SELECT 1 FROM promotion_dealers x WHERE x.promotion_id=promotions.id AND x.dealer_id=$1)) ORDER BY priority, code", [dealerId])).rows;
  const prices = (await pool.query('SELECT COUNT(*)::int AS n FROM dealer_price_rules WHERE dealer_id=$1 AND effective_from <= now() AND (effective_to IS NULL OR effective_to > now())', [dealerId])).rows[0].n as number;
  return { dealer: { id: d.id, code: d.dealer_code, name: d.name, status: d.status, gstin: d.gstin }, salesEmployee: d.sales_employee_id ? { id: d.sales_employee_id as string, code: d.sales_code as string, name: d.sales_name as string } : null,
    needsAttributionResolution: !d.sales_employee_id, history: { total, limit, offset: off, orders }, preorders: pre, offers, activePriceRules: prices };
}
/** Host view of the Warehouse team from PERSISTENT attendance and shift records (no mock data). */
export async function warehouseStaffStatus(pool: pg.Pool, now: Date) {
  const s = await loadSchedule(pool), today = localIso(now, s.timezone ?? TZ), pending = (await blockingOrders(pool)).length;
  const emps = (await pool.query("SELECT e.id, e.employee_code, e.name, e.designation, e.status FROM employees e JOIN departments d ON d.id=e.department_id WHERE d.code='WAREHOUSE' ORDER BY e.employee_code")).rows;
  const out = [];
  for (const e of emps) {
    const ses = (await pool.query('SELECT clock_in, clock_out FROM shift_sessions WHERE employee_id=$1 AND work_date=$2 ORDER BY clock_in', [e.id, today])).rows;
    const open = ses.find(x => !x.clock_out), shift = (await pool.query("SELECT id FROM warehouse_shifts WHERE opened_by=$1 AND status='OPEN'", [e.id])).rows[0];
    const act = (await pool.query(`SELECT MAX(t) AS t FROM (SELECT MAX(COALESCE(clock_out, clock_in)) AS t FROM shift_sessions WHERE employee_id=$1 UNION ALL SELECT MAX(verified_at) FROM packing_items WHERE verified_by=$1 UNION ALL SELECT MAX(created_at) FROM order_status_history WHERE actor_id=$1::text) x`, [e.id])).rows[0].t as Date | null;
    out.push({ employeeCode: e.employee_code as string, name: e.name as string, designation: e.designation as string | null, attendance: open ? 'CLOCKED_IN' : (ses.length ? 'CLOCKED_OUT' : 'NOT_STARTED'), shiftStart: ses[0]?.clock_in ?? null, shiftEnd: open ? null : (ses.length ? ses[ses.length - 1].clock_out : null), warehouseShift: shift ? 'OPEN' : 'CLOSED', lastActivity: act, pendingWarehouseOrders: pending });
  }
  return out;
}
