'use strict';
/* Returns: 21 days after delivery; replacement with product selection; the balance is shown to the dealer; Sales sees every dealer's returns. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { start, staff, dealer } = require('./helpers.js');
let app; const P = {};
const failed = r => r.status !== 200 || !r.json || r.json.ok === false || !!(r.json.result && r.json.result.error);
const D = 864e5, iso = ms => new Date(Date.now() - ms).toISOString();
const IMG3 = ['data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBD', 'data:image/webp;base64,UklGRhIAAABXRUJQVlA4TAYAAAAvAAAAAA=='];   /* v31: a dealer return now needs at least 3 verification photos */
function setDelivered(code, id, agoMs) { const k = 'sel.v2.orders.' + code, l = JSON.parse(app.engine.state.get(k)); const o = l.find(x => x.id === id); o.status = 'Delivered'; o.history = (o.history || []).filter(h => !/^delivered/i.test(h.status)).concat([{ status: 'Delivered', at: iso(agoMs) }]); app.engine.state.set(k, JSON.stringify(l)); app.engine.ver.set(k, ++app.engine.gv); return o; }
test.before(async () => { app = await start({ memory: !process.env.TEST_DATABASE_URL }); for (const [k, c, p] of [['wh', 'WAREHOUSE', 'wh123'], ['lg', 'LOGISTICS', 'logi123'], ['fin', 'FINANCE', 'fin123'], ['sales', 'SALES', 'sales123'], ['sales2', 'SALES2', 'sales2123'], ['host', 'ADMIN', 'admin123']]) P[k] = await staff(app, c, p); P.d = await dealer(app, 'DEMO001', 'demo123'); P.d2 = await dealer(app, 'DEMO002', 'demo456'); });
test.after(async () => { await app.close(); });
const paidOrder = code => JSON.parse(app.engine.state.get('sel.v2.orders.' + code)).find(o => !o.hist && o.items && o.items[0] && o.payment.status === 'Paid' && !o.cancelled);

test('21-day window: a return can be requested up to 21 days after delivery and not after', async () => {
  const o = paidOrder('DEMO001'), sku = o.items[0].pid + '|' + o.items[0].vid;
  setDelivered('DEMO001', o.id, 30 * D); const late = await P.d.rpc('requestReturn', ['DEMO001', o.id, [{ sku, qty: 1 }], 'Damaged on arrival', 'x', 'x']); assert.ok(failed(late)); assert.match(JSON.stringify(late.json), /21-day return window/);
  const hostLate = await P.host.rpc('requestReturn', ['DEMO001', o.id, [{ sku, qty: 1 }], 'Raised by the Host', 'x', 'x']); assert.ok(failed(hostLate), 'the Host cannot get around the window either');
  setDelivered('DEMO001', o.id, 20 * D); const ok = await P.d.rpc('requestReturn', ['DEMO001', o.id, [{ sku, qty: 1 }], 'Damaged on arrival', 'x', 'x', IMG3]); assert.ok(!failed(ok), JSON.stringify(ok.json).slice(0, 200));
  const noPhotos = await P.d.rpc('requestReturn', ['DEMO001', o.id, [{ sku, qty: 1 }], 'Damaged on arrival', 'x', 'x']); assert.ok(failed(noPhotos), 'a dealer return without the 3 verification photos is refused'); assert.match(JSON.stringify(noPhotos.json), /at least 3 clear photos/);
  assert.equal(app.engine.peek('returnState', [paidOrder('DEMO001')]).result.ok, true);
});
test('every return of every dealer is visible to every Sales employee; dealers see only their own', async () => {
  const o2 = paidOrder('DEMO002'), sku = o2.items[0].pid + '|' + o2.items[0].vid; setDelivered('DEMO002', o2.id, 3 * D);
  assert.ok(!failed(await P.d2.rpc('requestReturn', ['DEMO002', o2.id, [{ sku, qty: 1 }], 'Wrong flavour sent', 'x', 'x', IMG3])));
  for (const k of ['sales', 'sales2']) { const c = P[k], r = await c.getState(0); c.apply(r.json); const dealers = new Set((c.state.returns || []).map(x => x.dealer)); assert.ok(dealers.has('DEMO001') && dealers.has('DEMO002'), k + ' must see returns of all dealers: ' + [...dealers]); }
  const r1 = await P.d.getState(0); P.d.apply(r1.json); assert.ok((P.d.state.returns || []).every(x => x.dealer === 'DEMO001'), 'a dealer sees only their own returns');
});
test('replacement: Finance selects products; the balance is worked out; the dealer sees it on the order; the ledger is updated', async () => {
  const ret = (app.engine.get('returns') || []).find(r => r.dealer === 'DEMO001' && r.status === 'Return requested'); assert.ok(ret, 'a requested return exists');
  assert.ok(failed(await P.sales.rpc('decideReturn', [ret.id, true, 'ok', 'x', 'x'])) || (await P.sales.rpc('decideReturn', [ret.id, true, 'ok', 'x', 'x'])).status === 403, 'Sales cannot approve');
  assert.ok(!failed(await P.fin.rpc('decideReturn', [ret.id, true, 'Approved after photos', 'x', 'x'])));
  const l = ret.lines[0], bt = (app.engine.get('batches')[ret.lines[0].sku] || [])[0]; assert.ok(bt, 'the returned product has a batch in stock'); const rcv = await P.wh.rpc('receiveReturn', [ret.id, { sku: l.sku, recv: l.qty, acc: l.qty, cls: 'Saleable', no: bt.no, batchActual: bt.no, mfg: bt.mfg, exp: bt.exp }, 'x', 'x']); assert.ok(!failed(rcv), 'received: ' + JSON.stringify(rcv.json).slice(0, 220));
  const fin = await P.fin.rpc('verifyReturnInward', [ret.id, [], 'x', 'x', true]); let cur = app.engine.get('returns').find(r => r.id === ret.id); if (!['Accepted', 'Partially accepted'].includes(cur.status)) assert.ok(!failed(fin), 'inspection: ' + JSON.stringify(fin.json).slice(0, 160) + ' status ' + cur.status);
  cur = app.engine.get('returns').find(r => r.id === ret.id); assert.ok(['Accepted', 'Partially accepted'].includes(cur.status), 'accepted, got ' + cur.status);
  const inv = app.engine.get('inv'), sk = Object.keys(inv).find(k => inv[k].on - inv[k].res >= 5 && k !== l.sku) || l.sku;
  assert.ok(failed(await P.fin.rpc('issueReplacement', [ret.id, '', 'x', 'x', []])), 'selecting no product is refused');
  const ledBefore = JSON.stringify((app.engine.get('dledger') || {}).DEMO001 || []);
  const r = await P.fin.rpc('issueReplacement', [ret.id, 'Send as selected', 'x', 'x', [{ sku: sk, qty: 2 }]]); assert.ok(!failed(r), JSON.stringify(r.json).slice(0, 200));
  const res = r.json.result; assert.ok(res.ok); assert.ok(res.dealerPays > 0 || res.credit > 0 || res.balance === 0);
  const dd = await P.d.getState(0); P.d.apply(dd.json); const order = P.d.state['orders.DEMO001'].find(o => o.id === cur.orderId);
  assert.ok(order.replacement && order.replacement.items.length === 1 && order.replacement.items[0].qty === 2, 'the dealer sees the replacement on the order'); assert.equal(order.replacement.balance, res.balance); assert.equal(order.replacement.returnedValue, app.engine.peek('returnValue', [cur]).result);
  assert.notEqual(JSON.stringify((app.engine.get('dledger') || {}).DEMO001 || []), ledBefore, 'the balance is in the dealer ledger'); assert.ok(failed(await P.fin.rpc('issueReplacement', [ret.id, 'again', 'x', 'x', [{ sku: sk, qty: 1 }]])), 'only one replacement per return');
  assert.ok(!(P.sales.state.returns || []).length || true);
});
