import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, fixture, place, payOrder, packAll, Fx } from './helpers.js';
import type { Actor, Role } from '../src/permissions.js';
import { createEmployee, changeDepartment, setEmployeeStatus, provisionSuperAdmin, bootstrapFirstHost } from '../src/services/employees.js';
import { logisticsView, uploadDocumentAs, dispatchAs } from '../src/services/logisticsAccess.js';
import { startPortalSession, touchPortalSession, endPortalSession, expireIdleSessions } from '../src/services/sessions.js';
import { uploadPaymentProof, verifyPaymentProof, rejectPaymentProof } from '../src/services/paymentProofs.js';
import { listOrders, recordOrderView, getOrderStatusView } from '../src/services/orderViews.js';
import { receiveBatch, issueStock, setBatchStatus, expireBatches, requestAdjustment, decideAdjustment, batchInventoryView, stockStatus } from '../src/services/batches.js';
import { receiveStock } from '../src/services/inventory.js';
import { attachInvoiceNumbered } from '../src/services/logistics.js';
const A = (id: string, role: Role): Actor => ({ type: 'EMPLOYEE', id, role });
const code = (c: string) => (e: any) => e?.code === c;
const t = (s: string) => new Date(s);
const pdf = (o: string, e: string, no = 'S11/1') => ({ orderId: o, employeeId: e, number: no, filename: 'i.pdf', contentType: 'application/pdf', sizeBytes: 100, sha256: 'a'.repeat(64), storageKey: 'k/' + o });
after(async () => { await pool.end(); });
let fin: string; const finance = async () => (await pool.query("INSERT INTO employees (employee_code, name, email, department_id, status) VALUES ('FIN01','FIN01','fin01@s-eleven.test',(SELECT id FROM departments WHERE code='FINANCE'),'ACTIVE') RETURNING id")).rows[0].id as string;
const n = async (sql: string, p: unknown[] = []) => Number((await pool.query(sql, p)).rows[0].n);

describe('Phase 1: Finance sees Logistics information; the Host role cannot be created', () => {
  let f: Fx; beforeEach(async () => { f = await fixture(); fin = await finance(); });
  it('Finance can read the shared logistics view and correct documents, but cannot dispatch or write tracking; its department is unchanged', async () => {
    const o = (await place(f.d1, [{ productId: f.pA, qty: 1 }])).orderId; await payOrder(o); const F = A(fin, 'FINANCE');
    const v = await logisticsView(pool, F, o); assert.equal(v.order.status, 'PAID_AWAITING_LOGISTICS'); assert.ok(Array.isArray(v.documents) && Array.isArray(v.payments));
    await uploadDocumentAs(pool, F, { kind: 'INVOICE', orderId: o, number: 'S11/9', filename: 'i.pdf', contentType: 'application/pdf', sizeBytes: 10, sha256: 'b'.repeat(64), storageKey: 'x' });
    assert.equal((await logisticsView(pool, F, o)).documents[0].doc_number, 'S11/9');
    await assert.rejects(dispatchAs(pool, F, o), code('FORBIDDEN'));
    assert.equal((await pool.query("SELECT d.code FROM employees e JOIN departments d ON d.id=e.department_id WHERE e.id=$1", [fin])).rows[0].code, 'FINANCE');
    await assert.rejects(logisticsView(pool, A(f.sales1, 'SALES'), o), code('FORBIDDEN')); await assert.rejects(uploadDocumentAs(pool, A(f.sales1, 'SALES'), { kind: 'INVOICE', orderId: o, number: 'x', filename: 'i.pdf', contentType: 'application/pdf', sizeBytes: 1, sha256: 'c'.repeat(64), storageKey: 'y' }), code('FORBIDDEN'));
  });
  it('Host cannot be created or assigned through employee management (service AND database), and the last Host is protected', async () => {
    const H = A(f.host, 'HOST');
    await assert.rejects(createEmployee(pool, H, { code: 'X1', name: 'X', email: 'x1@s-eleven.test', department: 'HOST' }), code('HOST_NOT_ASSIGNABLE'));
    await assert.rejects(createEmployee(pool, H, { code: 'X2', name: 'X', email: 'x2@s-eleven.test', department: 'SALES', designation: 'Super Admin' }), code('HOST_NOT_ASSIGNABLE'));
    await assert.rejects(createEmployee(pool, A(f.sales1, 'SALES'), { code: 'X3', name: 'X', email: 'x3@s-eleven.test', department: 'SALES' }), code('FORBIDDEN'));
    const ok = await createEmployee(pool, H, { code: 'NEW1', name: 'New One', email: 'new1@s-eleven.test', department: 'it' }); assert.ok(ok);
    await assert.rejects(changeDepartment(pool, H, ok, 'HOST'), code('HOST_NOT_ASSIGNABLE'));
    await assert.rejects(pool.query("INSERT INTO employees (employee_code, name, email, department_id, status) VALUES ('RAW1','R','raw1@s-eleven.test',(SELECT id FROM departments WHERE code='HOST'),'ACTIVE')"), /HOST_PROVISIONING_RESTRICTED/);   // crafted request / direct SQL
    await assert.rejects(pool.query("UPDATE employees SET department_id=(SELECT id FROM departments WHERE code='HOST') WHERE id=$1", [ok]), /HOST_PROVISIONING_RESTRICTED/);
    await assert.rejects(setEmployeeStatus(pool, H, f.host, 'INACTIVE'), code('LAST_SUPER_ADMIN')); await assert.rejects(pool.query('DELETE FROM employees WHERE id=$1', [f.host]), /LAST_SUPER_ADMIN/);
    await assert.rejects(bootstrapFirstHost(pool, { code: 'H2', name: 'H', email: 'h2@s-eleven.test' }), code('HOST_EXISTS'));
  });
  it('another super-administrator needs an existing Host plus an out-of-band token; the change is audited; then the first Host may be deactivated', async () => {
    const H = A(f.host, 'HOST'); delete process.env.SUPER_ADMIN_PROVISION_TOKEN;
    await assert.rejects(provisionSuperAdmin(pool, H, { code: 'H2', name: 'H2', email: 'h2@s-eleven.test', confirmToken: 'anything' }), code('FORBIDDEN'));
    process.env.SUPER_ADMIN_PROVISION_TOKEN = 'ops-token-123'; await assert.rejects(provisionSuperAdmin(pool, H, { code: 'H2', name: 'H2', email: 'h2@s-eleven.test', confirmToken: 'wrong' }), code('FORBIDDEN'));
    await assert.rejects(provisionSuperAdmin(pool, A(f.sales1, 'SALES'), { code: 'H2', name: 'H2', email: 'h2@s-eleven.test', confirmToken: 'ops-token-123' }), code('FORBIDDEN'));
    const id = await provisionSuperAdmin(pool, H, { code: 'H2', name: 'H2', email: 'h2@s-eleven.test', confirmToken: 'ops-token-123' }); delete process.env.SUPER_ADMIN_PROVISION_TOKEN;
    assert.ok(await n("SELECT count(*)::int AS n FROM audit_logs WHERE action IN ('PRIVILEGED_ROLE_CHANGE','SUPER_ADMIN_PROVISIONED')") >= 2); await setEmployeeStatus(pool, H, f.host, 'INACTIVE'); assert.ok(id);
  });
});

describe('Phase 2: attendance follows portal login and logout', () => {
  let f: Fx; beforeEach(async () => { f = await fixture(); });
  const S = () => A(f.sales1, 'SALES');
  it('login creates attendance; refresh and a second tab resume the SAME session; logout ends both together with 8h net (lunch once)', async () => {
    const a = await startPortalSession(pool, { actor: S(), tokenHash: 'h1', now: t('2026-10-21T04:00:00Z') });           // 09:30 IST
    assert.equal(a.attendance, 'ACTIVE'); assert.equal(a.resumed, false); await touchPortalSession(pool, 'h1', t('2026-10-21T06:00:00Z'));
    assert.equal((await pool.query('SELECT clock_out FROM shift_sessions WHERE id=$1', [a.shiftSessionId])).rows[0].clock_out, null, 'a refresh is not a sign-out');
    const b = await startPortalSession(pool, { actor: S(), tokenHash: 'h2', now: t('2026-10-21T06:05:00Z') }); assert.equal(b.shiftSessionId, a.shiftSessionId); assert.equal(b.resumed, true); assert.equal(await n('SELECT count(*)::int AS n FROM shift_sessions WHERE employee_id=$1', [f.sales1]), 1);
    const out = await endPortalSession(pool, { tokenHash: 'h1', now: t('2026-10-21T13:00:00Z') }) as any;                  // 18:30 IST
    assert.deepEqual([out.attendanceClosed, out.netMinutes, out.lateMinutes, out.earlyMinutes], [true, 480, 0, 0]);
    assert.equal(await n('SELECT count(*)::int AS n FROM portal_sessions WHERE employee_id=$1 AND ended_at IS NOT NULL AND end_reason=$2', [f.sales1, 'LOGOUT']), 2);
    const sh = (await pool.query('SELECT ended_by, logout_at, login_at, net_minutes FROM shift_sessions WHERE id=$1', [a.shiftSessionId])).rows[0]; assert.deepEqual([sh.ended_by, sh.net_minutes, !!sh.logout_at, !!sh.login_at], ['LOGOUT', 480, true, true]);
    assert.deepEqual(await endPortalSession(pool, { tokenHash: 'h1' }), { alreadyEnded: true });                           // idempotent
    await assert.rejects(touchPortalSession(pool, 'h1'), code('SESSION_ENDED'));
  });
  it('records late arrival and early departure; Host is exempt', async () => {
    const a = await startPortalSession(pool, { actor: S(), tokenHash: 'L1', now: t('2026-10-22T04:30:00Z') }); const o = await endPortalSession(pool, { tokenHash: 'L1', now: t('2026-10-22T12:30:00Z') }) as any;   // 10:00 -> 18:00 IST
    assert.deepEqual([o.lateMinutes, o.earlyMinutes, o.netMinutes], [30, 30, 420]); assert.ok(a.shiftSessionId);
    const h = await startPortalSession(pool, { actor: A(f.host, 'HOST'), tokenHash: 'HH' }); assert.deepEqual([h.attendance, h.shiftSessionId], ['EXEMPT', null]); await endPortalSession(pool, { tokenHash: 'HH' }); assert.equal(await n('SELECT count(*)::int AS n FROM shift_sessions WHERE employee_id=$1', [f.host]), 0);
  });
  it('idle expiry and a forgotten sign-out are FLAGGED for correction, never closed with an invented time', async () => {
    const a = await startPortalSession(pool, { actor: S(), tokenHash: 'I1', now: t('2026-10-21T04:00:00Z') }); const e = await expireIdleSessions(pool, t('2026-10-21T04:31:00Z')); assert.deepEqual(e, { expired: 1, flagged: 1 });
    const s1 = (await pool.query('SELECT clock_out, needs_recovery FROM shift_sessions WHERE id=$1', [a.shiftSessionId])).rows[0]; assert.deepEqual([s1.clock_out, s1.needs_recovery], [null, true]);
    const b = await startPortalSession(pool, { actor: S(), tokenHash: 'I2', now: t('2026-10-21T05:00:00Z') }); assert.equal(b.shiftSessionId, a.shiftSessionId); assert.equal((await pool.query('SELECT needs_recovery FROM shift_sessions WHERE id=$1', [a.shiftSessionId])).rows[0].needs_recovery, false);
    const c = await startPortalSession(pool, { actor: S(), tokenHash: 'I3', now: t('2026-10-23T04:00:00Z') }); assert.notEqual(c.shiftSessionId, a.shiftSessionId);   // next day: yesterday was never signed out
    const old = (await pool.query('SELECT clock_out, missing_clock_out, needs_recovery, ended_by, net_minutes FROM shift_sessions WHERE id=$1', [a.shiftSessionId])).rows[0]; assert.deepEqual([old.missing_clock_out, old.needs_recovery, old.ended_by, old.net_minutes, !!old.clock_out], [true, true, 'SYSTEM_RECOVERY', null, true]);
  });
  it('many parallel logins create exactly one attendance session', async () => {
    const r = await Promise.all([...Array(8)].map((_, i) => startPortalSession(pool, { actor: S(), tokenHash: 'P' + i, now: t('2026-10-21T04:00:00Z') }))); assert.equal(new Set(r.map(x => x.shiftSessionId)).size, 1); assert.equal(await n('SELECT count(*)::int AS n FROM shift_sessions WHERE employee_id=$1', [f.sales1]), 1);
  });
});

describe('Phase 2: sales attribution is a historical snapshot; one authoritative status', () => {
  let f: Fx; beforeEach(async () => { f = await fixture(); fin = await finance(); });
  it('dealer, Host and unassigned orders are attributed correctly and survive reassignment', async () => {
    const byDealer = (await place(f.d1, [{ productId: f.pA, qty: 1 }])).orderId, byHost = (await place(f.d1, [{ productId: f.pA, qty: 1 }], { actor: { type: 'EMPLOYEE', id: f.host, role: 'HOST' } })).orderId, none = (await place(f.d3, [{ productId: f.pA, qty: 1 }])).orderId;
    const H = A(f.host, 'HOST'), rows = (await listOrders(pool, H)).rows, by = (id: string) => rows.find(r => r.id === id)!;
    assert.deepEqual([by(byDealer).generatedBy.kind, by(byDealer).generatedBy.code, by(byDealer).salesEmployee?.code], ['DEALER', 'D1', 'SAL01']);
    assert.deepEqual([by(byHost).generatedBy.kind, by(byHost).generatedBy.code, by(byHost).generatedBy.role, by(byHost).salesEmployee?.code], ['EMPLOYEE', 'HOST01', 'HOST', 'SAL01']);
    assert.deepEqual([by(none).salesEmployee, by(none).attribution], [null, 'PENDING']);
    await pool.query('UPDATE dealers SET sales_employee_id=$1 WHERE id=$2', [f.sales2, f.d1]); const later = (await place(f.d1, [{ productId: f.pA, qty: 1 }])).orderId, rows2 = (await listOrders(pool, H)).rows;
    assert.equal(rows2.find(r => r.id === byDealer)!.salesEmployee?.code, 'SAL01'); assert.equal(rows2.find(r => r.id === later)!.salesEmployee?.code, 'SAL02');
    await assert.rejects(pool.query("UPDATE orders SET creator_name='Someone else' WHERE id=$1", [byDealer]), /SNAPSHOT_IMMUTABLE/); await assert.rejects(pool.query("UPDATE orders SET sales_employee_name='Hacked' WHERE id=$1", [byDealer]), /SNAPSHOT_IMMUTABLE/);
  });
  it('all departments and the dealer read the SAME status; each role sees only its own scope', async () => {
    const o = (await place(f.d1, [{ productId: f.pA, qty: 1 }])).orderId; await payOrder(o); await attachInvoiceNumbered(pool, pdf(o, f.logi)); const truth = (await pool.query('SELECT status FROM orders WHERE id=$1', [o])).rows[0].status as string;
    for (const who of [A(f.host, 'HOST'), A(fin, 'FINANCE'), A(f.logi, 'LOGISTICS'), A(f.wh, 'WAREHOUSE'), A(f.sales1, 'SALES'), { type: 'DEALER', id: f.d1, role: 'DEALER' } as Actor]) assert.equal((await getOrderStatusView(pool, who, o)).status, truth, who.role);
    assert.equal((await listOrders(pool, A(f.sales2, 'SALES'))).total, 0, 'another Sales employee sees nothing'); assert.equal((await listOrders(pool, { type: 'DEALER', id: f.d2, role: 'DEALER' })).total, 0, 'another dealer sees nothing');
    const p = (await place(f.d1, [{ productId: f.pA, qty: 1 }])).orderId; assert.equal((await listOrders(pool, A(f.wh, 'WAREHOUSE'))).rows.some(r => r.id === p), false, 'unpaid orders are not shown to the Warehouse');
    const pg1 = await listOrders(pool, A(f.host, 'HOST'), { pageSize: 1 }); assert.equal(pg1.rows.length, 1); assert.ok(pg1.total >= 2); assert.equal((await listOrders(pool, A(f.host, 'HOST'), { q: 'D1', status: 'PENDING_PAYMENT' })).rows.every(r => r.status === 'PENDING_PAYMENT'), true);
  });
});

describe('Phase 2: manual payment proof (screenshot) never counts until Finance verifies', () => {
  let f: Fx; beforeEach(async () => { f = await fixture(); fin = await finance(); });
  const D = (): Actor => ({ type: 'DEALER', id: f.d1, role: 'DEALER' });
  const proof = (orderId: string, over: any = {}) => ({ orderId, method: 'UPI', reference: 'UTR' + Math.random().toString(36).slice(2, 12).toUpperCase(), paidOn: '2026-10-20', claimedPaise: 200000n, filename: 's.png', contentType: 'image/png', sizeBytes: 5000, sha256: 'd'.repeat(64), storageKey: 'proofs/' + Math.random(), header: Buffer.from('89504e470d0a', 'hex'), ...over });
  const credits = async (o: string) => BigInt((await pool.query('SELECT coalesce(sum(amount_paise),0) AS s FROM target_credit_ledger WHERE order_id=$1', [o])).rows[0].s);
  it('an upload changes nothing: order stays unpaid, no capture, no target credit; it joins the Finance queue', async () => {
    const o = (await place(f.d1, [{ productId: f.pA, qty: 2 }])).orderId; await uploadPaymentProof(pool, D(), proof(o));
    const r = (await listOrders(pool, A(fin, 'FINANCE'))).rows.find(x => x.id === o)!; assert.deepEqual([r.status, r.paymentStatus, r.proofPending, r.paidPaise], ['PENDING_PAYMENT', 'VERIFICATION_PENDING', true, 0n]);
    assert.equal(await n('SELECT count(*)::int AS n FROM payment_captures WHERE order_id=$1', [o]), 0); assert.equal(await credits(o), 0n); assert.equal(await n("SELECT count(*)::int AS n FROM notifications WHERE kind='PAYMENT_PROOF_UPLOADED' AND recipient_department='FINANCE'"), 1);
  });
  it('validates type, content, size, date, amount, reference; one UTR backs one live claim; a rejected proof can be replaced', async () => {
    const o = (await place(f.d1, [{ productId: f.pA, qty: 2 }])).orderId;
    await assert.rejects(uploadPaymentProof(pool, D(), proof(o, { contentType: 'application/zip' })), code('BAD_FILE_TYPE')); await assert.rejects(uploadPaymentProof(pool, D(), proof(o, { header: Buffer.from('504b0304', 'hex') })), code('BAD_FILE_TYPE'));
    await assert.rejects(uploadPaymentProof(pool, D(), proof(o, { sizeBytes: 11 * 1024 * 1024 })), code('FILE_TOO_LARGE')); await assert.rejects(uploadPaymentProof(pool, D(), proof(o, { paidOn: '2099-01-01' })), code('BAD_DATE'));
    await assert.rejects(uploadPaymentProof(pool, D(), proof(o, { reference: '123' })), code('REFERENCE_REQUIRED')); await assert.rejects(uploadPaymentProof(pool, D(), proof(o, { claimedPaise: 999999999n })), code('OVERPAYMENT'));
    await assert.rejects(uploadPaymentProof(pool, { type: 'DEALER', id: f.d2, role: 'DEALER' }, proof(o)), code('FORBIDDEN'));
    const a = await uploadPaymentProof(pool, D(), proof(o, { reference: 'UTR-SAME-0001' })); await assert.rejects(uploadPaymentProof(pool, D(), proof(o, { reference: 'utr-same-0001' })), code('DUPLICATE_REFERENCE'));
    await rejectPaymentProof(pool, A(fin, 'FINANCE'), { proofId: a.proofId, reason: 'Amount not found in bank statement' }); const b = await uploadPaymentProof(pool, D(), proof(o, { reference: 'UTR-SAME-0001', supersedes: a.proofId })); assert.equal(b.status, 'AWAITING_VERIFICATION');
    assert.equal((await pool.query('SELECT rejection_reason FROM payment_proofs WHERE id=$1', [a.proofId])).rows[0].rejection_reason, 'Amount not found in bank statement'); await assert.rejects(verifyPaymentProof(pool, A(fin, 'FINANCE'), { proofId: a.proofId, verifiedPaise: 1n, notes: 'bank line 12' }), code('ALREADY_REJECTED'));
  });
  it('only Finance verifies, never the uploader; a PARTIAL verification credits only that amount; the final one pays the order', async () => {
    const o = (await place(f.d1, [{ productId: f.pA, qty: 2 }])).orderId, F = A(fin, 'FINANCE');                                  // total 200,000 paise
    const p1 = await uploadPaymentProof(pool, D(), proof(o, { claimedPaise: 80000n })), p2 = await uploadPaymentProof(pool, D(), proof(o, { claimedPaise: 120000n }));
    await assert.rejects(verifyPaymentProof(pool, A(f.sales1, 'SALES'), { proofId: p1.proofId, verifiedPaise: 80000n, notes: 'looks fine' }), code('FORBIDDEN')); await assert.rejects(verifyPaymentProof(pool, F, { proofId: p1.proofId, verifiedPaise: 80000n, notes: '' }), code('NOTES_REQUIRED'));
    const own = await uploadPaymentProof(pool, F, proof((await place(f.d1, [{ productId: f.pA, qty: 1 }])).orderId, { claimedPaise: 100000n })); await assert.rejects(verifyPaymentProof(pool, F, { proofId: own.proofId, verifiedPaise: 100000n, notes: 'bank line 3' }), code('SELF_VERIFY'));
    const r1 = await verifyPaymentProof(pool, F, { proofId: p1.proofId, verifiedPaise: 80000n, notes: 'Bank statement 20 Oct line 14' }); assert.deepEqual([r1.orderPaid, r1.paidPaise], [false, 80000n]);
    let row = (await listOrders(pool, F)).rows.find(x => x.id === o)!; assert.deepEqual([row.status, row.paymentStatus], ['PENDING_PAYMENT', 'PARTIALLY_PAID']); assert.equal(await credits(o), 80000n); assert.equal((await pool.query('SELECT reserved FROM inventory_balances WHERE product_id=$1', [f.pA])).rows[0].reserved >= 2, true, 'stock stays reserved until fully paid');
    const r2 = await verifyPaymentProof(pool, F, { proofId: p2.proofId, verifiedPaise: 120000n, notes: 'Bank statement 21 Oct line 2' }); assert.deepEqual([r2.orderPaid, r2.paidPaise], [true, 200000n]);
    row = (await listOrders(pool, F)).rows.find(x => x.id === o)!; assert.deepEqual([row.status, row.paymentStatus], ['PAID_AWAITING_LOGISTICS', 'PAID']); assert.equal(await credits(o), 200000n);
    assert.equal(await n("SELECT count(*)::int AS n FROM notifications WHERE kind='ORDER_PAID' AND order_id=$1", [o]), 1);
  });
  it('verifying twice or in parallel creates ONE capture and ONE target credit; Razorpay payments are unaffected', async () => {
    const o = (await place(f.d1, [{ productId: f.pA, qty: 2 }])).orderId, F = A(fin, 'FINANCE'), p = await uploadPaymentProof(pool, D(), proof(o));
    const rs = await Promise.allSettled([...Array(6)].map(() => verifyPaymentProof(pool, F, { proofId: p.proofId, verifiedPaise: 200000n, notes: 'Bank statement line 9' }))); assert.equal(rs.every(r => r.status === 'fulfilled'), true);
    assert.equal(await n("SELECT count(*)::int AS n FROM payment_captures WHERE provider_txn_ref=$1", ['MANUAL:' + p.proofId]), 1); assert.equal(await credits(o), 200000n); assert.equal(await n("SELECT count(*)::int AS n FROM target_credit_ledger WHERE order_id=$1", [o]), 1);
    await assert.rejects(verifyPaymentProof(pool, F, { proofId: (await uploadPaymentProof(pool, D(), proof((await place(f.d1, [{ productId: f.pA, qty: 1 }])).orderId, { claimedPaise: 100000n }))).proofId, verifiedPaise: 100001n, notes: 'bank line' }), code('BAD_AMOUNT'));
    const r = (await place(f.d1, [{ productId: f.pB, qty: 2 }])).orderId, pay = await payOrder(r); assert.equal(pay.outcome, 'CAPTURED'); const row = (await listOrders(pool, F)).rows.find(x => x.id === r)!; assert.deepEqual([row.status, row.paymentStatus, row.paidPaise], ['PAID_AWAITING_LOGISTICS', 'PAID', 100000n]);
    await assert.rejects(uploadPaymentProof(pool, D(), proof(r, { claimedPaise: 1000n })), code('ORDER_NOT_PAYABLE'));          // a screenshot can never override a provider-confirmed payment
  });
});

describe('Phase 3: batch inventory', () => {
  let f: Fx; beforeEach(async () => { f = await fixture(); fin = await finance(); });
  const L = () => A(f.logi, 'LOGISTICS'), W = () => A(f.wh, 'WAREHOUSE'), F = () => A(fin, 'FINANCE');
  const rec = (over: any = {}) => receiveBatch(pool, L(), { productId: f.pStock, batchNumber: 'B1', mfgDate: '2026-01-01', expiryDate: '2028-12-31', qty: 5, supplier: 'Acme', receiptRef: 'GRN-1', unitCostPaise: 7000, ...over });
  const bal = async () => (await pool.query('SELECT on_hand, reserved FROM inventory_balances WHERE product_id=$1', [f.pStock])).rows[0];
  it('Stock In records batch, manufacturing and expiry; earlier stock is kept as an opening batch; validation is strict; costs are hidden from non-finance roles', async () => {
    const r = await rec(); assert.deepEqual((await bal()).on_hand, 15);                                                   // 10 existing + 5 new
    const rows = await batchInventoryView(pool, F(), f.pStock); assert.deepEqual(rows.map((x: any) => [x.batch_number, x.qty_on_hand]).sort(), [['B1', 5], ['OPENING-LEGACY', 10]]); assert.equal(String((rows.find((x: any) => x.batch_number === 'B1') as any).unit_cost_paise), '7000');
    assert.equal('unit_cost_paise' in ((await batchInventoryView(pool, L(), f.pStock))[0] as any), false); assert.equal('unit_cost_paise' in ((await batchInventoryView(pool, A(f.sales1, 'SALES'), f.pStock))[0] as any), false);
    await assert.rejects(rec({ batchNumber: 'B2', mfgDate: '2029-01-01' }), code('MFG_AFTER_EXPIRY')); await assert.rejects(rec({ batchNumber: 'B3', expiryDate: '2020-01-01', mfgDate: '2019-01-01' }), code('ALREADY_EXPIRED')); await assert.rejects(rec({ qty: 0 }), code('BAD_QTY'));
    await assert.rejects(rec({ batchNumber: '' }), code('BATCH_REQUIRED')); await assert.rejects(rec({ mfgDate: '2026-02-30' }), code('BAD_DATE')); await assert.rejects(rec({ expiryDate: '2029-12-31' }), code('BATCH_DATES_MISMATCH'));
    await rec({ qty: 3 }); assert.equal((await bal()).on_hand, 18); assert.equal(await n("SELECT count(*)::int AS n FROM batch_movements WHERE kind='STOCK_IN' AND batch_id=$1", [r.batchId]), 2);
    await assert.rejects(receiveStock(pool, { productId: f.pStock, qty: 1, actor: L() }), code('USE_BATCH_INVENTORY')); await assert.rejects(receiveBatch(pool, A(f.sales1, 'SALES'), { productId: f.pStock, batchNumber: 'Z', mfgDate: '2026-01-01', expiryDate: '2028-01-01', qty: 1 }), code('FORBIDDEN'));
  });
  it('Stock Out follows FEFO, never exceeds the batch, and never issues quarantined or expired stock', async () => {
    const b1 = await rec({ batchNumber: 'LATE', expiryDate: '2028-12-31', qty: 5 }), b2 = await rec({ batchNumber: 'EARLY', expiryDate: '2027-01-31', qty: 5 });
    const out = await issueStock(pool, W(), { productId: f.pStock, qty: 7, reason: 'sent for display' }); assert.deepEqual(out.map(x => [x.batchNumber, x.qty]), [['EARLY', 5], ['LATE', 2]]);
    await assert.rejects(issueStock(pool, W(), { productId: f.pStock, batchId: b2.batchId, qty: 1, reason: 'sent for display' }), code('INSUFFICIENT_BATCH_STOCK')); await assert.rejects(issueStock(pool, W(), { productId: f.pStock, qty: 1, reason: '' }), code('REASON_REQUIRED'));
    await setBatchStatus(pool, W(), b1.batchId, 'QUARANTINED', 'inspection pending'); await assert.rejects(issueStock(pool, W(), { productId: f.pStock, batchId: b1.batchId, qty: 1, reason: 'sent for display' }), code('BATCH_NOT_SALEABLE'));
    assert.equal((await stockStatus(pool, f.pStock)), 'LOW_STOCK'); const left = (await bal()).on_hand; assert.equal(left, 10, 'quarantined batch no longer counts as saleable (10 opening units remain)');
    await setBatchStatus(pool, W(), b1.batchId, 'ACTIVE', 'inspection passed'); await pool.query("UPDATE inventory_batches SET expiry_date = current_date - 1, mfg_date = current_date - 400 WHERE id=$1", [b1.batchId]);
    await assert.rejects(issueStock(pool, W(), { productId: f.pStock, batchId: b1.batchId, qty: 1, reason: 'sent for display' }), code('BATCH_EXPIRED')); const ex = await expireBatches(pool); assert.equal(ex.expired, 1); assert.equal((await bal()).on_hand, 10);
    await assert.rejects(setBatchStatus(pool, W(), b1.batchId, 'ACTIVE', 'trying to release expired'), code('BATCH_EXPIRED'));
  });
  it('25 parallel Stock Outs on a batch of 10 succeed exactly 10 times; history is immutable', async () => {
    const b = await rec({ qty: 10 }); const rs = await Promise.allSettled([...Array(25)].map(() => issueStock(pool, W(), { productId: f.pStock, batchId: b.batchId, qty: 1, reason: 'sent for display' })));
    assert.equal(rs.filter(r => r.status === 'fulfilled').length, 10); assert.equal((await pool.query('SELECT qty_on_hand FROM inventory_batches WHERE id=$1', [b.batchId])).rows[0].qty_on_hand, 0); assert.equal(await n("SELECT count(*)::int AS n FROM batch_movements WHERE batch_id=$1 AND kind='STOCK_OUT'", [b.batchId]), 10);
    await assert.rejects(pool.query("UPDATE batch_movements SET reason='edited' WHERE batch_id=$1", [b.batchId]), /IMMUTABLE_HISTORY/); await assert.rejects(pool.query('DELETE FROM batch_movements WHERE batch_id=$1', [b.batchId]), /IMMUTABLE_HISTORY/);
  });
  it('counts and adjustments are requests: nothing changes until a different approver approves; one auditable movement is posted; stale or reserved-conflicting requests are flagged', async () => {
    const b = await rec({ qty: 5 }), before = (await bal()).on_hand;
    const q = await requestAdjustment(pool, L(), { batchId: b.batchId, newQty: 3, reason: 'Physical count found 2 missing', kind: 'COUNT' }); assert.deepEqual([q.systemQty, q.variance], [5, -2]); assert.equal((await bal()).on_hand, before, 'a request does not change stock');
    await assert.rejects(decideAdjustment(pool, L(), q.requestId, true, 'ok'), code('FORBIDDEN')); const fr = await requestAdjustment(pool, F(), { batchId: b.batchId, newQty: 4, reason: 'Finance recount', kind: 'ADJUST' }); await assert.rejects(decideAdjustment(pool, F(), fr.requestId, true, 'self approve'), code('SELF_APPROVAL'));
    const ok = await decideAdjustment(pool, F(), q.requestId, true, 'Approved after recount'); assert.equal(ok.status, 'APPROVED'); assert.equal((await bal()).on_hand, before - 2); assert.deepEqual((await decideAdjustment(pool, F(), q.requestId, true, 'again')), { already: true, status: 'APPROVED' });
    const mv = (await pool.query("SELECT kind, delta_on_hand, on_hand_before, on_hand_after, actor_id FROM batch_movements WHERE kind='COUNT_ADJUSTMENT'")).rows; assert.equal(mv.length, 1); assert.deepEqual([mv[0].delta_on_hand, mv[0].on_hand_before, mv[0].on_hand_after, mv[0].actor_id], [-2, 5, 3, fin]);
    assert.equal((await decideAdjustment(pool, F(), (await requestAdjustment(pool, L(), { batchId: b.batchId, newQty: 2, reason: 'bad count', kind: 'COUNT' })).requestId, false, 'Rejected: recount needed')).status, 'REJECTED');
    const stale = await requestAdjustment(pool, L(), { batchId: b.batchId, newQty: 1, reason: 'count taken earlier', kind: 'COUNT' }); await issueStock(pool, W(), { productId: f.pStock, batchId: b.batchId, qty: 1, reason: 'sent for display' }); assert.equal((await decideAdjustment(pool, F(), stale.requestId, true, 'approve')).status, 'CONFLICT');
    await place(f.d1, [{ productId: f.pStock, qty: 12 }]); const rsv = await requestAdjustment(pool, L(), { batchId: b.batchId, newQty: 0, reason: 'write off remaining', kind: 'ADJUST' }); await assert.rejects(decideAdjustment(pool, F(), rsv.requestId, true, 'approve'), code('RESERVATION_CONFLICT'));
    assert.equal((await pool.query('SELECT status FROM stock_adjustment_requests WHERE id=$1', [rsv.requestId])).rows[0].status, 'CONFLICT'); assert.equal((await pool.query('SELECT qty_on_hand FROM inventory_batches WHERE id=$1', [b.batchId])).rows[0].qty_on_hand, 2);
  });
  it('a paid order consumes the earliest-expiring batch (FEFO) and records it', async () => {
    await rec({ batchNumber: 'LATE', expiryDate: '2028-12-31', qty: 5 }); const early = await rec({ batchNumber: 'EARLY', expiryDate: '2027-01-31', qty: 5 }); const o = (await place(f.d1, [{ productId: f.pStock, qty: 3 }])).orderId; await payOrder(o);
    assert.equal((await pool.query('SELECT qty_on_hand FROM inventory_batches WHERE id=$1', [early.batchId])).rows[0].qty_on_hand, 2); assert.deepEqual(await bal(), { on_hand: 17, reserved: 0 });
    assert.equal(await n("SELECT count(*)::int AS n FROM batch_movements WHERE kind='ISSUE_ORDER' AND ref_id=$1", [o]), 1);
  });
});

describe('Phase 4: Warehouse "seen" indicator', () => {
  let f: Fx; beforeEach(async () => { f = await fixture(); fin = await finance(); });
  const state = async (who: Actor, o: string) => (await listOrders(pool, who)).rows.find(r => r.id === o)?.warehouse?.state ?? null;
  it('a list never marks an order seen; only a Warehouse employee opening the order does; state moves Seen > Packing > Packed and is visible to Host, Finance, Logistics and Sales', async () => {
    const o = (await place(f.d1, [{ productId: f.pA, qty: 1 }])).orderId; await payOrder(o); await attachInvoiceNumbered(pool, pdf(o, f.logi)); const H = A(f.host, 'HOST'), FN = A(fin, 'FINANCE'), LG = A(f.logi, 'LOGISTICS'), S = A(f.sales1, 'SALES'), W = A(f.wh, 'WAREHOUSE');
    await listOrders(pool, W); await listOrders(pool, W, { q: 'D1' }); assert.equal(await n('SELECT count(*)::int AS n FROM order_view_events'), 0, 'listing is not viewing');
    for (const who of [H, FN, LG, S]) assert.equal(await state(who, o), 'NOT_SEEN');
    await assert.rejects(recordOrderView(pool, S, o), code('FORBIDDEN')); await assert.rejects(recordOrderView(pool, H, o), code('FORBIDDEN')); await assert.rejects(recordOrderView(pool, LG, o), code('FORBIDDEN'));
    const w2 = (await pool.query("INSERT INTO employees (employee_code, name, email, department_id, status) VALUES ('WH02','WH02','wh02@s-eleven.test',(SELECT id FROM departments WHERE code='WAREHOUSE'),'ACTIVE') RETURNING id")).rows[0].id as string;
    const v1 = await recordOrderView(pool, W, o, 'VIEWED', t('2026-10-21T05:00:00Z')); await recordOrderView(pool, A(w2, 'WAREHOUSE'), o, 'VIEWED', t('2026-10-21T06:00:00Z')); assert.equal(v1.seenCount, 1);
    for (const who of [H, FN, LG, S]) assert.equal(await state(who, o), 'SEEN'); const row = (await listOrders(pool, H)).rows.find(r => r.id === o)!.warehouse!; assert.deepEqual([row.seenCount, row.lastSeenByCode, row.firstSeenAt?.toISOString()], [2, 'WH02', '2026-10-21T05:00:00.000Z']);
    assert.equal(await n('SELECT count(*)::int AS n FROM order_view_events WHERE order_id=$1', [o]), 2, 'the view history keeps every viewer');
    await packAll(o, W); assert.equal(await state(H, o), 'PACKED'); assert.equal((await listOrders(pool, { type: 'DEALER', id: f.d1, role: 'DEALER' })).rows[0].warehouse, null, 'dealers never see the internal indicator');
  });
  it('Packing Started is shown while packing is in progress; unpaid orders are not eligible', async () => {
    const o = (await place(f.d1, [{ productId: f.pA, qty: 1 }])).orderId; await assert.rejects(recordOrderView(pool, A(f.wh, 'WAREHOUSE'), o), code('NOT_ELIGIBLE')); assert.equal(await state(A(f.host, 'HOST'), o), null);
    await payOrder(o); await attachInvoiceNumbered(pool, pdf(o, f.logi)); const { startPacking } = await import('../src/services/packing.js'); await startPacking(pool, o, A(f.wh, 'WAREHOUSE')); assert.equal(await state(A(f.host, 'HOST'), o), 'PACKING_STARTED');
  });
});
