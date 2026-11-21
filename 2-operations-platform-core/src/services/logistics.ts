import { recordActivity } from './activity.js';
import type pg from 'pg';
import { tx, DomainError, TZ } from '../db.js';
import { transition } from './orders.js';
import { invoiceSlot, trackingSlot } from '../reminders.js';

export async function attachInvoice(pool: pg.Pool, a: { orderId: string; employeeId: string; filename: string; contentType: string; sizeBytes: number; sha256: string; storageKey: string; kind?: 'INVOICE' | 'EWAY_BILL' }) {
  if (a.contentType !== 'application/pdf') throw new DomainError('BAD_FILE_TYPE', 'Only PDF files are accepted');
  if (a.sizeBytes <= 0 || a.sizeBytes > 10 * 1024 * 1024) throw new DomainError('BAD_FILE_SIZE', 'File must be 1 byte to 10 MB');
  const kind = a.kind ?? 'INVOICE';
  return tx(pool, async c => {
    const o = (await c.query('SELECT status FROM orders WHERE id=$1 FOR UPDATE', [a.orderId])).rows[0]; if (!o) throw new DomainError('NOT_FOUND', 'Order not found');
    if (['PENDING_PAYMENT', 'CANCELLED', 'EXPIRED'].includes(o.status)) throw new DomainError('ORDER_NOT_PAID', 'Documents can be attached only to paid orders');
    const v = (await c.query('SELECT COALESCE(MAX(version),0)+1 AS v FROM documents WHERE order_id=$1 AND kind=$2', [a.orderId, kind])).rows[0].v;
    await c.query('UPDATE documents SET is_current=false WHERE order_id=$1 AND kind=$2 AND is_current', [a.orderId, kind]);
    await c.query('INSERT INTO documents (order_id, kind, version, storage_key, filename, content_type, size_bytes, sha256, uploaded_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [a.orderId, kind, v, a.storageKey, a.filename, a.contentType, a.sizeBytes, a.sha256, a.employeeId]);
    if (kind === 'INVOICE') {
      await c.query("UPDATE reminder_state SET resolved_at=now() WHERE order_id=$1 AND kind='MISSING_INVOICE' AND resolved_at IS NULL", [a.orderId]);
      if (o.status === 'PAID_AWAITING_LOGISTICS') { await transition(c, a.orderId, 'INVOICE_ATTACHED', { type: 'EMPLOYEE', id: a.employeeId }); await transition(c, a.orderId, 'AWAITING_WAREHOUSE', { type: 'SYSTEM', id: null }, 'released to warehouse'); }
    }
    return { version: v as number };
  });
}
export async function saveTracking(pool: pg.Pool, a: { orderId: string; employeeId: string; courier: string; trackingNumber: string; trackingUrl?: string; dispatchedOn?: string; ewayBillNo?: string }) {
  if (!a.courier.trim() || !a.trackingNumber.trim()) throw new DomainError('BAD_TRACKING', 'Courier and tracking number are required');
  return tx(pool, async c => {
    await c.query(`INSERT INTO shipments (order_id, courier, tracking_number, tracking_url, dispatched_on, eway_bill_no, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (order_id) DO UPDATE SET courier=EXCLUDED.courier, tracking_number=EXCLUDED.tracking_number, tracking_url=EXCLUDED.tracking_url, dispatched_on=EXCLUDED.dispatched_on, eway_bill_no=EXCLUDED.eway_bill_no`,
      [a.orderId, a.courier.trim(), a.trackingNumber.trim(), a.trackingUrl ?? null, a.dispatchedOn ?? null, a.ewayBillNo ?? null, a.employeeId]);
    await c.query("UPDATE reminder_state SET resolved_at=now() WHERE order_id=$1 AND kind='MISSING_TRACKING' AND resolved_at IS NULL", [a.orderId]);
  });
}
export async function dispatchOrder(pool: pg.Pool, orderId: string, employeeId: string) {
  return tx(pool, async c => { if (await ewayRequired(c, orderId) && !(await c.query("SELECT 1 FROM documents WHERE order_id=$1 AND kind='EWAY_BILL' AND is_current", [orderId])).rowCount) throw new DomainError('EWAY_REQUIRED', 'Attach the e-way bill (orders above \u20B950,000) before dispatch');
    if (!(await c.query('SELECT 1 FROM shipments WHERE order_id=$1', [orderId])).rowCount) throw new DomainError('NO_TRACKING', 'Save tracking details before dispatch'); await transition(c, orderId, 'SHIPPED', { type: 'EMPLOYEE', id: employeeId }); });
}

/** Worker tick (run every minute by a durable scheduler such as BullMQ). Reminders are idempotent: one notification per (order, kind, 15-minute slot). */
export async function runReminderTick(pool: pg.Pool, now: Date): Promise<{ invoice: number; tracking: number }> {
  let invoice = 0, tracking = 0;
  const live = "o.status NOT IN ('CANCELLED','EXPIRED','PENDING_PAYMENT') AND o.requires_packing";
  const inv = (await pool.query(`SELECT rs.order_id, rs.eligible_at FROM reminder_state rs JOIN orders o ON o.id=rs.order_id WHERE rs.kind='MISSING_INVOICE' AND rs.resolved_at IS NULL AND ${live} AND NOT EXISTS (SELECT 1 FROM documents d WHERE d.order_id=o.id AND d.kind='INVOICE' AND d.is_current)`)).rows;
  for (const r of inv) { const s = invoiceSlot(r.eligible_at, now); if (s === null) continue; invoice += await notify(pool, 'MISSING_INVOICE', 'LOGISTICS', r.order_id, s); }
  const trk = (await pool.query(`SELECT rs.order_id, rs.eligible_at FROM reminder_state rs JOIN orders o ON o.id=rs.order_id WHERE rs.kind='MISSING_TRACKING' AND rs.resolved_at IS NULL AND ${live} AND NOT EXISTS (SELECT 1 FROM shipments s WHERE s.order_id=o.id)`)).rows;
  for (const r of trk) { const s = trackingSlot(r.eligible_at, now); if (s === null) continue; tracking += await notify(pool, 'MISSING_TRACKING', 'LOGISTICS', r.order_id, s); }
  return { invoice, tracking };
}
async function notify(pool: pg.Pool, kind: string, dept: string, orderId: string, slot: number): Promise<number> {
  const n = await pool.query('INSERT INTO notifications (kind, recipient_department, order_id, slot) VALUES ($1,$2,$3,$4) ON CONFLICT (order_id, kind, slot) WHERE slot IS NOT NULL DO NOTHING RETURNING id', [kind, dept, orderId, slot]);
  if (!n.rowCount) return 0;
  await pool.query("INSERT INTO notification_deliveries (notification_id, channel, status) VALUES ($1,'IN_APP','SENT')", [n.rows[0].id]); return 1;
}
void TZ;

/** Pending-work reminders for Warehouse and Logistics: every 30 minutes (clock-aligned slots) while orders are not packed, or packed and waiting to be dispatched.
 *  One notification per (order, kind, slot), visible to both departments and the Host, so parallel workers never duplicate it. */
export const PENDING_SLOT_MS = 30 * 60 * 1000;
export async function runPendingWorkTick(pool: pg.Pool, now: Date): Promise<{ notPacked: number; readyToDispatch: number }> {
  const slot = Math.floor(now.getTime() / PENDING_SLOT_MS), depts = JSON.stringify({ departments: ['WAREHOUSE', 'LOGISTICS', 'HOST'] });
  const one = async (kind: string, orderId: string) => {
    const n = await pool.query('INSERT INTO notifications (kind, recipient_department, order_id, slot, payload) VALUES ($1,NULL,$2,$3,$4) ON CONFLICT (order_id, kind, slot) WHERE slot IS NOT NULL DO NOTHING RETURNING id', [kind, orderId, slot, depts]);
    if (n.rowCount) await pool.query("INSERT INTO notification_deliveries (notification_id, channel, status) VALUES ($1,'IN_APP','SENT')", [n.rows[0].id]); return n.rowCount || 0;
  };
  let notPacked = 0, readyToDispatch = 0;
  for (const r of (await pool.query("SELECT id FROM orders WHERE requires_packing AND status IN ('PAID_AWAITING_LOGISTICS','INVOICE_ATTACHED','AWAITING_WAREHOUSE','PACKING_IN_PROGRESS')")).rows) notPacked += await one('ORDER_NOT_PACKED', r.id);
  for (const r of (await pool.query("SELECT id FROM orders WHERE status IN ('PACKED_READY','READY_FOR_DISPATCH')")).rows) readyToDispatch += await one('READY_TO_DISPATCH', r.id);
  return { notPacked, readyToDispatch };
}

/** An e-way bill is required for goods worth MORE than 50,000 rupees (exactly 50,000 does not need one). */
export const EWAY_LIMIT_PAISE = 5_000_000;
export async function ewayRequired(db: pg.Pool | pg.PoolClient, orderId: string): Promise<boolean> { const r = await db.query('SELECT total_paise > $2 AS need FROM orders WHERE id=$1', [orderId, EWAY_LIMIT_PAISE]); return !!r.rows[0]?.need; }
type DocIn = { orderId: string; employeeId: string; number: string; filename: string; contentType: string; sizeBytes: number; sha256: string; storageKey: string };
async function numbered(pool: pg.Pool, a: DocIn, kind: 'INVOICE' | 'EWAY_BILL') {
  if (!a.number || !a.number.trim()) throw new DomainError('NUMBER_REQUIRED', kind === 'INVOICE' ? 'Enter the invoice number' : 'Enter the e-way bill number');
  const r = await attachInvoice(pool, { ...a, kind }); await pool.query('UPDATE documents SET doc_number=$3 WHERE order_id=$1 AND kind=$4 AND version=$2', [a.orderId, r.version, a.number.trim(), kind]);
  await recordActivity(pool, { actorId: a.employeeId, action: kind === 'INVOICE' ? 'Invoice uploaded' : 'E-way bill uploaded', detail: a.number.trim(), kind: 'invoice' }); return r;
}
export const attachInvoiceNumbered = (pool: pg.Pool, a: DocIn) => numbered(pool, a, 'INVOICE');
export async function attachEwayBill(pool: pg.Pool, a: DocIn) {
  if (!(await ewayRequired(pool, a.orderId))) throw new DomainError('EWAY_NOT_REQUIRED', 'An e-way bill is needed only for orders above \u20B950,000');
  return numbered(pool, a, 'EWAY_BILL');
}
