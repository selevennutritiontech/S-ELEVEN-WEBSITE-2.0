'use strict';
/* v28: Host-only commission (percentage / fixed amount / order size), editable visits, no attendance for consultants, Warehouse read-only inventory and no logistics cost, consultant records are the Host's alone. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { start, Client, staff } = require('./helpers.js');
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
let app, seq = 0; const P = {};
const failed = r => r.status !== 200 || !r.json || r.json.ok === false || !!(r.json.result && r.json.result.error);
const msg = r => JSON.stringify(r.json).slice(0, 240);
const sync = async c => { const r = await c.getState(c.ver || 0); c.apply(r.json); };
const prod = brand => { const S = app.engine.ctx.SEL, pid = Object.keys(S.IMG).find(p => S.findProduct(p).brand === brand), pr = S.findProduct(pid).product; return { pid, vid: pr.variants[0].id, flavour: (pr.flavours || [''])[0] || '' }; };
const ord = (brand, qty) => { const p = prod(brand); return { items: [{ pid: p.pid, vid: p.vid, flavour: p.flavour, qty }], address: '12, Navrangpura, Ahmedabad 380015', pin: '380015', phone: '9900000011' }; };
test.before(async () => { app = await start({ memory: !process.env.TEST_DATABASE_URL }); for (const [k, c, p] of [['host', 'ADMIN', 'admin123'], ['sales', 'SALES', 'sales123'], ['fin', 'FINANCE', 'fin123'], ['log', 'LOGISTICS', 'logi123'], ['wh', 'WAREHOUSE', 'wh123'], ['f1', 'FIELD01', 'field123'], ['f2', 'FIELD02', 'field123']]) { P[k] = await staff(app, c, p); await sync(P[k]); } });
test.after(async () => { await app.close(); });
const earn = async (brand, qty) => { const o = await P.f1.rpc('addOrder', ['FDEMO1', ord(brand, qty)]); assert.ok(!failed(o), msg(o)); const id = o.json.result.id, due = app.engine.peek('dueOf', [app.engine.get('orders.FDEMO1').find(x => x.id === id)]).result;
  assert.ok(!failed(await P.f1.rpc('addProof', ['FDEMO1', id, { method: 'UPI', ref: 'UTR' + Date.now() + (seq++), amount: due, date: new Date().toISOString().slice(0, 10), name: 'p', size: 70, data: PNG }, 'x', 'x']))); const pid = app.engine.get('orders.FDEMO1').find(x => x.id === id).proofs[0].id;
  assert.ok(!failed(await P.fin.rpc('verifyProof', ['FDEMO1', id, pid, due, 'Bank line checked ok', 'x', 'x']))); return { id, row: app.engine.get('fcomm').find(r => r.orderId === id && r.brand === brand), order: app.engine.get('orders.FDEMO1').find(x => x.id === id) }; };

test('ONLY the Host sets commission; the senior can switch a brand on or off once the Host has set it', async () => {
  const slab = { mode: 'slab', slabs: [{ from: 0, to: 20000, type: 'percent', value: 3 }, { from: 20000, to: '', type: 'amount', value: 900 }] };
  for (const [who, c] of [['sales (the senior)', P.sales], ['consultant', P.f1], ['finance', P.fin]]) assert.equal((await c.rpc('setFieldCommission', ['FIELD01', 'ved', slab, 'x', 'x'])).status, 403, who + ' cannot set commission');
  for (const bad of [{ mode: 'percent', pct: 45 }, { mode: 'amount', amount: 0 }, { mode: 'slab', slabs: [{ from: 0, to: 100, type: 'percent', value: 2 }, { from: 50, to: 200, type: 'percent', value: 3 }] }, { mode: 'slab', slabs: [] }, { mode: 'weird' }]) assert.ok(failed(await P.host.rpc('setFieldCommission', ['FIELD01', 'ved', bad, 'x', 'x'])), JSON.stringify(bad) + ' is refused');
  assert.ok(failed(await P.sales.rpc('setFieldBrand', ['FIELD01', 'pureluxe', true, '', 'x', 'x'])), 'cannot switch on a brand whose commission is not set'); assert.match(msg(await P.sales.rpc('setFieldBrand', ['FIELD01', 'pureluxe', true, '', 'x', 'x'])), /Host has not set the commission/);
  assert.ok(!failed(await P.host.rpc('setFieldCommission', ['FIELD01', 'ved', slab, 'x', 'x']))); assert.equal(app.engine.get('employees').find(e => e.id === 'FIELD01').fieldBrands.ved.mode, 'slab');
  assert.ok(!failed(await P.sales.rpc('setFieldBrand', ['FIELD01', 'ved', false, '', 'x', 'x']))); assert.ok(!failed(await P.sales.rpc('setFieldBrand', ['FIELD01', 'ved', true, '', 'x', 'x']))); assert.equal(app.engine.get('employees').find(e => e.id === 'FIELD01').fieldBrands.ved.mode, 'slab', 'switching never alters the commission');
  assert.ok(!failed(await P.sales.rpc('setFieldBrand', ['FIELD01', 'ved', true, 29, 'x', 'x'])), 'a percentage passed by the senior is ignored'); assert.equal(app.engine.get('employees').find(e => e.id === 'FIELD01').fieldBrands.ved.mode, 'slab');
});
test('earning: a percentage, a fixed amount per order, and order-size slabs are each posted only after Finance verifies the payment', async () => {
  assert.ok(!failed(await P.host.rpc('setFieldCommission', ['FIELD01', 'bolt', { mode: 'percent', pct: 5 }, 'x', 'x'])));
  const a = await earn('bolt', 3); assert.equal(a.row.mode, 'percent'); assert.equal(a.row.pct, 5); assert.ok(Math.abs(a.row.amount - Math.round(a.row.base * 5) / 100) <= 0.02, 'percentage of the brand value: ' + JSON.stringify(a.row));
  assert.ok(!failed(await P.host.rpc('setFieldCommission', ['FIELD01', 'bolt', { mode: 'amount', amount: 275 }, 'x', 'x']))); const b = await earn('bolt', 2); assert.equal(b.row.mode, 'amount'); assert.equal(b.row.amount, 275, 'a fixed amount per order, whatever its size'); const b2 = await earn('bolt', 6); assert.equal(b2.row.amount, 275);
  assert.ok(!failed(await P.host.rpc('setFieldCommission', ['FIELD01', 'bolt', { mode: 'slab', slabs: [{ from: 0, to: 5000, type: 'percent', value: 2 }, { from: 5000, to: '', type: 'amount', value: 600 }] }, 'x', 'x'])));
  const small = await earn('bolt', 1), big = await earn('bolt', 12); assert.equal(small.row.mode, 'slab'); assert.ok(small.row.base < 5000 && Math.abs(small.row.amount - Math.round(small.row.base * 2) / 100) <= 0.02, 'a small order falls in the 2% slab: ' + small.row.base + ' -> ' + small.row.amount); assert.ok(big.row.base >= 5000 && big.row.amount === 600, 'a big order falls in the fixed 600 slab: ' + big.row.base + ' -> ' + big.row.amount);
  assert.ok(!failed(await P.host.rpc('setFieldCommission', ['FIELD01', 'bolt', { mode: 'percent', pct: 1 }, 'x', 'x']))); assert.equal(app.engine.get('fcomm').find(r => r.orderId === a.id).pct, 5, 'a later change never alters commission already earned');
});
test('a consultant edits only their own visits; nobody else edits a visit', async () => {
  await sync(P.f1); const mine = P.f1.state.visits[0], theirs = app.engine.get('visits').find(v => v.emp !== 'FIELD01');
  const ok = await P.f1.rpc('editVisit', [mine.id, { purpose: 'Edited: stock check', outcome: 'Will reorder', nextStep: 'Call Monday' }, 'x', 'x']); assert.ok(!failed(ok), msg(ok)); const v = app.engine.get('visits').find(x => x.id === mine.id); assert.equal(v.purpose, 'Edited: stock check'); assert.ok(v.editedAt);
  assert.match(msg(await P.f1.rpc('editVisit', [theirs.id, { purpose: 'not mine' }, 'x', 'x'])), /only your own/); assert.notEqual(app.engine.get('visits').find(x => x.id === theirs.id).purpose, 'not mine');
  assert.ok(failed(await P.f1.rpc('editVisit', [mine.id, { purpose: 'x' }, 'x', 'x'])), 'a purpose is needed'); for (const c of [P.sales, P.host, P.fin]) assert.equal((await c.rpc('editVisit', [mine.id, { purpose: 'Changed by someone else' }, 'x', 'x'])).status, 403);
});
test('consultants have no attendance and no allowances; others do', async () => {
  const f = await staff(app, 'FIELD01', 'field123'); await f.getState(0); assert.equal((app.engine.get('att') || {}).FIELD01, undefined, 'signing in records no attendance for a consultant'); assert.ok(Object.keys(app.engine.get('att') || {}).includes('SALES'), 'a Sales person does get attendance on sign-in');
  assert.equal((await P.f1.rpc('clockIn', [])).status === 200 ? app.engine.get('att').FIELD01 : undefined, undefined, 'and clocking in records nothing');
  assert.equal((await P.f1.rpc('addPetrol', ['FIELD01', 100])).status === 200 ? (app.engine.get('allow') || []).filter(a => a.emp === 'FIELD01').length : 0, 0, 'no allowance can be raised for a consultant');
});
test('the Warehouse cannot put stock in, out, returned, damaged or adjust it; Finance and Logistics can; the Warehouse may only ask for a count', async () => {
  const sku = Object.keys(app.engine.get('inv'))[0];
  for (const [fn, args] of [['stockIn', [sku, { qty: 5, batch: 'B1', exp: '2028-01-01' }, 'x']], ['stockOutB', [sku, { qty: 1 }, 'x']], ['damageB', [sku, { qty: 1 }, 'x']], ['returnB', [sku, { qty: 1 }, 'x']], ['receiveStock', [sku, 5, 'x']], ['adjustStock', [sku, 3, 'x']], ['markDamaged', [sku, 1, 'x']], ['stockOut', [sku, 1, 'x']], ['stockReturn', [sku, 1, 'x']], ['addPurchase', [{}, [], 'x']], ['setBatchQ', [sku, 'B1', true, 'x', 'x']]]) assert.equal((await P.wh.rpc(fn, args)).status, 403, fn + ' is not for the Warehouse');
  for (const c of [P.sales, P.f1]) assert.equal((await c.rpc('receiveStock', [sku, 5, 'x'])).status, 403);
  for (const [who, c] of [['finance', P.fin], ['logistics', P.log], ['host', P.host]]) assert.notEqual((await c.rpc('receiveStock', [sku, 5, 'x'])).status, 403, who + ' may edit stock');
  assert.notEqual((await P.wh.rpc('countRequest', [sku, 'x'])).status, 403, 'the Warehouse may ask for a stock count');
});
test('the Warehouse never receives what logistics costs; Logistics and Finance do', async () => {
  const l = JSON.parse(app.engine.state.get('sel.v2.orders.DEMO001')); const t = l.find(o => !o.hist); t.dispatchFrom = { partner: 'safex', name: 'Safexpress', perKg: 12.5, weightKg: 8, cost: 100, at: new Date().toISOString(), by: 'LOGISTICS' }; app.engine.state.set('sel.v2.orders.DEMO001', JSON.stringify(l)); app.engine.ver.set('sel.v2.orders.DEMO001', ++app.engine.gv);
  for (const c of [P.wh, P.log, P.fin]) await sync(c); const pick = c => c.state['orders.DEMO001'].find(o => o.id === t.id);
  assert.equal(pick(P.wh).dispatchFrom.name, 'Safexpress', 'the Warehouse still sees where it dispatches from'); assert.equal(pick(P.wh).dispatchFrom.cost, undefined); assert.equal(pick(P.wh).dispatchFrom.perKg, undefined);
  assert.equal(pick(P.log).dispatchFrom.cost, 100); assert.equal(pick(P.fin).dispatchFrom.cost, 100);
});
test('a consultant\'s record is the Host\'s alone: HR, Sales and everyone else are refused; the Host is not', async () => {
  const hr = { id: 'HR9', name: 'Hira Rao', dept: 'hr', password: 'Hr#Pass2026xyz', email: 'hr@x.in', mobile: '9000000099', designation: 'HR' }, mk = await P.host.rpc('saveEmployee', [hr]); assert.ok(!failed(mk), 'an HR employee can be created: ' + msg(mk));
  const H = await staff(app, 'HR9', 'Hr#Pass2026xyz'), f = app.engine.get('employees').find(e => e.id === 'FIELD02');
  for (const [fn, args] of [['saveEmployee', [Object.assign({}, f, { name: 'Changed by HR' })]], ['suspendEmployee', ['FIELD02', {}, 'x', 'x']], ['transferEmployee', ['FIELD02', {}, 'x', 'x']], ['setSalary', ['FIELD02', 5000, 'x', 'x']], ['markEmployeeLeft', ['FIELD02', {}]]]) assert.equal((await H.rpc(fn, args)).status, 403, 'HR: ' + fn);
  assert.notEqual(app.engine.get('employees').find(e => e.id === 'FIELD02').name, 'Changed by HR'); const ok = await P.host.rpc('saveEmployee', [Object.assign({}, f, { designation: 'Senior Field Consultant' })]); assert.ok(!failed(ok), msg(ok));
  assert.ok(!failed(await H.rpc('saveEmployee', [Object.assign({}, app.engine.get('employees').find(e => e.id === 'SALES3'), { designation: 'Sales Exec II' })])), 'HR still manages normal employees');
});
test('a consultant sees stock of the brands activated for them only', async () => {
  await sync(P.f2); const S = app.engine.ctx.SEL, br = o => [...new Set(Object.keys(o || {}).map(k => S.findProduct(k.split('|')[0]).brand))].sort(), act = Object.keys(app.engine.get('employees').find(e => e.id === 'FIELD02').fieldBrands).filter(b => app.engine.get('employees').find(e => e.id === 'FIELD02').fieldBrands[b].on).sort();
  assert.deepEqual(br(P.f2.state.inv), act); assert.deepEqual(br(P.f2.state.batches), act); assert.ok(br(P.fin.state.inv).length > act.length, 'Finance sees every brand');
});
