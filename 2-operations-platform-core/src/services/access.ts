import type pg from 'pg';
import { Actor, can } from '../permissions.js';
/** Single choke-point for reading an order: dealers see only their own; Logistics/Warehouse see only PAID orders; Finance/Host see all. */
export async function getOrderFor(pool: pg.Pool, actor: Actor, orderId: string) {
  const o = (await pool.query('SELECT * FROM orders WHERE id=$1', [orderId])).rows[0]; if (!o) return null;
  if (actor.role === 'DEALER') return o.dealer_id === actor.id ? o : null;
  if (can(actor, 'order.read.all')) return o;
  if (can(actor, 'order.read.paid')) return ['PENDING_PAYMENT', 'EXPIRED'].includes(o.status) ? null : o;
  if (can(actor, 'order.read.own_dealers')) { const d = (await pool.query('SELECT 1 FROM dealers WHERE id=$1 AND sales_employee_id=$2', [o.dealer_id, actor.id])).rowCount; return d ? o : null; }
  return null;
}
