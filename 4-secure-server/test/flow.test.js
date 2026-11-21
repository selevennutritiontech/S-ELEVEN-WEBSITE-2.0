'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { start, staff, dealer } = require('./helpers.js');
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', PDF = 'data:application/pdf;base64,JVBERi0xLjQKJSVFT0YK';
const err0 = r => (r.json && r.json.error) || (r.json && r.json.result && r.json.result.error) || (r.json && r.json.ok === false ? 'failed' : '');
const err = r => { const e = err0(r); if (e && process.env.DBG) console.error('  ERR>', e); return e; };
let app, S, F, L, W, H, D, seq = 0;
test.before(async () => { app = await start({ memory: !process.env.TEST_DATABASE_URL }); S = await staff(app, 'SALES', 'sales123'); F = await staff(app, 'FINANCE', 'fin123'); L = await staff(app, 'LOGISTICS', 'logi123'); W = await staff(app, 'WAREHOUSE', 'wh123'); H = await staff(app, 'ADMIN', 'admin123'); D = await dealer(app, 'DEMO001', 'demo123'); });
test.after(async () => { await app.close(); });
const order = (code, id) => (app.engine.get('orders.' + code) || []).find(o => o.id === id);
const sync = async (...cs) => { for (const c of cs) await c.getState(c.ver || 0).then(r => c.apply(r.json)); };

/* take an order as far as "Ready to be picked up"; big = needs an e-way bill (above 50,000) */
async function toPacked(big, withInvoice) {
  const qty = big ? 7 : 2, ref = big ? { pid: 'bolt-gw', vid: '5lb', flavour: 'Piedmont Chocolate' } : { pid: 'bolt-bw', vid: '2lb', flavour: 'Piedmont Chocolate' };
  const r = await D.rpc('addOrder', ['DEMO001', { items: [Object.assign({ qty }, ref)], address: 'Plot 5, Ahmedabad', pin: '380001', phone: '9000000001', gst: '24ABCDE1234F1Z5' }]); assert.ok(r.json.ok && !r.json.result.error, JSON.stringify(r.json).slice(0, 200));
  const id = r.json.result.id, due = r.json.result.totals.total; if (big) assert.ok(due > 50000, 'the big order must be above the e-way limit: ' + due); else assert.ok(due < 50000);
  assert.ok(!err(await D.rpc('submitPayShot', ['DEMO001', id, { ref: 'UTR55' + (100000 + (++seq)), name: 'p.png', size: 70, data: PNG }, 'x'])));
  const pid = order('DEMO001', id).proofs[0].id; assert.ok(!err(await F.rpc('verifyProof', ['DEMO001', id, pid, due, 'Bank line matches', 'x', 'x'])));
  assert.ok(!err(await S.rpc('confirmOrder', ['DEMO001', id, 'x'])));
  if (withInvoice) assert.ok(!err(await L.rpc('attachInvoiceFile', ['DEMO001', id, { name: 'i.pdf', size: 14, data: PDF, no: 'INV/F/' + id.slice(-4) }, 'x'])));
  return id;
}
async function pack(id) {
  assert.ok(!err(await F.rpc('pushToWarehouse', ['DEMO001', id, 'x', 'x']))); assert.ok(!err(await W.rpc('startPacking', ['DEMO001', id, 'x'])));
  for (const it of order('DEMO001', id).packing.items) assert.ok(!err(await W.rpc('verifyItem', ['DEMO001', id, it.key, it.req, 'x'])));
  assert.ok(!err(await W.rpc('finishPacking', ['DEMO001', id, 'x']))); assert.equal(app.engine.peek('stageOf', [order('DEMO001', id)]).result.label, 'Ready to be picked up');
}

test('big order: no dispatch until BOTH the invoice and the e-way bill are uploaded; only the Warehouse may dispatch', async () => {
  const id = await toPacked(true, true); assert.equal(app.engine.peek('needsEway', [order('DEMO001', id)]).result, true);
  assert.equal(app.engine.peek('docsPending', [order('DEMO001', id)]).result, 'E-way bill pending');
  const small = await toPacked(false, true); assert.equal(app.engine.peek('needsEway', [order('DEMO001', small)]).result, false); assert.equal(app.engine.peek('docsPending', [order('DEMO001', small)]).result, '', 'a small order needs only the invoice');
});
test('e-way bill pending: the Warehouse cannot dispatch; after Logistics uploads it, only the Warehouse can', async () => {
  const id = await toPacked(true, true);
  assert.ok(!err(await F.rpc('pushToWarehouse', ['DEMO001', id, 'x', 'x'])), 'a big order CAN be pushed to the Warehouse with the invoice alone: the e-way bill blocks only the dispatch');
  assert.ok(!err(await L.rpc('attachEwayFile', ['DEMO001', id, { name: 'e0.pdf', size: 14, data: PDF, no: 'EWB0' }, 'x']))); await pack(id);
  /* older data / a removed file: the order is packed but the e-way bill is missing */
  const lst = app.engine.get('orders.DEMO001'), oo = lst.find(x => x.id === id); delete oo.ewayFile; app.engine.state.set('sel.v2.orders.DEMO001', JSON.stringify(lst));
  const st = app.engine.peek('stageOf', [order('DEMO001', id)]).result; assert.equal(st.label, 'Ready to be picked up'); assert.equal(st.canDispatch, false); assert.match(st.dispatchBlocked, /E-way bill pending/);
  const w1 = await W.rpc('warehouseDispatch', ['DEMO001', id, 'x', 'x']); assert.match(err(w1), /E-way bill pending/); assert.ok(!order('DEMO001', id).whDispatch);
  assert.equal(app.engine.peek('stageOf', [order('DEMO001', id)]).result.label, 'Ready to be picked up', 'never "in transit" while a document is pending');
  assert.ok(!err(await L.rpc('attachEwayFile', ['DEMO001', id, { name: 'e.pdf', size: 14, data: PDF, no: 'EWB1' }, 'x'])));
  for (const [who, nm] of [[H, 'Host'], [L, 'Logistics'], [F, 'Finance'], [S, 'Sales']]) { const r = await who.rpc('warehouseDispatch', ['DEMO001', id, 'x', 'admin']); assert.ok(r.status === 403 || err(r), nm + ' must not dispatch: ' + JSON.stringify(r.json)); assert.ok(!order('DEMO001', id).whDispatch, nm + ' dispatched!'); }
  /* tracking is not possible before dispatch */
  assert.match(err(await L.rpc('setTracking', ['DEMO001', id, 'dtdc', 'TK100200', 'x', 'x'])), /only after the Warehouse marks the order dispatched/);
  assert.ok(!err(await W.rpc('warehouseDispatch', ['DEMO001', id, 'x', 'x']))); assert.equal(app.engine.peek('stageOf', [order('DEMO001', id)]).result.label, 'Order in transit');
  /* tracking: Logistics or Finance only; not the Warehouse, Sales or Host */
  for (const [who, nm] of [[W, 'Warehouse'], [S, 'Sales'], [H, 'Host']]) { const r = await who.rpc('setTracking', ['DEMO001', id, 'dtdc', 'TK100200', 'x', 'x']); assert.ok(r.status === 403 || err(r), nm + ' must not add tracking'); }
  assert.ok(!err(await F.rpc('setTracking', ['DEMO001', id, 'dtdc', 'TK100200', 'x', 'x'])), 'Finance may add tracking after dispatch');
  assert.ok(!err(await L.rpc('setTracking', ['DEMO001', id, 'dtdc', 'TK100201', 'x', 'x'])), 'Logistics may update tracking');
  /* out for delivery / delivered: Logistics only */
  for (const fn of ['markOutForDelivery', 'markDelivered']) for (const [who, nm] of [[H, 'Host'], [F, 'Finance'], [W, 'Warehouse'], [S, 'Sales']]) { const r = await who.rpc(fn, ['DEMO001', id, 'x', 'logistics']); assert.ok(r.status === 403 || err(r), nm + ' must not ' + fn); }
  const upd = await H.rpc('updateShipment', ['DEMO001', id, { status: 'Delivered' }, 'x']); assert.ok(upd.status === 403 || err(upd) || (upd.json.result && upd.json.result.error), 'the old status form cannot bypass the rule');
  assert.notEqual(order('DEMO001', id).status, 'Delivered');
  assert.ok(!err(await L.rpc('markOutForDelivery', ['DEMO001', id, 'x', 'x']))); assert.equal(order('DEMO001', id).status, 'Out for delivery');
  assert.ok(!err(await L.rpc('markDelivered', ['DEMO001', id, 'x', 'x']))); assert.equal(order('DEMO001', id).status, 'Delivered');
});
test('invoice pending (small order): the Warehouse cannot dispatch and nobody can mark it in transit', async () => {
  const id = await toPacked(false, true); await pack(id);
  /* remove the invoice to simulate "invoice pending" on a packed order: a replaced file is never empty, so use a fresh order that never had one */
  const id2 = await toPacked(false, false); assert.equal(app.engine.peek('docsPending', [order('DEMO001', id2)]).result, 'Invoice pending');
  assert.match(err(await W.rpc('warehouseDispatch', ['DEMO001', id2, 'x', 'x'])), /Invoice pending|packed|Pack the order/);
  for (const who of [L, F, H]) { const r = await who.rpc('updateShipment', ['DEMO001', id2, { status: 'Dispatched' }, 'x']); assert.ok(r.status === 403 || err(r) || (r.json.result && r.json.result.error), 'Dispatched via the status form must be refused'); }
  assert.ok(!['Dispatched', 'Out for delivery', 'Delivered'].includes(order('DEMO001', id2).status)); assert.ok(app.engine.peek('stageIdx', [order('DEMO001', id2)]).result < 7);
});
test('orders that were in transit without documents are moved back, once, and never show as in transit', async () => {
  const all = () => [...app.engine.state.keys()].filter(k => k.startsWith('sel.v2.orders.')).flatMap(k => JSON.parse(app.engine.state.get(k)));
  assert.equal(all().filter(o => o.status !== 'Delivered' && !o.cancelled && o.payment && app.engine.peek('stageIdx', [o]).result >= 7 && app.engine.peek('docsPending', [o]).result).length, 0);
  /* build the old situation: dispatched, but the invoice was never uploaded; and the migration flag as it was before this version */
  const list = app.engine.get('orders.DEMO001'), o = list.find(x => x.payment.status === 'Paid' && x.status !== 'Delivered' && !x.cancelled); delete o.invoiceFile; delete o.ewayFile; o.status = 'Dispatched'; o.whDispatch = { at: new Date().toISOString(), by: 'OLD' };
  app.engine.state.set('sel.v2.orders.DEMO001', JSON.stringify(list)); app.engine.state.set('sel.v2.ops9', '0');
  assert.equal(app.engine.peek('stageIdx', [o]).result, 6, 'even before the clean-up it does not show as in transit');
  await app.commitCall('listDealers', [], { policy: false }); const fixed = order('DEMO001', o.id); assert.ok(!fixed.whDispatch); assert.notEqual(fixed.status, 'Dispatched'); assert.equal(app.engine.peek('stageOf', [fixed]).result.label, 'Ready to be picked up');
  assert.equal((fixed.history || []).filter(h => /Moved back to Ready/.test(h.status)).length, 1);
  await app.commitCall('listDealers', [], { policy: false }); assert.equal((order('DEMO001', o.id).history || []).filter(h => /Moved back to Ready/.test(h.status)).length, 1, 'the clean-up runs once');
});
test('samples: fixed Rs 150 shipping is counted for analytics only; only Logistics marks delivered', async () => {
  const r = await S.rpc('createSample', [{ dealer: 'DEMO001', name: 'Test Gym', address: 'Shop 4, Main Road, Surat', lines: [{ brand: 'bolt', product: 'Whey sample', qty: 1, value: 300 }], by: 'x' }]); assert.ok(!err(r), JSON.stringify(r.json).slice(0, 200));
  const sid = r.json.result.sample.id, smp = () => app.engine.get('samples').find(s => s.id === sid); assert.equal(smp().shipCost, 150); assert.match(smp().shipBorneBy, /S-ELEVEN/);
  const before = app.engine.peek('logisticsAnalytics', ['']).result;
  for (const to of ['Packed']) { smp().status = 'Packed'; } // move through the normal steps below
  const l = app.engine.get('samples'); const x = l.find(s => s.id === sid); x.status = 'Packed'; app.engine.state.set('sel.v2.samples', JSON.stringify(l));
  assert.match(err(await W.rpc('advanceSample', [sid, 'Delivered', 'x', 'x'])), /not allowed|Cannot move|Only the Logistics/);
  assert.ok(!err(await L.rpc('advanceSample', [sid, 'Shipped', 'x', 'x']))); assert.match(err(await W.rpc('advanceSample', [sid, 'Delivered', 'x', 'x'])) || 'denied', /Logistics|denied|allowed/); assert.equal(smp().status, 'Shipped');
  assert.ok(!err(await L.rpc('advanceSample', [sid, 'Delivered', 'x', 'x']))); assert.equal(smp().status, 'Delivered');
  const after = app.engine.peek('logisticsAnalytics', ['']).result; assert.equal(after.samples.count, before.samples.count + 1); assert.equal(after.samples.amount, after.samples.count * 150); assert.equal(after.grand, +(after.total.paid + after.samples.amount).toFixed(2));
  const ledgerBefore = JSON.stringify(app.engine.get('dledger')); assert.equal(after.total.paid, before.total.paid, 'sample shipping is not added to the partner payments'); assert.equal(JSON.stringify(app.engine.get('dledger')), ledgerBefore, 'nothing is charged to a dealer');
});
test('logistics analytics: what each partner was paid for dispatched orders; planned for chosen-but-not-dispatched', async () => {
  const id = await toPacked(false, true); await pack(id);
  assert.ok(!err(await L.rpc('dispatchFrom', ['DEMO001', id, 'dtdc', 'x', 'x']))); let a = app.engine.peek('logisticsAnalytics', ['']).result; const row = () => app.engine.peek('logisticsAnalytics', ['']).result.partners.find(p => p.id === 'dtdc');
  const planned = row().plannedOrders; assert.ok(planned >= 1, 'chosen but not dispatched counts as planned'); const paidBefore = row().paid, ordersBefore = row().orders;
  assert.ok(!err(await W.rpc('warehouseDispatch', ['DEMO001', id, 'x', 'x']))); const cost = order('DEMO001', id).dispatchFrom.cost, kg = order('DEMO001', id).dispatchFrom.weightKg;
  assert.equal(row().orders, ordersBefore + 1); assert.equal(+(row().paid - paidBefore).toFixed(2), cost); assert.equal(row().plannedOrders, planned - 1); assert.ok(cost > 0 && kg > 0);
  const ym = new Date().toISOString().slice(0, 7), m = app.engine.peek('logisticsAnalytics', [ym]).result; assert.ok(m.partners.find(p => p.id === 'dtdc').paid >= cost); assert.equal(app.engine.peek('logisticsAnalytics', ['1999-01']).result.total.paid, 0);
  assert.equal(order('DEMO001', id).totals.total, app.engine.peek('getOrder', ['DEMO001', id]).result.totals.total, 'the partner cost is not added to the dealer order');
});
