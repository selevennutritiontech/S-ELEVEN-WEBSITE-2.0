import { consumeStockForSale } from './batches.js';
import crypto from 'node:crypto';
import type pg from 'pg';
import { tx, DomainError, LOCK_SHIFT, TZ } from '../db.js';
import { allocate, roundDiv } from '../money.js';
import { transition } from './orders.js';
import { trackingStart, monthOf } from '../reminders.js';

export interface ProviderEvent { eventId: string; type: 'payment.captured' | 'payment.failed'; providerOrderRef: string; txnRef: string; amountPaise: bigint; currency: string }
export interface PaymentProvider { name: string; createQr(a: { orderNumber: string; amountPaise: bigint; attemptId: string }): Promise<{ providerOrderRef: string; qrPayload: string }>; verifySignature(raw: string, signature: string): boolean; parseEvent(raw: string): ProviderEvent }
/** TEST-MODE provider (HMAC-signed webhooks). Replace with the Razorpay/Cashfree/PayU adapter once the merchant account exists. */
export class MockProvider implements PaymentProvider {
  name = 'mock'; constructor(private secret: string) {}
  async createQr(a: { orderNumber: string; amountPaise: bigint; attemptId: string }) { const ref = 'mock_' + a.attemptId.slice(0, 12); return { providerOrderRef: ref, qrPayload: `upi://pay?pa=seleven@mock&am=${(Number(a.amountPaise) / 100).toFixed(2)}&tn=${a.orderNumber}&tr=${ref}` }; }
  sign(raw: string) { return crypto.createHmac('sha256', this.secret).update(raw).digest('hex'); }
  verifySignature(raw: string, signature: string) { const a = Buffer.from(this.sign(raw)), b = Buffer.from(signature || ''); return a.length === b.length && crypto.timingSafeEqual(a, b); }
  parseEvent(raw: string): ProviderEvent { const j = JSON.parse(raw); return { eventId: j.eventId, type: j.type, providerOrderRef: j.ref, txnRef: j.txn, amountPaise: BigInt(j.amountPaise), currency: j.currency || 'INR' }; }
}

export async function initiatePayment(pool: pg.Pool, orderId: string, provider: PaymentProvider, idempotencyKey: string, now = new Date()) {
  return tx(pool, async c => {
    const ex = await c.query('SELECT * FROM payment_attempts WHERE idempotency_key=$1', [idempotencyKey]); if (ex.rowCount) return ex.rows[0];
    const o = (await c.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE', [orderId])).rows[0];
    if (!o) throw new DomainError('NOT_FOUND', 'Order not found');
    if (o.status !== 'PENDING_PAYMENT' || (o.expires_at && o.expires_at <= now)) throw new DomainError('ORDER_NOT_PAYABLE', 'This order can no longer be paid');
    const live = await c.query("SELECT * FROM payment_attempts WHERE order_id=$1 AND status IN ('CREATED','PENDING')", [orderId]); if (live.rowCount) return live.rows[0];
    const id = crypto.randomUUID(), qr = await provider.createQr({ orderNumber: o.order_number, amountPaise: o.total_paise, attemptId: id });
    return (await c.query("INSERT INTO payment_attempts (id, order_id, provider, provider_order_ref, idempotency_key, amount_paise, status, qr_payload, expires_at) VALUES ($1,$2,$3,$4,$5,$6,'PENDING',$7,$8) RETURNING *",
      [id, orderId, provider.name, qr.providerOrderRef, idempotencyKey, o.total_paise.toString(), qr.qrPayload, o.expires_at])).rows[0];
  });
}

/** Credits (sign +1) or reverses (sign -1) sales targets. Exactly-once per source key; proportional across brands in integer paise. */
export async function creditTargets(c: pg.PoolClient, o: { id: string; sales_employee_id: string | null; total_paise: bigint }, amount: bigint, sign: 1 | -1, keyPrefix: string, kind: string, at: Date) {
  if (!o.sales_employee_id) { await c.query('UPDATE orders SET needs_manual_attribution = true WHERE id=$1', [o.id]); return 0; }
  const rows = (await c.query('SELECT brand_id, SUM(eligible_paise)::bigint AS e FROM order_items WHERE order_id=$1 GROUP BY brand_id ORDER BY brand_id', [o.id])).rows;
  const totalE = rows.reduce((a, r) => a + (r.e as bigint), 0n); if (totalE <= 0n) return 0;
  const portion = roundDiv(amount * totalE, o.total_paise);                       // part of the money that relates to eligible merchandise
  const parts = allocate(portion, rows.map(r => r.e as bigint)); let n = 0;
  for (let i = 0; i < rows.length; i++) {
    if (parts[i] === 0n) continue;
    const r = await c.query('INSERT INTO target_credit_ledger (source_event_key, employee_id, brand_id, month, amount_paise, kind, order_id) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (source_event_key) DO NOTHING',
      [`${keyPrefix}:${rows[i].brand_id}`, o.sales_employee_id, rows[i].brand_id, monthOf(at, TZ), (parts[i] * BigInt(sign)).toString(), kind, o.id]); n += r.rowCount || 0;
  }
  return n;
}

export type WebhookOutcome = 'CAPTURED' | 'DUPLICATE' | 'ALREADY_CAPTURED' | 'FAILED_RECORDED' | 'AMOUNT_MISMATCH' | 'UNKNOWN_REFERENCE' | 'LATE_CAPTURE_REVIEW';
export async function handleWebhook(pool: pg.Pool, provider: PaymentProvider, raw: string, signature: string, opts: { now?: Date } = {}): Promise<WebhookOutcome> {
  if (!provider.verifySignature(raw, signature)) throw new DomainError('BAD_SIGNATURE', 'Webhook signature is invalid');
  const ev = provider.parseEvent(raw), now = opts.now ?? new Date();
  return tx(pool, async c => {
    await c.query('SELECT pg_advisory_xact_lock_shared($1)', [LOCK_SHIFT]);          // a shift closure cannot interleave with a capture
    const ins = await c.query('INSERT INTO payment_webhooks (provider, provider_event_id, payload) VALUES ($1,$2,$3) ON CONFLICT (provider, provider_event_id) DO NOTHING RETURNING id', [provider.name, ev.eventId, raw]);
    if (!ins.rowCount) return 'DUPLICATE';
    const done = async (o: WebhookOutcome) => { await c.query('UPDATE payment_webhooks SET outcome=$2 WHERE id=$1', [ins.rows[0].id, o]); return o; };
    const att = (await c.query('SELECT * FROM payment_attempts WHERE provider_order_ref=$1 FOR UPDATE', [ev.providerOrderRef])).rows[0];
    if (!att) return done('UNKNOWN_REFERENCE');
    if (ev.type === 'payment.failed') { await c.query("UPDATE payment_attempts SET status='FAILED' WHERE id=$1 AND status IN ('CREATED','PENDING')", [att.id]); return done('FAILED_RECORDED'); }
    if (att.status === 'CAPTURED') return done('ALREADY_CAPTURED');
    if (ev.currency !== att.currency || ev.amountPaise !== att.amount_paise) {
      await c.query("INSERT INTO notifications (kind, recipient_department, order_id, payload) VALUES ('PAYMENT_ANOMALY','FINANCE',$1,$2)", [att.order_id, JSON.stringify({ expected: att.amount_paise.toString(), got: ev.amountPaise.toString(), currency: ev.currency })]);
      return done('AMOUNT_MISMATCH');
    }
    const o = (await c.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE', [att.order_id])).rows[0];
    const cap = (await c.query('INSERT INTO payment_captures (attempt_id, order_id, provider_txn_ref, amount_paise, captured_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (provider_txn_ref) DO NOTHING RETURNING id', [att.id, o.id, ev.txnRef, ev.amountPaise.toString(), now])).rows[0];
    if (!cap) return done('ALREADY_CAPTURED');
    await c.query("UPDATE payment_attempts SET status='CAPTURED' WHERE id=$1", [att.id]);
    if (o.status !== 'PENDING_PAYMENT') {          // money arrived for an expired/cancelled order: keep the capture, flag it, change nothing else
      await c.query("INSERT INTO notifications (kind, recipient_department, order_id, payload) VALUES ('LATE_CAPTURE','FINANCE',$1,'{}')", [o.id]); return done('LATE_CAPTURE_REVIEW');
    }
    await settlePaidOrder(c, o, now, { type: 'SYSTEM', id: null }, 'payment verified');
    await creditTargets(c, o, ev.amountPaise, 1, `capture:${cap.id}`, 'CREDIT', now);
    return done('CAPTURED');
  });
}

export async function refund(pool: pg.Pool, a: { captureId: string; amountPaise: bigint; kind: 'REFUND' | 'CHARGEBACK'; providerRefundRef: string; reason?: string; now?: Date }) {
  const now = a.now ?? new Date();
  return tx(pool, async c => {
    const cap = (await c.query('SELECT * FROM payment_captures WHERE id=$1 FOR UPDATE', [a.captureId])).rows[0]; if (!cap) throw new DomainError('NOT_FOUND', 'Capture not found');
    const prev = (await c.query('SELECT COALESCE(SUM(amount_paise),0)::bigint AS s FROM refunds WHERE capture_id=$1', [a.captureId])).rows[0].s as bigint;
    if (prev + a.amountPaise > cap.amount_paise) throw new DomainError('REFUND_TOO_LARGE', 'Refunds would exceed the captured amount');
    const ins = await c.query('INSERT INTO refunds (capture_id, order_id, amount_paise, kind, provider_refund_ref, reason) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (provider_refund_ref) DO NOTHING RETURNING id', [a.captureId, cap.order_id, a.amountPaise.toString(), a.kind, a.providerRefundRef, a.reason ?? null]);
    if (!ins.rowCount) return { duplicate: true };
    const o = (await c.query('SELECT id, sales_employee_id, total_paise FROM orders WHERE id=$1', [cap.order_id])).rows[0];
    await creditTargets(c, o, a.amountPaise, -1, `refund:${ins.rows[0].id}`, a.kind === 'CHARGEBACK' ? 'CHARGEBACK_REVERSAL' : 'REFUND_REVERSAL', now);
    return { duplicate: false, refundId: ins.rows[0].id as string };
  });
}

/** Everything that happens when an order becomes fully paid (card/UPI webhook OR Finance-verified manual proof): status, reservation consumed (batch FEFO when tracked), reminders, Logistics alert. */
export async function settlePaidOrder(c: pg.PoolClient, o: { id: string }, now: Date, actor: { type: string; id: string | null }, reason: string) {
  await transition(c, o.id, 'PAID_AWAITING_LOGISTICS', actor, reason); await c.query('UPDATE orders SET paid_at=$2 WHERE id=$1', [o.id, now]);
  const rs = (await c.query("UPDATE inventory_reservations SET status='CONSUMED', settled_at=$2 WHERE order_id=$1 AND status='ACTIVE' RETURNING product_id, qty", [o.id, now])).rows;
  for (const r of rs) await consumeStockForSale(c, r.product_id, r.qty, o.id, now);
  await c.query("INSERT INTO reminder_state (order_id, kind, eligible_at) VALUES ($1,'MISSING_INVOICE',$2), ($1,'MISSING_TRACKING',$3) ON CONFLICT DO NOTHING", [o.id, now, trackingStart(now, TZ)]);
  await c.query("INSERT INTO notifications (kind, recipient_department, order_id) VALUES ('ORDER_PAID','LOGISTICS',$1)", [o.id]);
}
