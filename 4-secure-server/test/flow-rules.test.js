'use strict';
/* The dispatch chain, exactly as the business defined it:
   - the Warehouse alone presses "Order dispatched", and only when the invoice (and the e-way bill above Rs 50,000) is uploaded;
   - tracking is added by Logistics or Finance, and only AFTER the Warehouse has dispatched;
   - no one can put an order "in transit" while a document is pending;
   - only Logistics marks out for delivery / delivered;
   - sample shipping is a fixed Rs 150, borne by the company, counted in the analytics only. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { start, staff } = require('./helpers.js');
const PDF = 'data:application/pdf;base64,JVBERi0xLjQKJSVFT0YK';
let app; const people = {};
const failed = r => r.status !== 200 || !r.json || r.json.ok === false || !!(r.json.result && r.json.result.error);
const denied = r => r.status === 403 || failed(r);
const find = id => { for (const k of app.engine.keys()) if (k.startsWith('sel.v2.orders.')) { const o = JSON.parse(app.engine.state.get(k)).find(x => x.id === id); if (o) { o.dealerCode = k.slice(14); return o; } } };
const stage = id => { const o = find(id); return app.engine.peek('stageOf', [o]).result; };
const sync = async () => { for (const c of Object.values(people)) { const r = await c.getState(c.ver || 0); c.apply(r.json); } };
test.before(async () => { app = await start({ memory: !process.env.TEST_DATABASE_URL }); for (const [k, c, p] of [['wh', 'WAREHOUSE', 'wh123'], ['lg', 'LOGISTICS', 'logi123'], ['fin', 'FINANCE', 'fin123'], ['host', 'ADMIN', 'admin123'], ['sales', 'SALES', 'sales123']]) people[k] = await staff(app, c, p); });
test.after(async () => { await app.close(); });

test('a packed order with the e-way bill pending cannot be dispatched, by anyone', async () => {
  const o = find('DEMO-L3'), c = o.dealerCode; assert.ok(o.totals.total > 50000 && !o.ewayFile && o.invoiceFile);
  assert.equal(stage('DEMO-L3').idx, 6); assert.notEqual(stage('DEMO-L3').label, 'Order in transit');
  for (const k of ['wh', 'lg', 'fin', 'host', 'sales']) { const r = await people[k].rpc('warehouseDispatch', [c, 'DEMO-L3', 'X', 'warehouse']); assert.ok(denied(r), k + ' dispatched an order with the e-way bill pending'); }
  assert.ok(!find('DEMO-L3').whDispatch, 'nothing may have changed');
});
test('an order with the invoice pending cannot be dispatched', async () => {
  const o = find('DEMO-L1'); assert.ok(!o.invoiceFile); const r = await people.wh.rpc('warehouseDispatch', [o.dealerCode, 'DEMO-L1', 'X', 'warehouse']); assert.ok(failed(r)); assert.match(JSON.stringify(r.json), /Invoice pending/);
});
test('the other routes to "in transit" are closed too while documents are pending', async () => {
  const c = find('DEMO-L3').dealerCode;
  for (const [k, fn, args] of [['lg', 'updateShipment', [c, 'DEMO-L3', { status: 'Dispatched' }, 'x']], ['lg', 'markOutForDelivery', [c, 'DEMO-L3', 'x', 'logistics']], ['lg', 'markDelivered', [c, 'DEMO-L3', 'x', 'logistics']], ['lg', 'setTracking', [c, 'DEMO-L3', 'dtdc', 'TK999999', 'x', 'logistics']], ['fin', 'setTracking', [c, 'DEMO-L3', 'dtdc', 'TK999999', 'x', 'finance']]]) assert.ok(denied(await people[k].rpc(fn, args)), fn);
  assert.equal(stage('DEMO-L3').idx, 6);
});
test('tracking cannot be added before the Warehouse dispatches (Logistics and Finance alike)', async () => {
  const c = find('DEMO-L2').dealerCode; assert.equal(stage('DEMO-L2').idx, 6);
  for (const k of ['lg', 'fin']) assert.ok(denied(await people[k].rpc('setTracking', [c, 'DEMO-L2', 'dtdc', 'TK123456', 'x', 'x'])), k);
});
test('only the Warehouse can press "Order dispatched" on a ready order', async () => {
  const c = find('DEMO-L2').dealerCode;
  for (const k of ['lg', 'fin', 'host', 'sales']) assert.ok(denied(await people[k].rpc('warehouseDispatch', [c, 'DEMO-L2', 'x', 'warehouse'])), k + ' must not dispatch');
  assert.ok(!find('DEMO-L2').whDispatch);
  assert.ok(!failed(await people.wh.rpc('warehouseDispatch', [c, 'DEMO-L2', 'x', 'x'])), 'the Warehouse can'); assert.equal(stage('DEMO-L2').idx, 7); assert.equal(stage('DEMO-L2').label, 'Order in transit');
});
test('after dispatch only Logistics or Finance add tracking; Sales, Warehouse and Host cannot', async () => {
  const c = find('DEMO-L2').dealerCode;
  for (const k of ['sales', 'wh', 'host']) assert.ok(denied(await people[k].rpc('setTracking', [c, 'DEMO-L2', 'dtdc', 'TK123456', 'x', 'x'])), k + ' must not add tracking');
  assert.ok(!failed(await people.fin.rpc('setTracking', [c, 'DEMO-L2', 'dtdc', 'TK123456', 'x', 'x'])), 'Finance can'); assert.equal(find('DEMO-L2').shipment.trackingId, 'TK123456');
});
test('only Logistics marks out for delivery and delivered', async () => {
  const c = find('DEMO-L2').dealerCode;
  for (const fn of ['markOutForDelivery', 'markDelivered']) for (const k of ['fin', 'host', 'wh', 'sales']) assert.ok(denied(await people[k].rpc(fn, [c, 'DEMO-L2', 'x', 'logistics'])), k + ' ' + fn);
  assert.notEqual(find('DEMO-L2').status, 'Delivered');
  assert.ok(!failed(await people.lg.rpc('markOutForDelivery', [c, 'DEMO-L2', 'x', 'x']))); assert.ok(!failed(await people.lg.rpc('markDelivered', [c, 'DEMO-L2', 'x', 'x']))); assert.equal(find('DEMO-L2').status, 'Delivered');
});
test('when Logistics uploads the e-way bill the Warehouse can then dispatch (the chain unblocks)', async () => {
  const c = find('DEMO-L3').dealerCode;
  assert.ok(denied(await people.wh.rpc('attachEwayFile', [c, 'DEMO-L3', { name: 'e.pdf', size: 14, data: PDF, no: 'EWB1234567890' }, 'x'])), 'the Warehouse cannot upload documents');
  assert.ok(!failed(await people.lg.rpc('attachEwayFile', [c, 'DEMO-L3', { name: 'e.pdf', size: 14, data: PDF, no: 'EWB1234567890' }, 'x'])));
  assert.ok(!failed(await people.wh.rpc('warehouseDispatch', [c, 'DEMO-L3', 'x', 'x']))); assert.equal(stage('DEMO-L3').idx, 7);
});
test('completed historic orders do not show a pending document', () => { const bad = []; for (const k of app.engine.keys()) if (k.startsWith('sel.v2.orders.')) for (const o of JSON.parse(app.engine.state.get(k))) if ((o.hist || o.status === 'Delivered') && app.engine.peek('docsPending', [o]).result) bad.push(o.id); assert.deepEqual(bad, []); });

test('samples: fixed Rs 150 shipping, borne by the company, counted in the analytics only', async () => {
  const dl0 = JSON.stringify(app.engine.get('dledger')), A0 = app.engine.peek('logisticsAnalytics', ['']).result;
  const c = await people.sales.rpc('createSample', [{ dealer: '', name: 'Dr Test', address: '12 Test Road, Ahmedabad 380001', lines: [{ brand: 'bolt', product: 'Beginner Whey 2 LB', qty: 1, value: 1999 }], by: 'x' }]); assert.ok(!failed(c));
  const s = c.json.result.sample; assert.equal(s.shipCost, 150); assert.match(s.shipBorneBy, /company/i);
  assert.equal(app.engine.peek('logisticsAnalytics', ['']).result.samples.amount, A0.samples.amount, 'unshipped samples add nothing');
  assert.ok(!failed(await people.lg.rpc('attachSampleInvoice', [s.id, { name: 'i.pdf', size: 14, data: PDF, no: 'SINV1' }, 'x'])));
  assert.ok(!failed(await people.wh.rpc('startSamplePacking', [s.id, 'x']))); assert.ok(!failed(await people.wh.rpc('verifySampleItem', [s.id, 0, 1, 'x']))); assert.ok(!failed(await people.wh.rpc('finishSamplePacking', [s.id, 'x'])));
  for (const k of ['fin', 'host', 'sales']) assert.ok(denied(await people[k].rpc('advanceSample', [s.id, 'Delivered', 'x', 'x'])), k + ' must not deliver a sample');
  assert.ok(!failed(await people.wh.rpc('advanceSample', [s.id, 'Shipped', 'x', 'x'])));
  const A1 = app.engine.peek('logisticsAnalytics', ['']).result; assert.equal(A1.samples.count, A0.samples.count + 1); assert.equal(A1.samples.amount, A0.samples.amount + 150); assert.equal(A1.total.paid, A0.total.paid, 'never part of what a partner was paid'); assert.equal(A1.grand, A0.grand + 150);
  assert.equal(JSON.stringify(app.engine.get('dledger')), dl0, 'never charged to a dealer');
  assert.ok(!failed(await people.lg.rpc('advanceSample', [s.id, 'Delivered', 'x', 'x']))); assert.equal(app.engine.peek('logisticsAnalytics', ['']).result.samples.count, A0.samples.count + 1, 'not counted twice');
});
