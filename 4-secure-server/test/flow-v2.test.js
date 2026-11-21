'use strict';
/* Rules added in v24: push to the Warehouse right after the invoice; the e-way bill blocks only DISPATCH; the courier is fixed once chosen;
   the packing note locks at dispatch; everything locks at delivery. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { start, staff, dealer } = require('./helpers.js');
const PDF = 'data:application/pdf;base64,JVBERi0xLjQKJSVFT0YK', PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
let app; const P = {}; const failed = r => r.status !== 200 || !r.json || r.json.ok === false || !!(r.json.result && r.json.result.error);
const find = id => { for (const k of app.engine.keys()) if (k.startsWith('sel.v2.orders.')) { const o = JSON.parse(app.engine.state.get(k)).find(x => x.id === id); if (o) { o.dealerCode = k.slice(14); return o; } } };
const stage = id => app.engine.peek('stageOf', [find(id)]).result;
test.before(async () => { app = await start({ memory: !process.env.TEST_DATABASE_URL }); for (const [k, c, p] of [['wh', 'WAREHOUSE', 'wh123'], ['lg', 'LOGISTICS', 'logi123'], ['fin', 'FINANCE', 'fin123'], ['sales', 'SALES', 'sales123']]) P[k] = await staff(app, c, p); P.d = await dealer(app, 'DEMO001', 'demo123'); });
test.after(async () => { await app.close(); });
let seq = 0;
function pick(minTotal) {   // a product with enough stock whose price reaches the total we need
  const inv = app.engine.get('inv') || {}; let best = null;
  for (const [sku, s] of Object.entries(inv)) { const [pid, vid] = sku.split('|'), f = app.engine.ctx.SEL.findProduct(pid); if (!f) continue; const v = f.product.variants.find(x => x.id === vid); if (!v || (s.on - s.res) < 20) continue; if (!best || v.mrp > best.mrp) best = { pid, vid, mrp: v.mrp, flavour: (f.product.flavours || [''])[0] || '' }; }
  return best;
}
async function newPaidPushedOrder(qty) {
  const ref = JSON.parse(app.engine.state.get('sel.v2.orders.DEMO001')).find(o => !o.hist && o.items && o.items[0] && o.items[0].pid), l = qty >= 8 ? Object.assign({}, ref.items[0], pick()) : ref.items[0]; if (qty >= 8) qty = Math.ceil(52000 / (l.mrp * 0.8));
  const r = await P.d.rpc('addOrder', ['DEMO001', { items: [{ pid: l.pid, vid: l.vid, flavour: l.flavour, qty }], address: ref.address, pin: ref.pin, phone: ref.phone, gst: ref.gst }]); assert.ok(!failed(r), JSON.stringify(r.json).slice(0, 200)); const id = r.json.result.id;
  const due = app.engine.peek('dueOf', [find(id)]).result; assert.ok(!failed(await P.d.rpc('submitPayShot', ['DEMO001', id, { ref: 'UTR' + Date.now() + (seq++), name: 'p', size: 70, data: PNG }, 'x'])));
  const pid = find(id).proofs[0].id; assert.ok(!failed(await P.fin.rpc('verifyProof', ['DEMO001', id, pid, due, 'Bank line checked ok', 'x', 'x']))); assert.ok(!failed(await P.sales.rpc('confirmOrder', ['DEMO001', id, 'x']))); return id;
}
async function pack(id) { assert.ok(!failed(await P.wh.rpc('startPacking', ['DEMO001', id, 'x']))); for (const it of find(id).packing.items) assert.ok(!failed(await P.wh.rpc('verifyItem', ['DEMO001', id, it.key, it.req, 'x']))); assert.ok(!failed(await P.wh.rpc('finishPacking', ['DEMO001', id, 'x']))); }

test('an order above 50,000: push right after the invoice; the Warehouse packs; dispatch waits for the e-way bill', async () => {
  const id = await newPaidPushedOrder(8), o = find(id); assert.ok(app.engine.peek('needsEway', [o]).result, 'order must need an e-way bill'); assert.ok(!o.invoiceFile);
  assert.ok(failed(await P.lg.rpc('pushToWarehouse', ['DEMO001', id, 'x', 'logistics'])), 'no invoice yet: cannot push');
  assert.ok(!failed(await P.lg.rpc('attachInvoiceFile', ['DEMO001', id, { name: 'i.pdf', size: 14, data: PDF, no: 'INV/V2/1' }, 'x'])));
  await app.commitCall('stageEvents', [], { policy: false });
  const alerts = app.engine.peek('alertsFor', ['LOGISTICS', 'logistics']).result.filter(a => a.orderId === id && /verify and push/i.test(a.title)); assert.equal(alerts.length, 1, 'Logistics is told to push'); assert.ok(!alerts[0].popup, 'with an e-way bill still needed there is a button, not a pop-up');
  assert.ok(!failed(await P.lg.rpc('pushToWarehouse', ['DEMO001', id, 'x', 'logistics'])), 'push works with the invoice only');
  assert.ok(app.engine.peek('visibleTo', ['warehouse', find(id)]).result, 'the Warehouse now sees it');
  await pack(id); assert.equal(stage(id).idx, 6);
  const r = await P.wh.rpc('warehouseDispatch', ['DEMO001', id, 'x', 'warehouse']); assert.ok(failed(r)); assert.match(JSON.stringify(r.json), /E-way bill pending/); assert.ok(!find(id).whDispatch);
  assert.ok(!failed(await P.fin.rpc('attachEwayFile', ['DEMO001', id, { name: 'e.pdf', size: 14, data: PDF, no: 'EWB1234567890' }, 'x'])));
  await app.commitCall('stageEvents', [], { policy: false });
  assert.ok(app.engine.peek('alertsFor', ['WAREHOUSE', 'warehouse']).result.some(a => a.orderId === id && /E-way bill uploaded/.test(a.title)), 'the Warehouse is told the button is enabled');
  assert.ok(!failed(await P.wh.rpc('warehouseDispatch', ['DEMO001', id, 'x', 'warehouse']))); assert.equal(stage(id).idx, 7);
  assert.match(find(id).history.map(h => h.status).join('|'), /dispatched by the Warehouse/i, 'history names the Warehouse');
});
test('an order up to 50,000: Logistics and Finance get a push pop-up straight away', async () => {
  const id = await newPaidPushedOrder(1); assert.ok(!app.engine.peek('needsEway', [find(id)]).result);
  assert.ok(!failed(await P.fin.rpc('attachInvoiceFile', ['DEMO001', id, { name: 'i.pdf', size: 14, data: PDF, no: 'INV/V2/2' }, 'x'])));
  await app.commitCall('stageEvents', [], { policy: false });
  const a = app.engine.peek('alertsFor', ['FINANCE', 'finance']).result.filter(x => x.orderId === id && /verify and push/i.test(x.title)); assert.equal(a.length, 1); assert.equal(a[0].popup, 'pushnow', 'a pop-up that opens the push window');
  assert.ok(!failed(await P.fin.rpc('pushToWarehouse', ['DEMO001', id, 'x', 'finance']))); await pack(id); assert.ok(!failed(await P.wh.rpc('warehouseDispatch', ['DEMO001', id, 'x', 'warehouse']))); assert.equal(stage(id).idx, 7);
});
test('after dispatch: the packing note is locked; tracking offers only the chosen partner; replacing the invoice still works until delivered', async () => {
  const id = await newPaidPushedOrder(1); await P.lg.rpc('attachInvoiceFile', ['DEMO001', id, { name: 'i.pdf', size: 14, data: PDF, no: 'INV/V2/3' }, 'x']); await P.lg.rpc('pushToWarehouse', ['DEMO001', id, 'x', 'logistics']);
  assert.ok(!failed(await P.lg.rpc('setPackNote', ['DEMO001', id, 'Handle with care', 'x', 'logistics']))); assert.ok(!failed(await P.lg.rpc('dispatchFrom', ['DEMO001', id, 'tirupati', 'x', 'logistics'])));
  await pack(id); assert.ok(!failed(await P.wh.rpc('warehouseDispatch', ['DEMO001', id, 'x', 'warehouse'])));
  const n = await P.lg.rpc('setPackNote', ['DEMO001', id, 'Changed after dispatch', 'x', 'logistics']); assert.ok(failed(n)); assert.match(JSON.stringify(n.json), /packing note cannot be changed once the Warehouse/); assert.equal(find(id).packNote.text, 'Handle with care');
  const bad = await P.lg.rpc('setTracking', ['DEMO001', id, 'dtdc', 'TK123456', 'x', 'logistics']); assert.ok(failed(bad)); assert.match(JSON.stringify(bad.json), /dispatch partner chosen earlier: .*Tirupati/i);
  assert.ok(!failed(await P.lg.rpc('setTracking', ['DEMO001', id, 'tirupati', 'TK123456', 'x', 'logistics'])));
  assert.ok(!failed(await P.lg.rpc('attachInvoiceFile', ['DEMO001', id, { name: 'i2.pdf', size: 14, data: PDF, no: 'INV/V2/3B' }, 'x'])), 'the invoice can still be replaced before delivery'); assert.equal(find(id).invoice.no, 'INV/V2/3B');
  assert.ok(!failed(await P.lg.rpc('markOutForDelivery', ['DEMO001', id, 'x', 'logistics']))); assert.ok(!failed(await P.lg.rpc('markDelivered', ['DEMO001', id, 'x', 'logistics'])));
  /* delivered: nothing can change */
  const locked = [['attachInvoiceFile', ['DEMO001', id, { name: 'i3.pdf', size: 14, data: PDF, no: 'INV/V2/3C' }, 'x']], ['attachEwayFile', ['DEMO001', id, { name: 'e.pdf', size: 14, data: PDF, no: 'EWB1234567890' }, 'x']], ['setPackNote', ['DEMO001', id, 'late', 'x', 'logistics']], ['dispatchFrom', ['DEMO001', id, 'dtdc', 'x', 'logistics']], ['setTracking', ['DEMO001', id, 'tirupati', 'TK999999', 'x', 'logistics']]];
  for (const [fn, args] of locked) { const r = await P.lg.rpc(fn, args); assert.ok(failed(r), fn); assert.match(JSON.stringify(r.json), /delivered|only for paid orders/i, fn); }
  assert.equal(find(id).invoice.no, 'INV/V2/3B'); assert.equal(find(id).shipment.trackingId, 'TK123456');
  assert.equal(app.engine.peek('editState', [find(id)]).result.ok, false, 'a delivered order cannot be edited');
});
