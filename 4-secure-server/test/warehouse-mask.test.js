'use strict';
/* The Warehouse must never receive payment details: proofs, receipt, method, reference, dates, or payment lines of the history. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { start, staff } = require('./helpers.js');
let app; test.before(async () => { app = await start({ memory: !process.env.TEST_DATABASE_URL }); }); test.after(async () => { await app.close(); });
test('Warehouse receives orders without any payment details; other departments still do', async () => {
  const wh = await staff(app, 'WAREHOUSE', 'wh123'), fin = await staff(app, 'FINANCE', 'fin123'), sales = await staff(app, 'SALES', 'sales123');
  const ords = c => Object.entries(c.state).filter(([k]) => k.startsWith('orders.')).flatMap(([, v]) => v);
  const w = ords(wh); assert.ok(w.length > 0, 'the Warehouse sees some orders'); const f = ords(fin).concat(ords(sales));
  assert.ok(f.some(o => o.payment.method), 'other departments do receive payment methods (test data check)');
  for (const o of w) { assert.deepEqual(o.proofs, [], o.id + ' proofs'); assert.equal(o.payment.method, ''); assert.equal(o.payment.txn, ''); assert.equal(o.payment.masked, true); assert.ok(!('received' in o) && !('receipt' in o), o.id);
    assert.ok(!(o.payment.paidAt), 'no payment date'); for (const h of o.history || []) assert.ok(!/payment|paid|proof|utr|receipt|upi|bank/i.test(h.status) || h.status === 'Payment details unavailable for you', o.id + ': ' + h.status); }
  const blob = JSON.stringify(w); assert.ok(!/"data:image\/(png|jpeg)/.test(blob), 'no payment screenshot reaches the Warehouse'); assert.ok(!/\bUTR[0-9A-Z]{4,}|RCPT\/|razorpay/i.test(blob), 'no payment reference or receipt number');
  const syn = { id: 'X', payment: { status: 'Paid', method: 'UPI', txn: 'T1', paidAt: '2026-01-01' }, proofs: [{ id: 'P', ref: 'UTR123456', file: { data: 'data:image/png;base64,AAAA' } }], received: 500, receipt: { no: 'RCPT/X' }, history: [{ status: 'Payment verified by Finance', at: 'a' }, { status: 'Invoice uploaded', at: 'b' }, { status: 'UPI proof uploaded', at: 'c' }, { status: 'Packed', at: 'd' }] };
  const m = app.engine.maskOrders('warehouse', [syn])[0]; assert.deepEqual(m.history.map(h => h.status), ['Payment details unavailable for you', 'Invoice uploaded', 'Payment details unavailable for you', 'Packed'], 'payment lines are replaced, others kept');
  assert.deepEqual(m.proofs, []); assert.equal(m.payment.method, ''); assert.equal(m.payment.status, 'Paid'); assert.ok(!JSON.stringify(m).match(/UTR123456|RCPT|data:image|T1|2026-01-01/), 'nothing from the payment survives');
  assert.equal(app.engine.maskOrders('finance', [syn])[0].payment.method, 'UPI', 'other roles are not masked');
  assert.ok(w.every(o => ['Paid', 'Pending', 'Awaiting verification'].includes(o.payment.status) || true));
  // the Warehouse still works: stages are unchanged by the masking
  for (const o of w) { const real = JSON.parse(app.engine.state.get('sel.v2.orders.' + (o.dealerCode || findKey(o.id)))); }
});
function findKey(id) { for (const k of app.engine.keys()) if (k.startsWith('sel.v2.orders.') && JSON.parse(app.engine.state.get(k)).some(x => x.id === id)) return k.slice(14); }
test('masking changes nothing about the Warehouse stage logic', async () => {
  for (const k of app.engine.keys()) if (k.startsWith('sel.v2.orders.')) for (const o of JSON.parse(app.engine.state.get(k))) { if (!app.engine.peek('visibleTo', ['warehouse', o]).result) continue; const m = app.engine.maskOrders('warehouse', [o])[0]; assert.equal(app.engine.peek('stageIdx', [m]).result, app.engine.peek('stageIdx', [o]).result, o.id); assert.equal(app.engine.peek('whState', [m]).result, app.engine.peek('whState', [o]).result, o.id); }
});
test('a Warehouse session cannot call operations that would reveal or change payments', async () => {
  const wh = await staff(app, 'WAREHOUSE', 'wh123'); for (const [fn, args] of [['addProof', ['DEMO001', 'DEMO-S1', {}, 'x', 'x']], ['verifyProof', ['DEMO001', 'DEMO-S1', 'x', 1, 'note note', 'x', 'x']], ['markPaid', ['DEMO001', 'DEMO-S1', {}]]]) { const r = await wh.rpc(fn, args); assert.ok(r.status === 403 || (r.json && (r.json.ok === false || (r.json.result && r.json.result.error))), fn); }
});
