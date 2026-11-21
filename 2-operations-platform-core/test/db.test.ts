import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { pool, fixture, place, payOrder, hook, provider, sum, packAll, Fx } from './helpers.js';
import { createOrder, cancelOrder, expireOrders } from '../src/services/orders.js';
import { initiatePayment, handleWebhook, refund } from '../src/services/payments.js';
import { attachInvoice, saveTracking, runReminderTick, runPendingWorkTick, dispatchOrder } from '../src/services/logistics.js';
import { openShift, closeShift, hostOverrideClose, startPacking, markPacked, ShiftBlockedError } from '../src/services/warehouse.js';
import { getOrderFor } from '../src/services/access.js';
import { reconcile } from '../src/services/finance.js';
import { LOCK_SHIFT } from '../src/db.js';
import type { Actor } from '../src/permissions.js';

let f: Fx; const code = (c: string) => (e: any) => e?.code === c;
const bal = async (pid: string) => (await pool.query('SELECT on_hand, reserved FROM inventory_balances WHERE product_id=$1', [pid])).rows[0];
const ledger = async (emp?: string) => (await pool.query('SELECT b.code AS brand, l.amount_paise, l.kind FROM target_credit_ledger l JOIN brands b ON b.id=l.brand_id WHERE ($1::uuid IS NULL OR l.employee_id=$1) ORDER BY l.kind, b.code', [emp ?? null])).rows;
const pdf = (orderId: string, employeeId: string) => attachInvoice(pool, { orderId, employeeId, filename: 'inv.pdf', contentType: 'application/pdf', sizeBytes: 1000, sha256: 'x'.repeat(64), storageKey: 'k/' + orderId });
const A = (id: string, role: Actor['role']): Actor => ({ type: role === 'DEALER' ? 'DEALER' : 'EMPLOYEE', id, role });
before(() => pool.query('SELECT 1')); after(() => pool.end()); beforeEach(async () => { f = await fixture(); });

describe('2. server-side pricing', () => {
  it('ignores any price sent by the client and snapshots the real one; fixed rate wins', async () => {
    await pool.query('INSERT INTO dealer_price_rules (dealer_id, discount_bp) VALUES ($1,1500)', [f.d1]);
    const r = await place(f.d1, [{ productId: f.pA, qty: 2, unitPricePaise: 1n, discountBp: 9999 } as any]);
    let it = (await pool.query('SELECT unit_price_paise, price_source, discount_bp FROM order_items WHERE order_id=$1', [r.orderId])).rows[0];
    assert.equal(it.unit_price_paise, 85000n); assert.equal(it.price_source, 'PERCENT');
    await pool.query('INSERT INTO dealer_price_rules (dealer_id, product_id, fixed_price_paise) VALUES ($1,$2,80000)', [f.d1, f.pA]);
    const r2 = await place(f.d1, [{ productId: f.pA, qty: 1 }]); it = (await pool.query('SELECT unit_price_paise, price_source FROM order_items WHERE order_id=$1', [r2.orderId])).rows[0];
    assert.equal(it.unit_price_paise, 80000n); assert.equal(it.price_source, 'FIXED');
    assert.ok((await pool.query("SELECT 1 FROM audit_logs WHERE action LIKE 'PRICE_RULE_%'")).rowCount! >= 2, 'pricing changes are audited');
  });
  it('order items are immutable snapshots', async () => { const r = await place(f.d1, [{ productId: f.pA, qty: 1 }]); await assert.rejects(pool.query('UPDATE order_items SET unit_price_paise=1 WHERE order_id=$1', [r.orderId]), /append-only/); await assert.rejects(pool.query('DELETE FROM order_items WHERE order_id=$1', [r.orderId]), /append-only/); });
  it('duplicate submissions with the same idempotency key create ONE order and ONE reservation', async () => {
    const a = await createOrder(pool, { dealerId: f.d1, actor: { type: 'DEALER', id: f.d1 }, items: [{ productId: f.pA, qty: 3 }], idempotencyKey: 'same' });
    const b = await createOrder(pool, { dealerId: f.d1, actor: { type: 'DEALER', id: f.d1 }, items: [{ productId: f.pA, qty: 3 }], idempotencyKey: 'same' });
    assert.equal(b.duplicate, true); assert.equal(a.orderId, b.orderId); assert.equal((await bal(f.pA)).reserved, 3);
  });
});
describe('4. freebies', () => {
  let sp: string;
  beforeEach(async () => {
    const s = (await pool.query("INSERT INTO freebie_schemes (name, starts_at, ends_at) VALUES ('Diwali', now() - interval '1 day', now() + interval '30 days') RETURNING id")).rows[0].id;
    await pool.query('INSERT INTO freebie_scheme_dealers VALUES ($1,$2)', [s, f.d1]);
    sp = (await pool.query('INSERT INTO freebie_scheme_products (scheme_id, product_id, valuation_paise, max_qty_per_order) VALUES ($1,$2,15000,5) RETURNING id', [s, f.pFree])).rows[0].id;
  });
  const ten = (fb: number) => ({ items: [{ productId: f.pA, qty: 10 }], freebies: [{ schemeProductId: sp, qty: fb }] });
  it('allowance is a maximum, remaining is reported, and the payable amount does not increase', async () => {
    const r = await place(f.d1, ten(3).items, { freebies: ten(3).freebies }) as any;
    assert.equal(r.allowancePaise, 50000n); assert.equal(r.freebieValuePaise, 45000n); assert.equal(r.totalPaise, 1000000n);
  });
  it('rejects selections above the allowance, above stock, and for dealers who are not eligible', async () => {
    await assert.rejects(place(f.d1, ten(5).items, { freebies: ten(5).freebies }), code('FREEBIE_ALLOWANCE_EXCEEDED'));
    await pool.query('UPDATE inventory_balances SET on_hand=2 WHERE product_id=$1', [f.pFree]);
    await assert.rejects(place(f.d1, ten(3).items, { freebies: ten(3).freebies }), code('INSUFFICIENT_STOCK'));
    await assert.rejects(place(f.d2, ten(1).items, { freebies: ten(1).freebies }), code('FREEBIE_NOT_ELIGIBLE'));
    await assert.rejects(place(f.d1, [{ productId: f.pA, qty: 1 }], { freebies: [{ schemeProductId: sp, qty: 1 }] }), code('FREEBIE_ALLOWANCE_EXCEEDED'));   // cart below the first slab -> allowance 0
    assert.equal((await bal(f.pFree)).reserved, 0, 'a rejected order reserves nothing');
  });
});
describe('5/10. inventory', () => {
  it('20 concurrent orders for 10 units: exactly 10 succeed, none oversell', async () => {
    const res = await Promise.allSettled(Array.from({ length: 20 }, () => place(f.d1, [{ productId: f.pStock, qty: 1 }])));
    const ok = res.filter(r => r.status === 'fulfilled').length, bad = res.filter(r => r.status === 'rejected' && (r as any).reason.code === 'INSUFFICIENT_STOCK').length;
    assert.equal(ok, 10); assert.equal(bad, 10); const b = await bal(f.pStock); assert.equal(b.reserved, 10); assert.equal(b.on_hand, 10);
  });
  it('reservations are released once on expiry and once on cancellation', async () => {
    const now = new Date(), r = await place(f.d1, [{ productId: f.pStock, qty: 4 }], { now, ttlMinutes: 1 }); assert.equal((await bal(f.pStock)).reserved, 4);
    assert.equal(await expireOrders(pool, new Date(now.getTime() + 2 * 60000)), 1); assert.equal(await expireOrders(pool, new Date(now.getTime() + 3 * 60000)), 0);
    assert.equal((await bal(f.pStock)).reserved, 0); assert.equal((await pool.query('SELECT status FROM orders WHERE id=$1', [r.orderId])).rows[0].status, 'EXPIRED');
    const r2 = await place(f.d1, [{ productId: f.pStock, qty: 3 }]); await cancelOrder(pool, r2.orderId, { type: 'DEALER', id: f.d1 }, 'changed mind');
    await assert.rejects(cancelOrder(pool, r2.orderId, { type: 'DEALER', id: f.d1 }, 'again'), code('INVALID_TRANSITION')); assert.equal((await bal(f.pStock)).reserved, 0);
  });
});
describe('6/7/8/9/16. payments and sales-target ledger', () => {
  const sixFour = (d: string) => place(d, [{ productId: f.pA, qty: 6 }, { productId: f.pB, qty: 8 }]);   // BOLT 6,000 + VED 4,000
  it('a failed payment credits nothing; a later successful one credits the right employee exactly once', async () => {
    const r = await sixFour(f.d1); const bad = await payOrder(r.orderId, { type: 'payment.failed' }); assert.equal(bad.outcome, 'FAILED_RECORDED');
    assert.equal((await ledger()).length, 0); assert.equal((await pool.query('SELECT status FROM orders WHERE id=$1', [r.orderId])).rows[0].status, 'PENDING_PAYMENT');
    const ok = await payOrder(r.orderId); assert.equal(ok.outcome, 'CAPTURED');
    const l = await ledger(f.sales1); assert.deepEqual(l.map(x => [x.brand, x.amount_paise]), [['BOLT', 600000n], ['VED', 400000n]]); assert.equal((await ledger(f.sales2)).length, 0);
    const b = await bal(f.pA); assert.equal(b.on_hand, 994); assert.equal(b.reserved, 0);
  });
  it('duplicate webhooks (same event, or same transaction) have no second effect', async () => {
    const r = await sixFour(f.d1); const p = await payOrder(r.orderId); assert.equal(p.outcome, 'CAPTURED');
    assert.equal(await handleWebhook(pool, provider, p.raw, p.sig), 'DUPLICATE');
    const again = hook({ eventId: 'evt-other', type: 'payment.captured', ref: p.att.provider_order_ref, txn: 'txn-x', amountPaise: p.att.amount_paise }); assert.equal(await handleWebhook(pool, provider, again.raw, again.sig), 'ALREADY_CAPTURED');
    assert.equal((await ledger()).length, 2); assert.equal((await bal(f.pA)).on_hand, 994); assert.equal((await pool.query('SELECT count(*)::int AS n FROM payment_captures')).rows[0].n, 1);
  });
  it('rejects bad signatures and wrong amounts; nothing is credited', async () => {
    const r = await sixFour(f.d1); const att = await initiatePayment(pool, r.orderId, provider, 'i1');
    const h = hook({ eventId: 'e1', type: 'payment.captured', ref: att.provider_order_ref, txn: 't1', amountPaise: att.amount_paise });
    await assert.rejects(handleWebhook(pool, provider, h.raw, 'deadbeef'), code('BAD_SIGNATURE'));
    const w = hook({ eventId: 'e2', type: 'payment.captured', ref: att.provider_order_ref, txn: 't2', amountPaise: 1000n }); assert.equal(await handleWebhook(pool, provider, w.raw, w.sig), 'AMOUNT_MISMATCH');
    const c = hook({ eventId: 'e3', type: 'payment.captured', ref: att.provider_order_ref, txn: 't3', amountPaise: att.amount_paise, currency: 'USD' }); assert.equal(await handleWebhook(pool, provider, c.raw, c.sig), 'AMOUNT_MISMATCH');
    assert.equal((await ledger()).length, 0); assert.equal((await pool.query('SELECT status FROM orders WHERE id=$1', [r.orderId])).rows[0].status, 'PENDING_PAYMENT'); assert.equal((await pool.query("SELECT 1 FROM notifications WHERE kind='PAYMENT_ANOMALY'")).rowCount, 2);
  });
  it('multi-brand allocation reconciles to the paisa with awkward amounts', async () => {
    await pool.query('INSERT INTO dealer_price_rules (dealer_id, discount_bp) VALUES ($1,333)', [f.d1]);
    const r = await place(f.d1, [{ productId: f.pA, qty: 3 }, { productId: f.pB, qty: 7 }]); await payOrder(r.orderId);
    assert.equal(await sum('SELECT SUM(amount_paise)::bigint AS s FROM target_credit_ledger'), r.totalPaise);
    const rows = await ledger(); assert.deepEqual(rows.map(x => x.amount_paise), [290010n, 338345n]);
  });
  it('refunds and chargebacks create compensating negative entries in the original proportions', async () => {
    const r = await sixFour(f.d1); const p = await payOrder(r.orderId); const cap = (await pool.query('SELECT id FROM payment_captures')).rows[0].id;
    await refund(pool, { captureId: cap, amountPaise: 100000n, kind: 'REFUND', providerRefundRef: 'rf1' });
    assert.equal((await refund(pool, { captureId: cap, amountPaise: 100000n, kind: 'REFUND', providerRefundRef: 'rf1' })).duplicate, true);
    await refund(pool, { captureId: cap, amountPaise: 50001n, kind: 'CHARGEBACK', providerRefundRef: 'cb1' });
    const neg = (await ledger()).filter(x => x.amount_paise < 0n); assert.deepEqual(neg.map(x => [x.brand, x.kind, x.amount_paise]), [['BOLT', 'CHARGEBACK_REVERSAL', -30001n], ['VED', 'CHARGEBACK_REVERSAL', -20000n], ['BOLT', 'REFUND_REVERSAL', -60000n], ['VED', 'REFUND_REVERSAL', -40000n]]);
    assert.equal(await sum('SELECT SUM(amount_paise)::bigint AS s FROM target_credit_ledger'), 1000000n - 100000n - 50001n);
    await assert.rejects(refund(pool, { captureId: cap, amountPaise: 900000n, kind: 'REFUND', providerRefundRef: 'rf2' }), code('REFUND_TOO_LARGE'));
    await assert.rejects(pool.query('UPDATE target_credit_ledger SET amount_paise=1'), /append-only/); await assert.rejects(pool.query('DELETE FROM target_credit_ledger'), /append-only/); void p;
  });
  it('a dealer with no assigned Sales employee is flagged for manual attribution, never credited to someone else', async () => {
    const r = await place(f.d3, [{ productId: f.pA, qty: 1 }]); await payOrder(r.orderId);
    assert.equal((await ledger()).length, 0); assert.equal((await pool.query('SELECT needs_manual_attribution AS m FROM orders WHERE id=$1', [r.orderId])).rows[0].m, true);
  });
  it('money arriving for an expired order is kept, flagged for Finance, and changes nothing else', async () => {
    const now = new Date(), r = await place(f.d1, [{ productId: f.pA, qty: 1 }], { now, ttlMinutes: 1 }); const att = await initiatePayment(pool, r.orderId, provider, 'late', now);
    await expireOrders(pool, new Date(now.getTime() + 120000)); const h = hook({ eventId: 'late1', type: 'payment.captured', ref: att.provider_order_ref, txn: 'late-txn', amountPaise: att.amount_paise });
    assert.equal(await handleWebhook(pool, provider, h.raw, h.sig), 'LATE_CAPTURE_REVIEW'); assert.equal((await ledger()).length, 0); assert.equal((await bal(f.pA)).reserved, 0); assert.equal((await pool.query("SELECT 1 FROM notifications WHERE kind='LATE_CAPTURE'")).rowCount, 1);
  });
  it('target credit excludes GST: with 5% GST-inclusive prices, only the tax-free merchandise value is credited', async () => {
    await pool.query('UPDATE products SET gst_rate_bp=500 WHERE id=$1', [f.pA]);
    const r = await place(f.d1, [{ productId: f.pA, qty: 1 }]); await payOrder(r.orderId);
    const it = (await pool.query('SELECT line_total_paise, tax_paise, eligible_paise FROM order_items WHERE order_id=$1', [r.orderId])).rows[0];
    assert.deepEqual([it.line_total_paise, it.tax_paise, it.eligible_paise], [100000n, 4762n, 95238n]);
    assert.equal(await sum('SELECT SUM(amount_paise)::bigint AS s FROM target_credit_ledger'), 95238n);
  });
  it('18. finance reconciliation ties payments to the target ledger', async () => {
    for (const d of [f.d1, f.d2]) { const r = await sixFour(d); await payOrder(r.orderId); }
    const cap = (await pool.query('SELECT id FROM payment_captures LIMIT 1')).rows[0].id; await refund(pool, { captureId: cap, amountPaise: 12345n, kind: 'REFUND', providerRefundRef: 'r-odd' });
    const rc = await reconcile(pool); assert.equal(rc.capturedPaise, 2000000n); assert.equal(rc.netCollectedPaise, 2000000n - 12345n); assert.equal(rc.ledgerMatches, true); assert.equal(rc.ok, true);
  });
});
describe('11/12. reminder worker (durable, idempotent, time-injected)', () => {
  it('invoice reminders: every 15 minutes, never twice per slot, stop when the invoice is attached', async () => {
    const t0 = new Date('2026-10-19T10:00:00Z'), m = (n: number) => new Date(t0.getTime() + n * 60000); const r = await place(f.d1, [{ productId: f.pA, qty: 1 }], { now: t0 }); await payOrder(r.orderId, { now: t0 });
    assert.equal((await runReminderTick(pool, m(14))).invoice, 0); assert.equal((await runReminderTick(pool, m(15))).invoice, 1); assert.equal((await runReminderTick(pool, m(16))).invoice, 0);
    assert.equal((await runReminderTick(pool, m(30))).invoice, 1); await Promise.all([runReminderTick(pool, m(45)), runReminderTick(pool, m(45))]);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM notifications WHERE kind='MISSING_INVOICE'")).rows[0].n, 3, 'two parallel workers still produce one reminder');
    await assert.rejects(attachInvoice(pool, { orderId: r.orderId, employeeId: f.logi, filename: 'x.png', contentType: 'image/png', sizeBytes: 5, sha256: 'a', storageKey: 'k' }), code('BAD_FILE_TYPE'));
    await pdf(r.orderId, f.logi); assert.equal((await runReminderTick(pool, m(60))).invoice, 0); assert.equal((await pool.query('SELECT status FROM orders WHERE id=$1', [r.orderId])).rows[0].status, 'AWAITING_WAREHOUSE');
    await pdf(r.orderId, f.logi); assert.equal((await pool.query("SELECT count(*)::int AS n FROM documents WHERE order_id=$1 AND is_current", [r.orderId])).rows[0].n, 1, 'versioned: one current document');
  });
  it('tracking reminders start 10:00 IST the next day, repeat every 15 minutes and stop when tracking is saved', async () => {
    const paid = new Date('2026-10-19T18:00:00Z'), start = new Date('2026-10-20T04:30:00Z'); const r = await place(f.d1, [{ productId: f.pA, qty: 1 }], { now: paid }); await payOrder(r.orderId, { now: paid }); await pdf(r.orderId, f.logi);
    assert.equal((await runReminderTick(pool, new Date(start.getTime() - 60000))).tracking, 0); assert.equal((await runReminderTick(pool, start)).tracking, 1); assert.equal((await runReminderTick(pool, new Date(start.getTime() + 14 * 60000))).tracking, 0);
    assert.equal((await runReminderTick(pool, new Date(start.getTime() + 15 * 60000))).tracking, 1); await saveTracking(pool, { orderId: r.orderId, employeeId: f.logi, courier: 'Delhivery', trackingNumber: 'DL123' });
    assert.equal((await runReminderTick(pool, new Date(start.getTime() + 30 * 60000))).tracking, 0);
    const r2 = await place(f.d1, [{ productId: f.pA, qty: 1 }], { now: paid }); await payOrder(r2.orderId, { now: paid }); await cancelOrder(pool, r2.orderId, { type: 'EMPLOYEE', id: f.host }, 'test');
    assert.equal((await runReminderTick(pool, new Date(start.getTime() + 45 * 60000))).tracking, 0, 'cancelled orders get no reminders');
  });
});
describe('14/15. warehouse shift: company-wide restriction + Host override', () => {
  const mgr = () => A(f.wh, 'WAREHOUSE'), host = () => A(f.host, 'HOST');
  const paidReady = async (dealer: string) => { const r = await place(dealer, [{ productId: f.pA, qty: 1 }]); await payOrder(r.orderId); await pdf(r.orderId, f.logi); return r.orderId; };
  it('cannot close while ANY company order is unpacked (even another dealer\'s); closes once all are packed', async () => {
    const shift = await openShift(pool, mgr()); await assert.rejects(openShift(pool, mgr()), code('SHIFT_ALREADY_OPEN'));
    const o1 = await paidReady(f.d1), o2 = await paidReady(f.d2);
    await assert.rejects(closeShift(pool, shift, mgr()), (e: any) => e instanceof ShiftBlockedError && e.blockers.length === 2);
    await assert.rejects(markPacked(pool, o1, mgr()), code('INVALID_TRANSITION'));                       // must start packing first
    await packAll(o1, mgr());
    await assert.rejects(closeShift(pool, shift, mgr()), (e: any) => e instanceof ShiftBlockedError && e.blockers.length === 1 && e.blockers[0].id === o2);
    await packAll(o2, mgr()); assert.deepEqual(await closeShift(pool, shift, mgr()), { closed: true });
    assert.equal((await pool.query('SELECT status FROM warehouse_shifts WHERE id=$1', [shift])).rows[0].status, 'CLOSED');
  });
  it('an order that becomes payable while a closure is in progress cannot slip past the check', async () => {
    const shift = await openShift(pool, mgr()); const pending = await place(f.d1, [{ productId: f.pA, qty: 1 }]);
    const c = await pool.connect(); await c.query('BEGIN'); await c.query('SELECT pg_advisory_xact_lock_shared($1)', [LOCK_SHIFT]);                 // an in-flight payment capture
    await c.query("UPDATE orders SET status='PAID_AWAITING_LOGISTICS' WHERE id=$1", [pending.orderId]);
    let settled = false; const closing = closeShift(pool, shift, mgr()).then(() => { settled = true; return 'closed'; }, e => { settled = true; return e; });
    await new Promise(r => setTimeout(r, 400)); assert.equal(settled, false, 'closure waits for the in-flight capture'); await c.query('COMMIT'); c.release();
    const res: any = await closing; assert.ok(res instanceof ShiftBlockedError); assert.equal(res.blockers[0].id, pending.orderId);
  });
  it('only the Host can override, a reason is mandatory, and the override is fully recorded', async () => {
    const shift = await openShift(pool, mgr()); const o1 = await paidReady(f.d1);
    await assert.rejects(hostOverrideClose(pool, shift, mgr(), 'manager trying to bypass the rule'), code('FORBIDDEN'));
    await assert.rejects(hostOverrideClose(pool, shift, host(), 'short'), code('REASON_REQUIRED'));
    assert.deepEqual(await hostOverrideClose(pool, shift, host(), 'Power cut at warehouse, packing resumes tomorrow'), { closed: true, overridden: 1 });
    const s = (await pool.query('SELECT status, close_kind FROM warehouse_shifts WHERE id=$1', [shift])).rows[0]; assert.deepEqual(s, { status: 'CLOSED', close_kind: 'HOST_OVERRIDE' });
    const ov = (await pool.query('SELECT host_id, reason, blocking_orders FROM shift_overrides WHERE shift_id=$1', [shift])).rows[0]; assert.equal(ov.host_id, f.host); assert.equal(ov.blocking_orders[0].id, o1);
    assert.equal((await pool.query("SELECT 1 FROM audit_logs WHERE action='SHIFT_OVERRIDE'")).rowCount, 1); await assert.rejects(pool.query('UPDATE shift_overrides SET reason=$1', ['edited after the fact!']), /append-only/);
  });
});
describe('19. pending-work reminders every 30 minutes (Warehouse + Logistics)', () => {
  it('not-packed orders remind once per 30-minute slot; packed orders then remind Logistics to dispatch; nothing once shipped', async () => {
    const t0 = new Date('2026-10-19T10:00:00Z'), m = (n: number) => new Date(t0.getTime() + n * 60000), wh = A(f.wh, 'WAREHOUSE');
    const r = await place(f.d1, [{ productId: f.pA, qty: 1 }], { now: t0 }); await payOrder(r.orderId, { now: t0 }); await pdf(r.orderId, f.logi);
    assert.deepEqual(await runPendingWorkTick(pool, m(1)), { notPacked: 1, readyToDispatch: 0 });
    assert.deepEqual(await runPendingWorkTick(pool, m(10)), { notPacked: 0, readyToDispatch: 0 }, 'same slot: no duplicate');
    const par = await Promise.all([runPendingWorkTick(pool, m(31)), runPendingWorkTick(pool, m(31))]); assert.equal(par[0].notPacked + par[1].notPacked, 1, 'two parallel workers still send one');
    await packAll(r.orderId, wh);
    assert.deepEqual(await runPendingWorkTick(pool, m(62)), { notPacked: 0, readyToDispatch: 1 });
    assert.deepEqual(await runPendingWorkTick(pool, m(70)), { notPacked: 0, readyToDispatch: 0 });
    await saveTracking(pool, { orderId: r.orderId, employeeId: f.logi, courier: 'DTDC', trackingNumber: 'T1' });
    await pool.query("UPDATE orders SET status='READY_FOR_DISPATCH' WHERE id=$1", [r.orderId]); await dispatchOrder(pool, r.orderId, f.logi);
    assert.deepEqual(await runPendingWorkTick(pool, m(95)), { notPacked: 0, readyToDispatch: 0 }, 'shipped orders stop reminders');
  });
});
describe('17. access control on the server', () => {
  it('dealers see only their own orders; Logistics only paid ones; Sales only their dealers; Finance everything', async () => {
    const r1 = await place(f.d1, [{ productId: f.pA, qty: 1 }]);
    assert.ok(await getOrderFor(pool, A(f.d1, 'DEALER'), r1.orderId)); assert.equal(await getOrderFor(pool, A(f.d2, 'DEALER'), r1.orderId), null);
    assert.equal(await getOrderFor(pool, A(f.logi, 'LOGISTICS'), r1.orderId), null, 'unpaid orders are invisible to Logistics'); await payOrder(r1.orderId);
    assert.ok(await getOrderFor(pool, A(f.logi, 'LOGISTICS'), r1.orderId)); assert.ok(await getOrderFor(pool, A(f.sales1, 'SALES'), r1.orderId)); assert.equal(await getOrderFor(pool, A(f.sales2, 'SALES'), r1.orderId), null);
    assert.ok(await getOrderFor(pool, A(f.host, 'HOST'), r1.orderId)); assert.equal(await getOrderFor(pool, A(f.wh, 'FINANCE'), r1.orderId) !== null, true);
  });
});
