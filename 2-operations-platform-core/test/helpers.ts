import crypto from 'node:crypto';
import { makePool } from '../src/db.js';
import { createOrder } from '../src/services/orders.js';
import { initiatePayment, handleWebhook, MockProvider } from '../src/services/payments.js';
import { startPacking, packingChecklist, verifyItem, markPacked } from '../src/services/packing.js';
import type { Actor } from '../src/permissions.js';
export const pool = makePool();
export const provider = new MockProvider('whsec_test');
const TABLES = 'notification_deliveries, notifications, reminder_state, tracking_events, shipments, packing_records, shift_overrides, warehouse_shifts, documents, refunds, payment_captures, payment_webhooks, payment_attempts, target_credit_ledger, employee_targets, inventory_reservations, order_freebies, order_items, order_status_history, orders, stock_movements, inventory_balances, freebie_scheme_products, freebie_scheme_dealers, freebie_schemes, dealer_price_rules, dealer_brands, dealer_addresses, dealers, products, employee_brands, employees, brands, audit_logs, sample_order_items, sample_orders, sample_movements, sample_inventory, packing_discrepancies, packing_items, leave_requests, leave_balances, attendance_corrections, shift_sessions, holidays, promotion_redemptions, promotion_products, promotion_dealers, promotions, freebie_exclusions, preorder_items, preorders';
export type Fx = Awaited<ReturnType<typeof fixture>>;
export async function fixture() {
  await pool.query(`TRUNCATE ${TABLES} RESTART IDENTITY CASCADE`);
  const q = async (sql: string, p: unknown[] = []) => (await pool.query(sql, p)).rows[0].id as string;
  const bolt = await q("INSERT INTO brands (code, name) VALUES ('BOLT','BOLT Nutrition') RETURNING id"), ved = await q("INSERT INTO brands (code, name) VALUES ('VED','ved') RETURNING id");
  const emp = (code: string, dept: string) => q('INSERT INTO employees (employee_code, name, email, department_id, status) VALUES ($1,$1,$2,(SELECT id FROM departments WHERE code=$3),\'ACTIVE\') RETURNING id', [code, code.toLowerCase() + '@s-eleven.test', dept]);
  const host = await emp('HOST01', 'HOST'), sales1 = await emp('SAL01', 'SALES'), sales2 = await emp('SAL02', 'SALES'), logi = await emp('LOG01', 'LOGISTICS'), wh = await emp('WH01', 'WAREHOUSE');
  const dealer = (code: string, sales: string | null) => q('INSERT INTO dealers (dealer_code, name, sales_employee_id) VALUES ($1,$1,$2) RETURNING id', [code, sales]);
  const d1 = await dealer('D1', sales1), d2 = await dealer('D2', sales2), d3 = await dealer('D3', null);
  const prod = (sku: string, brand: string, base: number, stock: number) => q('INSERT INTO products (sku, name, brand_id, base_price_paise, gst_rate_bp) VALUES ($1,$1,$2,$3,0) RETURNING id', [sku, brand, base]).then(async id => { await pool.query('INSERT INTO inventory_balances (product_id, on_hand) VALUES ($1,$2)', [id, stock]); return id; });
  const pA = await prod('BOLT-WHEY', bolt, 100000, 1000), pB = await prod('VED-OMEGA', ved, 50000, 1000), pFree = await prod('VED-FREEBIE', ved, 40000, 50), pStock = await prod('BOLT-SCARCE', bolt, 10000, 10);
  return { bolt, ved, host, sales1, sales2, logi, wh, d1, d2, d3, pA, pB, pFree, pStock };
}
let k = 0;
export const place = (dealerId: string, items: { productId: string; qty: number }[], extra: Record<string, unknown> = {}) =>
  createOrder(pool, { dealerId, actor: { type: 'DEALER', id: dealerId }, items, idempotencyKey: 'k' + (++k) + crypto.randomUUID(), ...extra } as any);
export function hook(o: { eventId: string; type: 'payment.captured' | 'payment.failed'; ref: string; txn: string; amountPaise: bigint; currency?: string }) {
  const raw = JSON.stringify({ ...o, amountPaise: o.amountPaise.toString() }); return { raw, sig: provider.sign(raw) };
}
export async function payOrder(orderId: string, opts: { amount?: bigint; now?: Date; type?: 'payment.captured' | 'payment.failed'; key?: string } = {}) {
  const att = await initiatePayment(pool, orderId, provider, opts.key ?? 'idem-' + crypto.randomUUID(), opts.now);
  const h = hook({ eventId: 'evt-' + crypto.randomUUID(), type: opts.type ?? 'payment.captured', ref: att.provider_order_ref, txn: 'txn-' + crypto.randomUUID(), amountPaise: opts.amount ?? att.amount_paise });
  return { outcome: await handleWebhook(pool, provider, h.raw, h.sig, { now: opts.now }), att, ...h };
}
export const sum = async (sql: string, p: unknown[] = []) => (await pool.query(sql, p)).rows[0].s as bigint;

/** Packs an order the proper way: start, verify every line's full quantity, then mark packed. */
export async function packAll(orderId: string, actor: Actor) {
  await startPacking(pool, orderId, actor);
  for (const it of await packingChecklist(pool, orderId)) await verifyItem(pool, { orderId, packingItemId: it.id, verifiedQty: it.required_qty, actor });
  await markPacked(pool, orderId, actor);
}
