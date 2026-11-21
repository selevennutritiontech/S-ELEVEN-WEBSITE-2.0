import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pool, fixture, place, payOrder, packAll, Fx } from './helpers.js';
import type { Actor } from '../src/permissions.js';
import { createOrder, expireOrders } from '../src/services/orders.js';
import { receiveStock, adjustStock, availability } from '../src/services/inventory.js';
import { createPreorder, syncPreorders, preorderReminderTick } from '../src/services/preorders.js';
import { clockIn, clockOut, flagMissingClockOuts, monthlyAttendance, requestCorrection, approveCorrection } from '../src/services/attendance.js';
import { computeDay } from '../src/attendance.js';
import { requestLeave, approveLeave, cancelApprovedLeave, listLeaveRequests, leaveBalance, rolloverBalances } from '../src/services/hr.js';
import { startPacking, packingChecklist, verifyItem, reportDiscrepancy, resolveDiscrepancy, markPacked } from '../src/services/packing.js';
import { createSampleOrder, approveSample, receiveSampleStock, advanceSample } from '../src/services/samples.js';
import { dealerContext, warehouseStaffStatus } from '../src/services/context.js';
import { openShift } from '../src/services/warehouse.js';

let f: Fx; const code = (c: string) => (e: any) => e?.code === c;
const A = (id: string, role: Actor['role']): Actor => ({ type: role === 'DEALER' ? 'DEALER' : 'EMPLOYEE', id, role });
const emp = async (c: string, dept: string, des?: string) => (await pool.query("INSERT INTO employees (employee_code, name, email, department_id, designation, status) VALUES ($1,$1,$2,(SELECT id FROM departments WHERE code=$3),$4,'ACTIVE') RETURNING id", [c, c.toLowerCase() + '@s-eleven.test', dept, des ?? null])).rows[0].id as string;
const prod = async (sku: string, brand: string, base: number, stock: number, pre = false) => { const id = (await pool.query('INSERT INTO products (sku,name,brand_id,base_price_paise,gst_rate_bp,allow_preorder) VALUES ($1,$1,$2,$3,0,$4) RETURNING id', [sku, brand, base, pre])).rows[0].id as string; await pool.query('INSERT INTO inventory_balances (product_id,on_hand) VALUES ($1,$2)', [id, stock]); return id; };
const promo = async (o: any) => { const r = (await pool.query(`INSERT INTO promotions (code,name,kind,percent_bp,fixed_paise,min_order_paise,starts_at,ends_at,max_uses,max_uses_per_dealer,brand_id,all_dealers,exclude_freebies) VALUES ($1,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
  [o.code, o.kind, o.pct ?? null, o.fixed ?? null, o.min ?? 0, o.from ?? new Date(Date.now() - 864e5), o.to ?? new Date(Date.now() + 864e7), o.max ?? null, o.maxDealer ?? null, o.brand ?? null, o.all ?? true, o.exclude ?? null])).rows[0].id as string;
  for (const p of o.required ?? []) await pool.query("INSERT INTO promotion_products VALUES ($1,$2,'REQUIRED',$3)", [r, p, 1]); for (const p of o.eligible ?? []) await pool.query("INSERT INTO promotion_products VALUES ($1,$2,'ELIGIBLE',1)", [r, p]); for (const d of o.dealers ?? []) await pool.query('INSERT INTO promotion_dealers VALUES ($1,$2)', [r, d]); return r; };
const ledgerSum = async () => (await pool.query('SELECT COALESCE(SUM(amount_paise),0)::bigint AS s FROM target_credit_ledger')).rows[0].s as bigint;
before(() => pool.query('SELECT 1')); after(() => pool.end()); beforeEach(async () => { f = await fixture(); await pool.query('TRUNCATE holidays'); });

describe('1/2. Host create order, dealer context, warehouse staff status', () => {
  it('a Host-created order keeps the dealer\'s Sales attribution; unassigned dealers are flagged, never credited', async () => {
    const host = { type: 'EMPLOYEE' as const, id: f.host, role: 'HOST' };
    const r = await createOrder(pool, { dealerId: f.d1, actor: host, items: [{ productId: f.pA, qty: 1 }], idempotencyKey: 'h1' });
    const o = (await pool.query('SELECT sales_employee_id, created_by_employee_id, created_by_role FROM orders WHERE id=$1', [r.orderId])).rows[0]; assert.deepEqual([o.sales_employee_id, o.created_by_employee_id, o.created_by_role], [f.sales1, f.host, 'HOST']);
    const r3 = await createOrder(pool, { dealerId: f.d3, actor: host, items: [{ productId: f.pA, qty: 1 }], idempotencyKey: 'h3' }); assert.equal((r3 as any).needsManualAttribution, true);
    await payOrder(r.orderId); await payOrder(r3.orderId); assert.equal((await pool.query('SELECT DISTINCT employee_id FROM target_credit_ledger')).rows.length, 1, 'only the assigned employee was credited');
  });
  it('dealer context finds the assigned Sales employee automatically and pages the order history', async () => {
    for (let i = 0; i < 3; i++) await place(f.d1, [{ productId: f.pA, qty: 1 }]);
    const c1 = await dealerContext(pool, A(f.host, 'HOST'), f.d1, { limit: 2, offset: 0 }), c2 = await dealerContext(pool, A(f.host, 'HOST'), f.d1, { limit: 2, offset: 2 });
    assert.equal(c1.salesEmployee?.code, 'SAL01'); assert.equal(c1.history.total, 3); assert.equal(c1.history.orders.length, 2); assert.equal(c2.history.orders.length, 1);
    assert.equal((await dealerContext(pool, A(f.host, 'HOST'), f.d3)).needsAttributionResolution, true);
    await assert.rejects(dealerContext(pool, A(f.d2, 'DEALER'), f.d1), code('FORBIDDEN'));
  });
  it('Host warehouse view comes from persistent attendance and shift records', async () => {
    const wh2 = await emp('WH02', 'WAREHOUSE', 'Packer'); await pool.query("UPDATE employees SET designation='Warehouse Manager' WHERE id=$1", [f.wh]); const t = new Date('2026-10-19T04:10:00Z');
    await clockIn(pool, A(f.wh, 'WAREHOUSE'), t); await openShift(pool, A(f.wh, 'WAREHOUSE')); const o = await place(f.d1, [{ productId: f.pA, qty: 1 }]); await payOrder(o.orderId);
    const st = await warehouseStaffStatus(pool, new Date('2026-10-19T06:00:00Z')); const m = st.find(x => x.employeeCode === 'WH01')!, p = st.find(x => x.employeeCode === 'WH02')!;
    assert.deepEqual([m.attendance, m.warehouseShift, m.designation, m.pendingWarehouseOrders], ['CLOCKED_IN', 'OPEN', 'Warehouse Manager', 1]); assert.equal(m.shiftStart?.toISOString(), t.toISOString()); assert.ok(m.lastActivity);
    assert.deepEqual([p.attendance, p.warehouseShift, p.shiftStart], ['NOT_STARTED', 'CLOSED', null]); void wh2;
  });
});
describe('3. shared inventory with permissions and a full ledger', () => {
  it('everyone sees the same availability; only Logistics/Warehouse edit; Host edits need a reason and are audited', async () => {
    const av = await availability(pool, [f.pA]); assert.equal(av[f.pA].available, 1000);
    await assert.rejects(receiveStock(pool, { productId: f.pA, qty: 5, actor: A(f.sales1, 'SALES') }), code('FORBIDDEN'));
    const r = await receiveStock(pool, { productId: f.pA, qty: 5, actor: A(f.logi, 'LOGISTICS'), reason: 'PO 123', ref: 'PO-123' }); assert.deepEqual([r.before, r.after], [1000, 1005]);
    const m = (await pool.query("SELECT qty_before, qty_after, actor_id, reason FROM stock_movements WHERE kind='RECEIPT'")).rows[0]; assert.deepEqual([m.qty_before, m.qty_after, m.actor_id, m.reason], [1000, 1005, f.logi, 'PO 123']);
    await adjustStock(pool, { productId: f.pA, newOnHand: 1000, actor: A(f.wh, 'WAREHOUSE'), reason: 'cycle count' });
    await assert.rejects(adjustStock(pool, { productId: f.pA, newOnHand: 900, actor: A(f.host, 'HOST'), reason: 'fix the count please' }), code('OVERRIDE_REQUIRED'));
    await adjustStock(pool, { productId: f.pA, newOnHand: 900, actor: A(f.host, 'HOST'), reason: 'audited correction after recount', hostOverride: true });
    assert.equal((await pool.query("SELECT 1 FROM audit_logs WHERE action='INVENTORY_HOST_OVERRIDE'")).rowCount, 1);
    await assert.rejects(adjustStock(pool, { productId: f.pA, newOnHand: -3, actor: A(f.wh, 'WAREHOUSE'), reason: 'bad count' }), code('NEGATIVE_STOCK')); assert.equal((await pool.query("SELECT 1 FROM notifications WHERE kind='INVENTORY_DISCREPANCY'")).rowCount, 1);
    await place(f.d1, [{ productId: f.pStock, qty: 4 }]); await assert.rejects(adjustStock(pool, { productId: f.pStock, newOnHand: 2, actor: A(f.wh, 'WAREHOUSE'), reason: 'recount' }), code('BELOW_RESERVED'));
  });
});
describe('5/6/16. preorders: pay later', () => {
  let pP: string; const t0 = new Date('2026-10-19T10:00:00Z'), m = (n: number) => new Date(t0.getTime() + n * 60000);
  beforeEach(async () => { pP = await prod('PRE-WHEY', f.bolt, 100000, 0, true); });
  const pre = (dealer: string, qty: number, now: Date) => createPreorder(pool, { dealerId: dealer, actor: A(dealer, 'DEALER'), items: [{ productId: pP, qty }], idempotencyKey: 'pre' + dealer + qty + now.getTime(), now });
  it('allocates stock to the OLDEST preorder first, notifies the dealer, and credits nothing until payment is verified', async () => {
    await pool.query("INSERT INTO dealer_price_rules (dealer_id, discount_bp, effective_from) VALUES ($1,1000,'2026-01-01')", [f.d1]);
    await assert.rejects(createPreorder(pool, { dealerId: f.d1, actor: A(f.d1, 'DEALER'), items: [{ productId: f.pA, qty: 1 }], idempotencyKey: 'x' }), code('PREORDER_NOT_ALLOWED'));
    const a = await pre(f.d1, 5, m(0)), b = await pre(f.d2, 5, m(1)); assert.equal((await createPreorder(pool, { dealerId: f.d1, actor: A(f.d1, 'DEALER'), items: [{ productId: pP, qty: 5 }], idempotencyKey: 'pre' + f.d1 + 5 + m(0).getTime(), now: m(0) })).duplicate, true);
    const r = await receiveStock(pool, { productId: pP, qty: 6, actor: A(f.logi, 'LOGISTICS'), now: m(30) }); assert.equal(r.preordersAllocated, 1);
    const st = (await pool.query('SELECT preorder_number, status, order_id FROM preorders ORDER BY created_at')).rows; assert.deepEqual(st.map(x => x.status), ['ALLOCATED', 'WAITING_STOCK']); assert.ok(a.number < b.number);
    assert.equal((await pool.query("SELECT 1 FROM notifications WHERE kind='PREORDER_STOCK_READY' AND recipient_dealer_id=$1", [f.d1])).rowCount, 1); assert.equal((await pool.query("SELECT 1 FROM notifications WHERE kind='PREORDER_ALLOCATED' AND recipient_employee_id=$1", [f.sales1])).rowCount, 1);
    const oid = st[0].order_id; assert.equal((await pool.query('SELECT unit_price_paise FROM order_items WHERE order_id=$1', [oid])).rows[0].unit_price_paise, 90000n, 'price snapshotted at preorder time');
    await pool.query("INSERT INTO dealer_price_rules (dealer_id, discount_bp, effective_from) VALUES ($1,5000,'2026-01-01')", [f.d1]); assert.equal(await ledgerSum(), 0n, 'no target credit before payment');
    await payOrder(oid, { now: m(40) }); assert.equal(await ledgerSum(), 450000n); assert.equal((await syncPreorders(pool, m(41))).paid, 1);
  });
  it('an expired allocation releases the stock to the next waiting preorder', async () => {
    await pre(f.d1, 5, m(0)); await pre(f.d2, 5, m(1)); await receiveStock(pool, { productId: pP, qty: 5, actor: A(f.logi, 'LOGISTICS'), now: m(10) });
    assert.equal(await expireOrders(pool, m(10 + 121)), 1); const s = await syncPreorders(pool, m(131)); assert.deepEqual([s.expired, s.reallocated], [1, 1]);
    assert.deepEqual((await pool.query('SELECT status FROM preorders ORDER BY created_at')).rows.map(x => x.status), ['EXPIRED', 'ALLOCATED']); assert.equal((await pool.query("SELECT 1 FROM notifications WHERE kind='PREORDER_STOCK_READY' AND recipient_dealer_id=$1", [f.d2])).rowCount, 1);
  });
  it('payment reminders repeat each configured interval and STOP once paid or expired', async () => {
    await pool.query("UPDATE app_settings SET value = jsonb_set(value, '{reminderMinutes}', '30') WHERE key='preorder'");
    try {
      await pre(f.d1, 5, m(0)); await receiveStock(pool, { productId: pP, qty: 5, actor: A(f.logi, 'LOGISTICS'), now: m(0) }); const oid = (await pool.query('SELECT order_id FROM preorders')).rows[0].order_id;
      assert.equal(await preorderReminderTick(pool, m(29)), 0); assert.equal(await preorderReminderTick(pool, m(31)), 1); assert.equal(await preorderReminderTick(pool, m(32)), 0, 'same slot'); assert.equal(await preorderReminderTick(pool, m(61)), 1);
      await payOrder(oid, { now: m(70) }); assert.equal(await preorderReminderTick(pool, m(95)), 0, 'stopped after payment');
    } finally { await pool.query("UPDATE app_settings SET value = jsonb_set(value, '{reminderMinutes}', '60') WHERE key='preorder'"); }
  });
  it('reminders also stop when the payment window expires', async () => {
    await pre(f.d1, 5, m(0)); await receiveStock(pool, { productId: pP, qty: 5, actor: A(f.logi, 'LOGISTICS'), now: m(0) });
    assert.equal(await preorderReminderTick(pool, m(61)), 1); assert.equal(await preorderReminderTick(pool, m(125)), 0, 'window (120 min) is over');
  });
});
describe('8/10. shifts, lunch deduction, Branding', () => {
  const S = { start: '09:30', end: '18:30', lunchMinutes: 60, standardMinutes: 480, lunchMinSpanMinutes: 300, timezone: 'Asia/Kolkata', weeklyOff: [0] }, at = (h: number, mi: number) => new Date(Date.UTC(2026, 9, 19, h, mi) - 330 * 60000);
  it('lunch is deducted once; overtime, late and early are separate', () => {
    assert.deepEqual(computeDay(at(9, 30), at(18, 30), S), { open: false, spanMinutes: 540, lunchMinutes: 60, netMinutes: 480, overtimeMinutes: 0, lateMinutes: 0, earlyMinutes: 0 });
    const ot = computeDay(at(9, 45), at(19, 45), S); assert.deepEqual([ot.netMinutes, ot.overtimeMinutes, ot.lateMinutes, ot.earlyMinutes], [540, 60, 15, 0]);
    const early = computeDay(at(9, 30), at(17, 30), S); assert.deepEqual([early.netMinutes, early.earlyMinutes], [420, 60]); assert.equal(computeDay(at(9, 30), at(13, 30), S).lunchMinutes, 0, 'a short half-day has no lunch deducted');
  });
  it('Branding follows the same rules; clock sequences are protected; Host is exempt; missing clock-outs are flagged once', async () => {
    const br = await emp('BRD01', 'BRANDING', 'Graphic Designer'), B = A(br, 'BRANDING'); assert.equal((await pool.query("SELECT count(*)::int AS n FROM designations WHERE name='Video Editor'")).rows[0].n, 1);
    await assert.rejects(clockOut(pool, B, at(18, 30)), code('NOT_CLOCKED_IN')); await clockIn(pool, B, at(9, 30)); await assert.rejects(clockIn(pool, B, at(9, 31)), code('ALREADY_CLOCKED_IN')); await assert.rejects(clockOut(pool, B, at(9, 30)), code('INVALID_SEQUENCE'));
    await clockOut(pool, B, at(18, 30)); const rep = await monthlyAttendance(pool, B, br, 2026, 10, at(20, 0)); const d = rep.rows.find((x: any) => x.date === '2026-10-19'); assert.deepEqual([d.status, d.netMinutes], ['PRESENT', 480]);
    await assert.rejects(clockIn(pool, A(f.host, 'HOST'), at(9, 30)), code('NOT_APPLICABLE')); await assert.rejects(monthlyAttendance(pool, A(f.sales1, 'SALES'), br, 2026, 10), code('FORBIDDEN'));
    await assert.rejects(receiveStock(pool, { productId: f.pA, qty: 1, actor: B }), code('FORBIDDEN')); await assert.rejects(listLeaveRequests(pool, B), code('FORBIDDEN'));
    await clockIn(pool, A(f.sales1, 'SALES'), at(9, 30)); const next = new Date(at(9, 30).getTime() + 86400000 + 3600000); assert.equal(await flagMissingClockOuts(pool, next), 1); assert.equal(await flagMissingClockOuts(pool, next), 0);
  });
  it('employees cannot edit their own attendance; only the Host approves a correction (audited)', async () => {
    const e = A(f.sales1, 'SALES'); await clockIn(pool, e, at(9, 30)); await clockOut(pool, e, at(15, 0));
    const id = await requestCorrection(pool, e, { employeeId: f.sales1, workDate: '2026-10-19', newIn: at(9, 30), newOut: at(18, 30), reason: 'forgot to clock out' });
    await assert.rejects(approveCorrection(pool, e, id), code('FORBIDDEN')); await approveCorrection(pool, A(f.host, 'HOST'), id); await assert.rejects(approveCorrection(pool, A(f.host, 'HOST'), id), code('ALREADY_DECIDED'));
    assert.equal((await monthlyAttendance(pool, A(f.host, 'HOST'), f.sales1, 2026, 10, at(20, 0))).rows.find((x: any) => x.date === '2026-10-19').netMinutes, 480); assert.equal((await pool.query("SELECT 1 FROM audit_logs WHERE action='ATTENDANCE_CORRECTION'")).rowCount, 1);
  });
});
describe('9. HR leave: balances, overlap protection, attendance sync', () => {
  const E = () => A(f.sales1, 'SALES'), H = () => A(f.host, 'HOST');
  it('approved leave updates attendance and balance exactly once; overlaps and over-balance requests are rejected', async () => {
    await pool.query("INSERT INTO holidays VALUES ('2026-10-21','Festival')"); const id = await requestLeave(pool, E(), { type: 'PAID', from: '2026-10-20', to: '2026-10-22' });
    assert.equal((await pool.query('SELECT days::float AS d FROM leave_requests WHERE id=$1', [id])).rows[0].d, 2, 'the holiday is not counted');
    await assert.rejects(requestLeave(pool, E(), { type: 'CASUAL', from: '2026-10-22', to: '2026-10-22' }), code('LEAVE_OVERLAP')); await assert.rejects(approveLeave(pool, E(), id), code('FORBIDDEN'));
    await approveLeave(pool, H(), id); await assert.rejects(approveLeave(pool, H(), id), code('ALREADY_DECIDED'));
    assert.equal((await leaveBalance(pool, E(), f.sales1, 2026)).find((b: any) => b.leave_type === 'PAID').remaining, 10, 'deducted once');
    const rep = await monthlyAttendance(pool, E(), f.sales1, 2026, 10, new Date('2026-10-30T10:00:00Z')); const st = (d: string) => rep.rows.find((x: any) => x.date === d).status;
    assert.deepEqual([st('2026-10-20'), st('2026-10-21'), st('2026-10-22'), st('2026-10-26')], ['LEAVE', 'HOLIDAY', 'LEAVE', 'ABSENT']);
    const half = await requestLeave(pool, E(), { type: 'CASUAL', from: '2026-10-23', to: '2026-10-23', half: true }); await approveLeave(pool, H(), half); assert.equal((await monthlyAttendance(pool, E(), f.sales1, 2026, 10, new Date('2026-10-30T10:00:00Z'))).rows.find((x: any) => x.date === '2026-10-23').status, 'HALF_DAY_LEAVE');
    await assert.rejects(requestLeave(pool, E(), { type: 'SICK', from: '2026-11-02', to: '2026-11-10' }), code('INSUFFICIENT_BALANCE'));
    await cancelApprovedLeave(pool, E(), id); await assert.rejects(cancelApprovedLeave(pool, E(), id), code('ALREADY_DECIDED')); assert.equal((await leaveBalance(pool, E(), f.sales1, 2026)).find((b: any) => b.leave_type === 'PAID').remaining, 12, 'refunded once');
    assert.equal((await listLeaveRequests(pool, H())).length, 2); await assert.rejects(listLeaveRequests(pool, E()), code('FORBIDDEN'));
  });
  it('year-end carry-forward is capped by policy and idempotent', async () => {
    await leaveBalance(pool, E(), f.sales1, 2026); await pool.query("UPDATE leave_balances SET used=2 WHERE employee_id=$1 AND leave_type='PAID' AND year=2026", [f.sales1]);
    await rolloverBalances(pool, H(), f.sales1, 2026); await rolloverBalances(pool, H(), f.sales1, 2026); const b = (await leaveBalance(pool, E(), f.sales1, 2027)).find((x: any) => x.leave_type === 'PAID'); assert.deepEqual([b.carried, b.remaining], [5, 17]);
  });
});
describe('11. warehouse packing verification', () => {
  it('Mark as Packed needs every quantity verified (including freebies) and no open discrepancy', async () => {
    const s = (await pool.query("INSERT INTO freebie_schemes (name, starts_at, ends_at, all_dealers) VALUES ('S', now() - interval '1 day', now() + interval '9 days', true) RETURNING id")).rows[0].id;
    const sp = (await pool.query('INSERT INTO freebie_scheme_products (scheme_id, product_id, valuation_paise) VALUES ($1,$2,15000) RETURNING id', [s, f.pFree])).rows[0].id;
    const r = await place(f.d1, [{ productId: f.pA, qty: 10 }], { freebies: [{ schemeProductId: sp, qty: 1 }] }); await payOrder(r.orderId); const wh = A(f.wh, 'WAREHOUSE');
    await assert.rejects(verifyItem(pool, { orderId: r.orderId, packingItemId: crypto.randomUUID(), verifiedQty: 1, actor: wh }), code('NOT_PACKING'));
    await pool.query("UPDATE orders SET status='AWAITING_WAREHOUSE' WHERE id=$1", [r.orderId]); await startPacking(pool, r.orderId, wh); const items = await packingChecklist(pool, r.orderId); assert.equal(items.length, 2, 'product line and freebie');
    const main = items.find((x: any) => x.source === 'ITEM')!, free = items.find((x: any) => x.source === 'FREEBIE')!;
    await verifyItem(pool, { orderId: r.orderId, packingItemId: main.id, verifiedQty: 9, actor: wh }); await verifyItem(pool, { orderId: r.orderId, packingItemId: free.id, verifiedQty: 1, actor: wh });
    await assert.rejects(markPacked(pool, r.orderId, wh), (e: any) => e.code === 'PACKING_INCOMPLETE' && e.details.outstanding[0].required_qty === 10); await assert.rejects(verifyItem(pool, { orderId: r.orderId, packingItemId: main.id, verifiedQty: 11, actor: wh }), code('BAD_QTY'));
    await verifyItem(pool, { orderId: r.orderId, packingItemId: main.id, verifiedQty: 10, actor: wh }); const d = await reportDiscrepancy(pool, { orderId: r.orderId, packingItemId: main.id, kind: 'DAMAGED', qty: 1, note: 'torn tub', actor: wh });
    await assert.rejects(markPacked(pool, r.orderId, wh), (e: any) => e.code === 'PACKING_INCOMPLETE' && e.details.openDiscrepancies === 1); assert.equal((await pool.query("SELECT 1 FROM notifications WHERE kind='PACKING_DISCREPANCY'")).rowCount, 1);
    await resolveDiscrepancy(pool, d, wh); await markPacked(pool, r.orderId, wh); assert.equal((await pool.query('SELECT status FROM orders WHERE id=$1', [r.orderId])).rows[0].status, 'PACKED_READY');
  });
});
describe('12/13. coupons are validated on the server; combo and excluded products get no freebies', () => {
  let pC: string; beforeEach(async () => { pC = await prod('BOLT-EXTRA', f.bolt, 100000, 1000); });
  it('rejects unknown, expired, ineligible, under-minimum and incomplete-combo coupons; enforces usage limits', async () => {
    await promo({ code: 'FLAT500', kind: 'FIXED', fixed: 50000, min: 1000000, max: 1 }); await promo({ code: 'OLD', kind: 'FIXED', fixed: 1000, to: new Date(Date.now() - 1000), from: new Date(Date.now() - 864e5) });
    await promo({ code: 'D1ONLY', kind: 'FIXED', fixed: 1000, all: false, dealers: [f.d1] }); await promo({ code: 'COMBO1', kind: 'COMBO', fixed: 30000, required: [f.pA, f.pB] });
    const big = [{ productId: f.pA, qty: 10 }];
    for (const [c, items, e] of [['NOPE', big, 'COUPON_INVALID'], ['OLD', big, 'COUPON_EXPIRED'], ['FLAT500', [{ productId: f.pA, qty: 1 }], 'COUPON_BELOW_MINIMUM'], ['COMBO1', big, 'COUPON_COMBO_INCOMPLETE']] as const) await assert.rejects(place(f.d1, items as any, { couponCode: c }), code(e));
    await assert.rejects(place(f.d2, big, { couponCode: 'D1ONLY' }), code('COUPON_NOT_ELIGIBLE'));
    const r = await place(f.d1, big, { couponCode: 'flat500' }) as any; assert.equal(r.couponDiscountPaise, 50000n); assert.equal(r.totalPaise, 950000n);
    assert.equal(await sum2("SELECT SUM(eligible_paise + tax_paise)::bigint AS s FROM order_items WHERE order_id=$1", [r.orderId]), 950000n, 'discount is spread across lines');
    await assert.rejects(place(f.d2, big, { couponCode: 'FLAT500' }), code('COUPON_USAGE_LIMIT')); await payOrder(r.orderId); assert.equal(await ledgerSum(), 950000n, 'targets use the discounted collected amount');
  });
  async function sum2(sql: string, p: unknown[]) { return (await pool.query(sql, p)).rows[0].s as bigint; }
  it('freebies: combo lines, specific-product coupon lines and excluded products are blocked at line level, with the reason', async () => {
    const s = (await pool.query("INSERT INTO freebie_schemes (name, starts_at, ends_at, all_dealers) VALUES ('S', now() - interval '1 day', now() + interval '9 days', true) RETURNING id")).rows[0].id;
    const sp = (await pool.query('INSERT INTO freebie_scheme_products (scheme_id, product_id, valuation_paise, max_qty_per_order) VALUES ($1,$2,15000,9) RETURNING id', [s, f.pFree])).rows[0].id;
    await promo({ code: 'COMBOX', kind: 'COMBO', fixed: 30000, required: [f.pA, f.pB] }); const fb = { freebies: [{ schemeProductId: sp, qty: 2 }] };
    await assert.rejects(place(f.d1, [{ productId: f.pA, qty: 10 }, { productId: f.pB, qty: 1 }], { couponCode: 'COMBOX', ...fb }), code('FREEBIE_EXCLUDED'));
    const ok = await place(f.d1, [{ productId: f.pA, qty: 1 }, { productId: f.pB, qty: 1 }, { productId: pC, qty: 10 }], { couponCode: 'COMBOX', ...fb }) as any; assert.equal(ok.allowancePaise, 50000n, 'only the non-combo line qualifies');
    const rows = (await pool.query('SELECT sku, freebie_eligible, freebie_block_reason FROM order_items WHERE order_id=$1 ORDER BY sku', [ok.orderId])).rows; assert.deepEqual(rows.map(x => [x.sku, x.freebie_eligible]), [['BOLT-EXTRA', true], ['BOLT-WHEY', false], ['VED-OMEGA', false]]); assert.match(rows[1].freebie_block_reason, /combo/);
    await promo({ code: 'ONLYA', kind: 'PRODUCT', pct: 1000, eligible: [f.pA] }); await assert.rejects(place(f.d1, [{ productId: f.pA, qty: 10 }], { couponCode: 'ONLYA', ...fb }), code('FREEBIE_EXCLUDED'));
    await pool.query("INSERT INTO freebie_exclusions (product_id, reason) VALUES ($1,'clearance')", [pC]); await assert.rejects(place(f.d1, [{ productId: pC, qty: 10 }], fb), code('FREEBIE_EXCLUDED'));
    await pool.query("INSERT INTO freebie_exclusions (dealer_id, reason) VALUES ($1,'scheme restriction')", [f.d2]); await assert.rejects(place(f.d2, [{ productId: f.pA, qty: 10 }], fb), code('FREEBIE_EXCLUDED'));
    assert.ok((await place(f.d1, [{ productId: f.pA, qty: 10 }], fb) as any).freebieValuePaise === 30000n, 'a normal order still gets its freebies');
  });
});
describe('14/15. sample orders: free, separate stock, no payments, no targets', () => {
  it('runs the sample lifecycle without payments or target credit, using only sample stock', async () => {
    const sales = A(f.sales1, 'SALES'), host = A(f.host, 'HOST'), logi = A(f.logi, 'LOGISTICS'), wh = A(f.wh, 'WAREHOUSE'); const before = await availability(pool, [f.pA]);
    const so = await createSampleOrder(pool, { actor: sales, recipientDealerId: f.d1, recipientName: 'D1', address: '12 Sample Road, Ahmedabad', items: [{ productId: f.pA, qty: 3 }] }); assert.equal(so.valuationPaise, 300000n);
    await assert.rejects(approveSample(pool, so.id, wh), code('FORBIDDEN')); assert.equal(await approveSample(pool, so.id, host), 'AWAITING_STOCK', 'saleable stock is NOT used for samples');
    await assert.rejects(receiveSampleStock(pool, { productId: f.pA, qty: 5, actor: sales }), code('FORBIDDEN')); const r = await receiveSampleStock(pool, { productId: f.pA, qty: 5, actor: logi }); assert.equal(r.samplesAllocated, 1);
    for (const to of ['READY_FOR_PACKING', 'PACKING', 'PACKED', 'SHIPPED', 'DELIVERED']) await advanceSample(pool, so.id, to, wh); await assert.rejects(advanceSample(pool, so.id, 'PACKING', wh), code('INVALID_TRANSITION'));
    const inv = (await pool.query('SELECT on_hand, reserved, dispatched FROM sample_inventory WHERE product_id=$1', [f.pA])).rows[0]; assert.deepEqual([inv.on_hand, inv.reserved, inv.dispatched], [2, 0, 3]);
    assert.deepEqual(await availability(pool, [f.pA]), before, 'saleable inventory untouched');
    for (const t of ['payment_attempts', 'payment_captures', 'target_credit_ledger', 'orders']) assert.equal((await pool.query(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n, 0, t + ' stays empty');
    const so2 = await createSampleOrder(pool, { actor: sales, recipientName: 'Prospect', address: '45 Trade Street, Surat', items: [{ productId: f.pA, qty: 2 }] }); await approveSample(pool, so2.id, host); await advanceSample(pool, so2.id, 'CANCELLED', sales);
    assert.equal((await pool.query('SELECT reserved FROM sample_inventory WHERE product_id=$1', [f.pA])).rows[0].reserved, 0, 'cancelling releases the reservation');
  });
});
