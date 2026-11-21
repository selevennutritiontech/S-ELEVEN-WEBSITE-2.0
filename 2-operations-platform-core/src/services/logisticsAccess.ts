import type pg from 'pg';
import { DomainError } from '../db.js';
import { assertCan, can, type Actor } from '../permissions.js';
import { attachInvoiceNumbered, attachEwayBill, dispatchOrder } from './logistics.js';
/** Read-only operational view shared by Logistics, Warehouse, Finance and the Host. Finance sees it through 'logistics.read'; it gets no dispatch/tracking rights. */
export async function logisticsView(pool: pg.Pool, actor: Actor, orderId: string) {
  assertCan(actor, 'logistics.read');
  const o = (await pool.query('SELECT o.id, o.order_number, o.status, o.total_paise, o.paid_paise, o.paid_at, d.dealer_code, d.name AS dealer_name FROM orders o JOIN dealers d ON d.id=o.dealer_id WHERE o.id=$1', [orderId])).rows[0]; if (!o) throw new DomainError('NOT_FOUND', 'Order not found');
  const ship = (await pool.query('SELECT courier, tracking_number, tracking_url, dispatched_on, eway_bill_no FROM shipments WHERE order_id=$1', [orderId])).rows[0] ?? null;
  const events = ship ? (await pool.query('SELECT te.event, te.occurred_at FROM tracking_events te JOIN shipments s ON s.id=te.shipment_id WHERE s.order_id=$1 ORDER BY te.id', [orderId])).rows : [];
  const docs = (await pool.query('SELECT kind, version, doc_number, filename, is_current, uploaded_at FROM documents WHERE order_id=$1 ORDER BY kind, version', [orderId])).rows;
  const history = (await pool.query('SELECT from_status, to_status, actor_type, actor_id, reason, at FROM order_status_history WHERE order_id=$1 ORDER BY id', [orderId]).catch(() => ({ rows: [] }))).rows;
  const pay = (await pool.query("SELECT 'CARD_UPI' AS source, amount_paise, captured_at AS at FROM payment_captures WHERE order_id=$1 ORDER BY captured_at", [orderId])).rows;
  return { order: o, shipment: ship, trackingEvents: events, documents: docs, statusHistory: history, payments: pay };
}
/** Finance holds the explicit 'document.correct' grant; Logistics holds 'invoice.upload'. Nobody else may upload operational documents. */
export async function uploadDocumentAs(pool: pg.Pool, actor: Actor, a: { kind: 'INVOICE' | 'EWAY_BILL'; orderId: string; number: string; filename: string; contentType: string; sizeBytes: number; sha256: string; storageKey: string }) {
  if (!can(actor, 'invoice.upload') && !can(actor, 'document.correct')) throw new DomainError('FORBIDDEN', `Role ${actor.role} may not upload order documents`);
  const { kind, ...rest } = a; const d = { ...rest, employeeId: actor.id }; return kind === 'INVOICE' ? attachInvoiceNumbered(pool, d) : attachEwayBill(pool, d);
}
export async function dispatchAs(pool: pg.Pool, actor: Actor, orderId: string) { assertCan(actor, 'tracking.write'); return dispatchOrder(pool, orderId, actor.id); }
