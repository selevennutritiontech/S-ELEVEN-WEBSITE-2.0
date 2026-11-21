import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, fixture, place, payOrder, Fx } from './helpers.js';
import type { Actor, Role } from '../src/permissions.js';
import { totp, base32Encode, base32Decode, sealSecret, openSecret, matchStep, stepOf } from '../src/totp.js';
import { beginEnrollment, confirmEnrollment, verifyLogin, resetTotp } from '../src/services/twofa.js';
import { stockOut, stockReturn } from '../src/services/inventory.js';
import { attachInvoiceNumbered, attachEwayBill, dispatchOrder, EWAY_LIMIT_PAISE } from '../src/services/logistics.js';
import { createCustomSampleOrder, advanceSample } from '../src/services/samples.js';
const A = (id: string, role: Role): Actor => ({ type: 'EMPLOYEE', id, role });
const code = (c: string) => (e: any) => e?.code === c;
const pdf = (n: string, no: string, orderId: string, employeeId: string) => ({ orderId, employeeId, number: no, filename: n, contentType: 'application/pdf', sizeBytes: 2048, sha256: 'a'.repeat(64), storageKey: 'docs/' + n });
after(async () => { await pool.end(); });

describe('TOTP (pure): Google Authenticator compatibility', () => {
  const secret = base32Encode(Buffer.from('12345678901234567890'));
  it('matches the RFC 6238 reference codes (SHA-1, 6 digits)', () => {
    for (const [t, c] of [[59, '287082'], [1111111109, '081804'], [1111111111, '050471'], [1234567890, '005924'], [2000000000, '279037']] as const) assert.equal(totp(secret, new Date(t * 1000)), c);
  });
  it('base32 round-trips and the stored secret is AES-GCM sealed (tampering is detected)', () => {
    const raw = Buffer.from('hello-seleven-key'); assert.deepEqual(base32Decode(base32Encode(raw)), raw);
    const blob = sealSecret(secret); assert.ok(!blob.includes(secret)); assert.equal(openSecret(blob), secret); assert.notEqual(sealSecret(secret), blob, 'fresh IV every time');
    const bad = Buffer.from(blob, 'base64'); bad[bad.length - 1] ^= 1; assert.throws(() => openSecret(bad.toString('base64')));
  });
  it('accepts one step of clock drift either way, but not two', () => {
    const now = new Date(1_800_000_000_000), c = (d: number) => totp(secret, new Date(now.getTime() + d * 30000));
    assert.equal(matchStep(secret, c(0), now), stepOf(now)); assert.equal(matchStep(secret, c(-1), now), stepOf(now) - 1); assert.equal(matchStep(secret, c(1), now), stepOf(now) + 1);
    assert.equal(matchStep(secret, c(2), now), null); assert.equal(matchStep(secret, 'abcdef', now), null); assert.equal(matchStep(secret, '12345', now), null);
  });
});

describe('Staff sign-in with Google Authenticator (database)', () => {
  let f: Fx; beforeEach(async () => { f = await fixture(); });
  const enrol = async (emp: string, now: Date) => { const b = await beginEnrollment(pool, emp); await confirmEnrollment(pool, { employeeId: emp, token: totp(b.secret, now), now }); return b.secret; };
  it('enrolment is two-step, the secret is stored encrypted, and a second enrolment is refused', async () => {
    const t0 = new Date('2026-10-21T10:00:00Z'), b = await beginEnrollment(pool, f.sales1);
    assert.match(b.uri, /^otpauth:\/\/totp\/S-ELEVEN:SAL01\?secret=[A-Z2-7]{32}&issuer=S-ELEVEN/);
    await assert.rejects(verifyLogin(pool, { employeeId: f.sales1, token: totp(b.secret, t0), now: t0 }), code('NOT_ENROLLED'));      // not switched on until confirmed
    await assert.rejects(confirmEnrollment(pool, { employeeId: f.sales1, token: '000000', now: t0 }), code('BAD_CODE'));
    await confirmEnrollment(pool, { employeeId: f.sales1, token: totp(b.secret, t0), now: t0 });
    const row = (await pool.query('SELECT secret, pending FROM staff_totp WHERE employee_id=$1', [f.sales1])).rows[0]; assert.equal(row.pending, false); assert.ok(!row.secret.includes(b.secret)); assert.equal(openSecret(row.secret), b.secret);
    await assert.rejects(beginEnrollment(pool, f.sales1), code('ALREADY_ENROLLED'));
  });
  it('a code works once; the next 30-second code works; a wrong code is counted even though it throws', async () => {
    const t0 = new Date('2026-10-21T10:00:00Z'), s = await enrol(f.sales1, t0), t1 = new Date(t0.getTime() + 30000);
    await assert.rejects(verifyLogin(pool, { employeeId: f.sales1, token: totp(s, t0), now: t0 }), code('CODE_REUSED'));
    await verifyLogin(pool, { employeeId: f.sales1, token: totp(s, t1), now: t1 });
    await assert.rejects(verifyLogin(pool, { employeeId: f.sales1, token: totp(s, t1), now: t1 }), code('CODE_REUSED'));
    const fails = async () => (await pool.query('SELECT failed_attempts FROM staff_totp WHERE employee_id=$1', [f.sales1])).rows[0].failed_attempts as number, was = await fails();   // a replayed code also counts as a failed attempt
    const t2 = new Date(t0.getTime() + 60000); await assert.rejects(verifyLogin(pool, { employeeId: f.sales1, token: '000000', now: t2 }), code('BAD_CODE'));
    assert.equal(await fails(), was + 1, 'the failed attempt survives the thrown error');
    await verifyLogin(pool, { employeeId: f.sales1, token: totp(s, t2), now: t2 });
    assert.equal((await pool.query('SELECT failed_attempts FROM staff_totp WHERE employee_id=$1', [f.sales1])).rows[0].failed_attempts, 0, 'success resets the counter');
  });
  it('5 wrong codes lock the account for 5 minutes, even for the right code, then it opens', async () => {
    const t0 = new Date('2026-10-21T10:00:00Z'), s = await enrol(f.sales1, t0), t1 = new Date(t0.getTime() + 60000);
    for (let i = 0; i < 4; i++) await assert.rejects(verifyLogin(pool, { employeeId: f.sales1, token: '000000', now: t1 }), code('BAD_CODE'));
    await assert.rejects(verifyLogin(pool, { employeeId: f.sales1, token: '000000', now: t1 }), code('LOCKED'));
    const t2 = new Date(t1.getTime() + 120000); await assert.rejects(verifyLogin(pool, { employeeId: f.sales1, token: totp(s, t2), now: t2 }), code('LOCKED'));
    const t3 = new Date(t1.getTime() + 6 * 60000); await verifyLogin(pool, { employeeId: f.sales1, token: totp(s, t3), now: t3 });
  });
  it('the same code submitted twice in parallel signs in exactly once', async () => {
    const t0 = new Date('2026-10-21T10:00:00Z'), s = await enrol(f.sales1, t0), t1 = new Date(t0.getTime() + 60000), tok = totp(s, t1);
    const r = await Promise.allSettled([1, 2, 3, 4].map(() => verifyLogin(pool, { employeeId: f.sales1, token: tok, now: t1 }))); assert.equal(r.filter(x => x.status === 'fulfilled').length, 1);
  });
  it('only the Host can reset; the employee must enrol again; sign-ins and the reset are recorded and the Host is alerted', async () => {
    const t0 = new Date('2026-10-21T10:00:00Z'), s = await enrol(f.sales1, t0), t1 = new Date(t0.getTime() + 60000);
    await verifyLogin(pool, { employeeId: f.sales1, token: totp(s, t1), now: t1 });
    const n = async () => Number((await pool.query("SELECT count(*)::int AS n FROM notifications WHERE kind='EMPLOYEE_ACTION' AND recipient_department='HOST'")).rows[0].n);
    const before = await n(); assert.ok(before >= 2, 'enrolment + sign-in alerted the Host');
    const hs = await enrol(f.host, t0); await verifyLogin(pool, { employeeId: f.host, token: totp(hs, new Date(t1.getTime() + 60000)), now: new Date(t1.getTime() + 60000) }); assert.equal(await n(), before, "the Host's own sign-in does not alert the Host");
    await assert.rejects(resetTotp(pool, { actor: A(f.sales2, 'SALES'), employeeId: f.sales1 }), code('FORBIDDEN'));
    await resetTotp(pool, { actor: A(f.host, 'HOST'), employeeId: f.sales1 }); await assert.rejects(verifyLogin(pool, { employeeId: f.sales1, token: totp(s, t1), now: new Date(t1.getTime() + 90000) }), code('NOT_ENROLLED'));
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM activity_events WHERE action IN ('Signed in','Two-factor enabled','Two-factor reset')")).rows[0].n >= 4, true); await beginEnrollment(pool, f.sales1);
  });
});

describe('IT department', () => {
  it('exists with designations, and its employees follow the same attendance-only permissions as Branding', async () => {
    const f = await fixture(); assert.ok(Number((await pool.query("SELECT count(*)::int AS n FROM designations x JOIN departments d ON d.id=x.department_id WHERE d.code='IT'")).rows[0].n) >= 6);
    const id = (await pool.query("INSERT INTO employees (employee_code, name, email, department_id, status) VALUES ('IT01','IT01','it01@s-eleven.test',(SELECT id FROM departments WHERE code='IT'),'ACTIVE') RETURNING id")).rows[0].id;
    const { ROLE_PERMISSIONS, can } = await import('../src/permissions.js'); assert.deepEqual(ROLE_PERMISSIONS.IT, ['attendance.own', 'task.own']); assert.equal(can(A(id, 'IT'), 'inventory.edit'), false); assert.equal(can(A(id, 'IT'), 'finance.read'), false); void f;
  });
});

describe('Invoice and e-way bill (manual upload)', () => {
  let f: Fx; beforeEach(async () => { f = await fixture(); });
  const paid = async (qty: number) => { const r = await place(f.d1, [{ productId: f.pA, qty }]); await payOrder(r.orderId); return r.orderId as string; };
  it('the limit is exactly 50,000: an order of 50,000 needs NO e-way bill, 51,000 does', async () => {
    assert.equal(EWAY_LIMIT_PAISE, 5_000_000); const small = await paid(50), big = await paid(51), tot = async (id: string) => BigInt((await pool.query('SELECT total_paise FROM orders WHERE id=$1', [id])).rows[0].total_paise);
    assert.equal(await tot(small), 5_000_000n); assert.equal(await tot(big), 5_100_000n);
    await assert.rejects(attachEwayBill(pool, pdf('e.pdf', 'EW-1', small, f.logi)), code('EWAY_NOT_REQUIRED')); await attachEwayBill(pool, pdf('e.pdf', 'EW-1', big, f.logi));
  });
  it('invoice number is required, only PDFs are accepted, and only paid orders can have documents', async () => {
    const o = await paid(1), unpaid = (await place(f.d1, [{ productId: f.pA, qty: 1 }])).orderId;
    await assert.rejects(attachInvoiceNumbered(pool, pdf('i.pdf', '  ', o, f.logi)), code('NUMBER_REQUIRED'));
    await assert.rejects(attachInvoiceNumbered(pool, { ...pdf('i.png', 'S11/1', o, f.logi), contentType: 'image/png' }), code('BAD_FILE_TYPE'));
    await assert.rejects(attachInvoiceNumbered(pool, pdf('i.pdf', 'S11/1', unpaid, f.logi)), code('ORDER_NOT_PAID'));
    await attachInvoiceNumbered(pool, pdf('i.pdf', 'S11/26-27/950', o, f.logi)); await attachInvoiceNumbered(pool, pdf('i2.pdf', 'S11/26-27/951', o, f.logi));
    const d = (await pool.query("SELECT version, doc_number, is_current FROM documents WHERE order_id=$1 AND kind='INVOICE' ORDER BY version", [o])).rows; assert.deepEqual(d.map(x => [x.version, x.doc_number, x.is_current]), [[1, 'S11/26-27/950', false], [2, 'S11/26-27/951', true]]);
  });
  it('an order above 50,000 cannot be dispatched until the e-way bill is attached; smaller orders are not blocked by it', async () => {
    const big = await paid(60), small = await paid(2);
    await assert.rejects(dispatchOrder(pool, big, f.logi), code('EWAY_REQUIRED')); await assert.rejects(dispatchOrder(pool, small, f.logi), code('NO_TRACKING'));   // small order reaches the next check, so the e-way rule did not apply
    await attachEwayBill(pool, pdf('e.pdf', 'EW-77', big, f.logi)); await assert.rejects(dispatchOrder(pool, big, f.logi), code('NO_TRACKING'));
    assert.equal((await pool.query("SELECT doc_number FROM documents WHERE order_id=$1 AND kind='EWAY_BILL' AND is_current", [big])).rows[0].doc_number, 'EW-77');
    assert.ok(Number((await pool.query("SELECT count(*)::int AS n FROM activity_events WHERE action IN ('Invoice uploaded','E-way bill uploaded')")).rows[0].n) >= 1);
  });
});

describe('Stock out and returned (Warehouse and Logistics both edit)', () => {
  let f: Fx; beforeEach(async () => { f = await fixture(); });
  it('out never goes below what is reserved, needs a reason, and is logged with before/after', async () => {
    await place(f.d1, [{ productId: f.pStock, qty: 4 }]);                       // 10 on hand, 4 reserved -> 6 available
    await assert.rejects(stockOut(pool, { productId: f.pStock, qty: 7, actor: A(f.wh, 'WAREHOUSE'), reason: 'sent for display' }), code('INSUFFICIENT_AVAILABLE'));
    await assert.rejects(stockOut(pool, { productId: f.pStock, qty: 1, actor: A(f.wh, 'WAREHOUSE'), reason: '' }), code('REASON_REQUIRED'));
    await assert.rejects(stockOut(pool, { productId: f.pStock, qty: 1, actor: A(f.sales1, 'SALES'), reason: 'sent for display' }));                // Sales may only view
    await stockOut(pool, { productId: f.pStock, qty: 6, actor: A(f.logi, 'LOGISTICS'), reason: 'sent for display' });                              // Logistics can edit too
    const m = (await pool.query("SELECT delta, qty_before, qty_after FROM stock_movements WHERE product_id=$1 AND kind='STOCK_OUT'", [f.pStock])).rows[0]; assert.deepEqual([m.delta, m.qty_before, m.qty_after], [-6, 10, 4]);
    assert.equal((await pool.query('SELECT on_hand, reserved FROM inventory_balances WHERE product_id=$1', [f.pStock])).rows[0].on_hand, 4);
  });
  it('returned stock goes back on the shelf and is counted separately', async () => {
    await stockOut(pool, { productId: f.pStock, qty: 5, actor: A(f.wh, 'WAREHOUSE'), reason: 'sent for display' }); await stockReturn(pool, { productId: f.pStock, qty: 3, actor: A(f.wh, 'WAREHOUSE'), reason: 'returned by dealer' });
    const b = (await pool.query('SELECT on_hand, returned_total FROM inventory_balances WHERE product_id=$1', [f.pStock])).rows[0]; assert.deepEqual([b.on_hand, b.returned_total], [8, 3]);
    assert.deepEqual((await pool.query("SELECT kind, delta FROM stock_movements WHERE product_id=$1 AND kind IN ('STOCK_OUT','RETURN') ORDER BY id", [f.pStock])).rows.map(r => [r.kind, r.delta]), [['STOCK_OUT', -5], ['RETURN', 3]]);
    await assert.rejects(stockReturn(pool, { productId: f.pStock, qty: 0, actor: A(f.wh, 'WAREHOUSE'), reason: 'returned by dealer' }), code('BAD_QTY'));
  });
});

describe('Sample orders with a custom product name', () => {
  let f: Fx; beforeEach(async () => { f = await fixture(); });
  const mk = (over: Record<string, unknown> = {}) => createCustomSampleOrder(pool, { actor: A(f.sales1, 'SALES'), recipientName: 'Gym Owner', address: '45 Trade Street, Surat, Gujarat', lines: [{ brandId: f.bolt, name: 'Custom 250 g trial tub', qty: 3 }], ...over } as any);
  it('only the brand is chosen; it goes to Warehouse and Logistics; nothing is reserved, paid or credited', async () => {
    const stockBefore = (await pool.query('SELECT sum(on_hand)::int AS s, sum(reserved)::int AS r FROM inventory_balances')).rows[0], r = await mk();
    const s = (await pool.query('SELECT status FROM sample_orders WHERE id=$1', [r.id])).rows[0]; assert.equal(s.status, 'READY_FOR_PACKING');
    const it = (await pool.query('SELECT product_id, brand_id, custom_name, qty FROM sample_order_items WHERE sample_order_id=$1', [r.id])).rows[0]; assert.deepEqual([it.product_id, it.brand_id, it.custom_name, it.qty], [null, f.bolt, 'Custom 250 g trial tub', 3]);
    assert.deepEqual((await pool.query("SELECT recipient_department AS d FROM notifications WHERE kind='SAMPLE_ORDER' ORDER BY 1")).rows.map(x => x.d), ['LOGISTICS', 'WAREHOUSE']);
    assert.deepEqual((await pool.query('SELECT sum(on_hand)::int AS s, sum(reserved)::int AS r FROM inventory_balances')).rows[0], stockBefore);
    for (const t of ['payment_attempts', 'target_credit_ledger', 'stock_movements']) assert.equal((await pool.query(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n, 0, t);
    await advanceSample(pool, r.id, 'PACKING', A(f.wh, 'WAREHOUSE'));
  });
  it('rejects a missing brand, a too-short name, an unknown brand, and users who may not create samples', async () => {
    await assert.rejects(mk({ lines: [{ brandId: '', name: 'Trial tub', qty: 1 }] }), code('BRAND_REQUIRED')); await assert.rejects(mk({ lines: [{ brandId: f.bolt, name: 'x', qty: 1 }] }), code('NAME_REQUIRED'));
    await assert.rejects(mk({ lines: [{ brandId: '00000000-0000-0000-0000-000000000000', name: 'Trial tub', qty: 1 }] }), code('UNKNOWN_BRAND')); await assert.rejects(mk({ actor: A(f.wh, 'WAREHOUSE') }));
    await assert.rejects(mk({ lines: [] }), code('EMPTY_ORDER')); await assert.rejects(mk({ address: 'short' }), code('BAD_ADDRESS'));
  });
});
