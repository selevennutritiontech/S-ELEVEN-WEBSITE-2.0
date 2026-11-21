'use strict';
/* CRM, and Field Sales Consultants as their own department: created by the Host (zone, state, city, senior), create-only, dealers only inside their state. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { start, Client, staff, dealer } = require('./helpers.js');
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
let app; const P = {}; let seq = 0;
const failed = r => r.status !== 200 || !r.json || r.json.ok === false || !!(r.json.result && r.json.result.error);
const msg = r => JSON.stringify(r.json).slice(0, 260);
const sync = async c => { const r = await c.getState(c.ver || 0); c.apply(r.json); };
const dealerObj = (code, over = {}) => Object.assign({ code, password: 'Dealer#Pass2026x', name: 'Test Dealer ' + code, person: 'Mina', city: 'Rajkot', phone: '94' + String(Math.abs(code.split('').reduce((n, c) => n * 31 + c.charCodeAt(0), 7))).padStart(8, '0').slice(0, 8), gst: '', address: 'Shop 3, Kalawad Road, Rajkot 360005', pincode: '360005', category: 'Retailer', freightApply: true, brandPct: {} }, over);
const prod = brand => { const S = app.engine.ctx.SEL, pid = Object.keys(S.IMG).find(p => S.findProduct(p).brand === brand), pr = S.findProduct(pid).product; return { pid, vid: pr.variants[0].id, flavour: (pr.flavours || [''])[0] || '', mrp: pr.variants[0].mrp }; };
const order = (code, brand, qty = 2) => { const p = prod(brand); return { items: [{ pid: p.pid, vid: p.vid, flavour: p.flavour, qty }], address: 'Shop 3, Kalawad Road, Rajkot 360005', pin: '360005', phone: '9444400001' }; };
test.before(async () => { app = await start({ memory: !process.env.TEST_DATABASE_URL }); for (const [k, c, p] of [['host', 'ADMIN', 'admin123'], ['sales', 'SALES', 'sales123'], ['sales2', 'SALES2', 'sales2123'], ['fin', 'FINANCE', 'fin123'], ['wh', 'WAREHOUSE', 'wh123'], ['f1', 'FIELD01', 'field123'], ['f2', 'FIELD02', 'field123']]) P[k] = await staff(app, c, p); });
test.after(async () => { await app.close(); });

test('CRM: each Sales person keeps their own leads; duplicates refused; the Host sees all; others none', async () => {
  const lead = { name: 'Apex Fitness', person: 'Ravi', phone: '9811122233', gst: '24AAPFU0939F1ZV', address: '12 MG Road, Surat 395001', city: 'Surat', pincode: '395001', category: 'Gym', email: 'ravi@apex.in' };
  const a = await P.sales.rpc('saveCrm', [lead, 'x', 'x']); assert.ok(!failed(a), msg(a)); P.leadId = a.json.result.rec.id;
  assert.ok(failed(await P.sales2.rpc('saveCrm', [Object.assign({}, lead, { name: 'Dup' }), 'x', 'x'])), 'a duplicate phone or GST is refused');
  assert.ok(!failed(await P.sales2.rpc('saveCrm', [{ name: 'Beta Foods', phone: '9822233344', city: 'Pune' }, 'x', 'x'])));
  for (const c of [P.sales, P.sales2, P.host]) await sync(c);
  const nm = c => (c.state.crm || []).map(r => r.name); assert.ok(nm(P.sales).includes('Apex Fitness') && !nm(P.sales).includes('Beta Foods')); assert.ok(nm(P.sales2).includes('Beta Foods') && !nm(P.sales2).includes('Apex Fitness'));
  assert.ok(nm(P.host).includes('Apex Fitness') && nm(P.host).includes('Beta Foods'), 'the Host sees every lead'); assert.equal(P.fin.state.crm, undefined, 'Finance gets no CRM data');
  assert.ok(failed(await P.sales2.rpc('crmNote', [P.leadId, 'not mine', 'x', 'x'])), 'cannot touch another Sales person\'s lead'); assert.equal((await P.fin.rpc('saveCrm', [{ name: 'Zed', phone: '9500000001' }, 'x', 'x'])).status, 403);
});
test('CRM lead becomes a dealer: details fetched, password generated once, login works, no prices yet so it cannot order by accident', async () => {
  const r = await P.sales.rpc('crmToDealer', [P.leadId, { code: 'APEX1' }, 'x', 'x']); assert.ok(!failed(r), msg(r)); const res = r.json.result; assert.equal(res.dealerCode, 'APEX1'); assert.ok(res.password.length >= 12);
  const dl = app.engine.get('dealers').find(x => x.code === 'APEX1'); assert.equal(dl.salesEmp, 'SALES'); assert.ok(!('password' in dl)); assert.ok(![...app.engine.state.values()].some(v => v.includes(res.password)), 'the password is stored nowhere in clear'); assert.equal((await new Client(app).login('dealer', 'APEX1', res.password)).status, 200);
  const dc = new Client(app); await dc.login('dealer', 'APEX1', res.password); const blocked = await dc.rpc('addOrder', ['APEX1', order('APEX1', 'bolt')]); assert.match(msg(blocked), /Purchase prices are not set/);
  assert.equal(app.engine.get('crm').find(x => x.id === P.leadId).status, 'Converted'); assert.ok(failed(await P.sales.rpc('saveCrm', [{ id: P.leadId, name: 'Changed', phone: '9811122233' }, 'x', 'x'])), 'a converted lead cannot be edited');
});

test('only the Host creates a consultant: zone, a state inside the zone, city and a senior Sales executive of the SAME zone', async () => {
  const e = { id: 'FTEST1', name: 'Test Field', dept: 'fieldsales', password: 'Field#Pass2026', email: 't@x.in', mobile: '9000000071', zone: 'West', state: 'Gujarat', city: 'Surat', manager: 'SALES' };
  assert.equal((await P.sales.rpc('saveEmployee', [e])).status, 403, 'Sales cannot'); assert.equal((await P.fin.rpc('saveEmployee', [e])).status, 403);
  for (const [why, over] of [['zone', { zone: '' }], ['state outside the zone', { state: 'Kerala' }], ['state', { state: '' }], ['city', { city: '' }], ['senior is not a Sales executive', { manager: 'FINANCE' }], ['senior works in another zone', { manager: 'SALES2' }], ['password policy', { password: 'abc' }]]) assert.ok(failed(await P.host.rpc('saveEmployee', [Object.assign({}, e, over)])), why + ' is refused');
  const r = await P.host.rpc('saveEmployee', [e]); assert.ok(!failed(r), msg(r)); const c = new Client(app), l = await c.login('staff', 'FTEST1', 'Field#Pass2026'); assert.equal(l.status, 200); assert.equal(l.json.me.dept, 'fieldsales'); assert.equal(l.json.me.role, 'employee');
  const rec = app.engine.get('employees').find(x => x.id === 'FTEST1'); assert.equal(rec.state, 'Gujarat'); assert.equal(rec.manager, 'SALES'); assert.ok(!rec.password, 'hashed, never stored in clear');
  assert.ok(failed(await P.host.rpc('saveEmployee', [Object.assign({}, e, { dept: 'sales' })])), 'a consultant cannot be turned into a Sales executive here');
});
test('a Sales executive needs a valid zone when one is given; the Host can set it', async () => {
  const s = app.engine.get('employees').find(x => x.id === 'SALES'); assert.equal(s.zone, 'West'); assert.ok(failed(await P.host.rpc('saveEmployee', [Object.assign({}, s, { zone: 'Middle' })])), 'an unknown zone is refused');
});
test('brands: only the senior Sales executive or the Host switch them; commission is required', async () => {
  assert.ok(failed(await P.sales2.rpc('setFieldBrand', ['FIELD01', 'bolt', true, 5, 'x', 'x'])), 'another Sales person cannot'); assert.equal((await P.f1.rpc('setFieldBrand', ['FIELD01', 'bolt', true, 5, 'x', 'x'])).status, 403, 'the consultant cannot'); assert.equal(app.engine.get('employees').find(e => e.id === 'FIELD01').fieldBrands.ved.pct, 4, 'a percentage passed by the senior never changes the commission (only the Host sets it)'); assert.ok(!failed(await P.sales.rpc('setFieldBrand', ['FIELD01', 'ved', true, 0, 'x', 'x'])));
  assert.ok(!failed(await P.sales.rpc('setFieldBrand', ['FIELD01', 'bolt', true, 5, 'x', 'x']))); assert.ok(!failed(await P.host.rpc('setFieldBrand', ['FIELD01', 'ved', true, 4, 'x', 'x'])));
});

test('a consultant creates dealers ONLY inside the allocated state (the pincode decides); never changes one', async () => {
  const out = await P.f1.rpc('saveDealerAs', [dealerObj('FOUT1', { city: 'Mumbai', address: 'Fort, Mumbai 400001', pincode: '400001' }), 'x', 'x']); assert.ok(failed(out)); assert.match(msg(out), /Maharashtra.*allocated to Gujarat|allocated to Gujarat/);
  assert.ok(failed(await P.f1.rpc('saveDealerAs', [dealerObj('FBAD1', { pincode: '12', address: 'Somewhere' }), 'x', 'x'])), 'a missing or invalid pincode is refused');
  assert.ok(!app.engine.get('dealers').some(d => d.code === 'FOUT1' || d.code === 'FBAD1'), 'nothing was created');
  const ok = await P.f1.rpc('saveDealerAs', [dealerObj('FNEW1', { prices: { 'bolt-wp|2lb': 1 } }), 'x', 'x']); assert.ok(!failed(ok), msg(ok)); const dl = app.engine.get('dealers').find(d => d.code === 'FNEW1');
  assert.equal(dl.salesEmp, 'FIELD01'); assert.equal(dl.pricesPending, true, 'the senior sets the purchase prices'); assert.deepEqual(dl.prices, {}, 'a consultant cannot set prices');
  const again = await P.f1.rpc('saveDealerAs', [dealerObj('FNEW1', { name: 'Renamed' }), 'x', 'x']); assert.ok(failed(again)); assert.match(msg(again), /cannot change a dealer/); assert.notEqual(app.engine.get('dealers').find(d => d.code === 'FNEW1').name, 'Renamed');
  await sync(P.sales); assert.ok(P.sales.state.alerts.some(a => /New dealer from the field/.test(a.title) && /purchase prices/.test(a.text)), 'the senior is told to add the prices');
});
test('the senior prices the dealer (another Sales person cannot); then the consultant orders only activated brands for their own dealers', async () => {
  const p = prod('bolt'), key = p.pid + '|' + p.vid, base = dealerObj('FNEW1'), priced = Object.assign({}, base, { name: app.engine.get('dealers').find(d => d.code === 'FNEW1').name, prices: { [key]: Math.round(p.mrp * 0.8) } });
  assert.match(msg(await P.f1.rpc('addOrder', ['FNEW1', order('FNEW1', 'bolt')])), /Purchase prices are not set/, 'blocked until priced'); assert.ok(failed(await P.sales2.rpc('saveDealerAs', [priced, 'x', 'x'])), 'another Sales person cannot price it');
  const ok = await P.sales.rpc('saveDealerAs', [priced, 'x', 'x']); assert.ok(!failed(ok), msg(ok)); const dl = app.engine.get('dealers').find(d => d.code === 'FNEW1'); assert.ok(!dl.pricesPending && dl.salesEmp === 'FIELD01', 'priced by the senior; it still belongs to the consultant');
  const good = await P.f1.rpc('addOrder', ['FNEW1', order('FNEW1', 'bolt')]); assert.ok(!failed(good), msg(good)); P.oid = good.json.result.id; assert.equal(good.json.result.attr.emp, 'FIELD01'); assert.equal(good.json.result.items[0].price, Math.round(p.mrp * 0.8));
  assert.match(msg(await P.f1.rpc('addOrder', ['FNEW1', order('FNEW1', 'pureluxe')])), /not activated for you/); assert.match(msg(await P.f1.rpc('addOrder', ['DEMO001', order('DEMO001', 'bolt')])), /only for your own dealers/);
});
test('CREATE-ONLY: a consultant can never change, cancel, delete, reset or mark paid; the server also discards any unlisted write', async () => {
  const before = JSON.stringify([app.engine.get('orders.FNEW1'), app.engine.get('dealers'), app.engine.get('crm')]);
  for (const [fn, args] of [['editOrder', ['FNEW1', P.oid, [], 'x', 'x']], ['cancelDiff', ['FNEW1', P.oid, 'x']], ['applyDiff', ['FNEW1', P.oid, 'x']], ['editPreorder', ['PRE-1', [], 'x']], ['cancelPreorder', ['PRE-1', 'x']], ['resetDealerPassword', ['FNEW1', 'Newer#Pass2026x', 'x', 'x']], ['setDealerActive', ['FNEW1', false, 'no', 'x', 'x']], ['markPaid', ['FNEW1', P.oid, { method: 'UPI', by: 'x' }]], ['saveDealer', [dealerObj('FNEW1', { name: 'Hacked' })]], ['deleteDealer', ['FNEW1']], ['saveOffer', [{ title: 'x', code: 'ZZ9', amount: 10 }, 'x']], ['setTarget', ['FIELD01', '2026-11', {}, 'x']], ['confirmOrder', ['FNEW1', P.oid, 'x']], ['approveRTO', ['FNEW1', P.oid, true, 'x', 'x', 'x']], ['suspendEmployee', ['SALES', {}, 'x', 'x']], ['saveIncPolicy', [{}, 'x']]]) assert.ok(failed(await P.f1.rpc(fn, args)), fn + ' must be refused');
  assert.equal(JSON.stringify([app.engine.get('orders.FNEW1'), app.engine.get('dealers'), app.engine.get('crm')]), before, 'nothing was changed by any of those attempts');
  const g = await app.commitCall('addStaffNotif', [{ key: 'zz', kind: 'k', audience: ['admin'], title: 'x', text: 'x', count: 1, at: 1 }], { fieldGuard: true }); assert.ok(g.denied, 'a write that is not on the consultant\'s list is refused by the server'); assert.ok(!app.engine.get('staffnotifs').some(n => n.key === 'zz'), 'and nothing is stored');
});
test('consultant CRM: adds leads and notes; cannot change or delete; the senior sees the leads; another Sales person does not; lead to dealer follows the state rule', async () => {
  const a = await P.f1.rpc('saveCrm', [{ name: 'Rajkot Fit Zone', person: 'Hardik', phone: '9811133344', pincode: '360001', city: 'Rajkot', address: 'Race Course, Rajkot 360001', category: 'Gym' }, 'x', 'x']); assert.ok(!failed(a), msg(a)); const id = a.json.result.rec.id;
  assert.ok(failed(await P.f1.rpc('saveCrm', [{ id, name: 'Changed', phone: '9811133344' }, 'x', 'x'])), 'a saved lead cannot be changed'); assert.equal((await P.f1.rpc('deleteCrm', [id, 'x', 'x'])).status, 403, 'nor deleted'); assert.ok(!failed(await P.f1.rpc('crmNote', [id, 'Called the owner', 'x', 'x'])));
  const far = await P.f1.rpc('saveCrm', [{ name: 'Mumbai Gym Co', person: 'Zubin', phone: '9811133355', pincode: '400001', city: 'Mumbai', address: 'Fort, Mumbai 400001', category: 'Gym' }, 'x', 'x']); assert.ok(!failed(far), 'a lead anywhere can be recorded'); const farId = far.json.result.rec.id;
  assert.ok(failed(await P.f1.rpc('crmToDealer', [farId, { code: 'FMUM1' }, 'x', 'x'])), 'but it cannot become a dealer outside the state'); assert.ok(!failed(await P.f1.rpc('crmToDealer', [id, { code: 'FRAJ1' }, 'x', 'x'])), 'inside the state it can'); assert.equal(app.engine.get('dealers').find(d => d.code === 'FRAJ1').salesEmp, 'FIELD01');
  await sync(P.sales); await sync(P.sales2); await sync(P.f1); await sync(P.f2); assert.ok(P.sales.state.crm.some(r => r.id === id), 'the senior sees the consultant\'s leads'); assert.ok(!P.sales2.state.crm.some(r => r.id === id), 'another Sales person does not'); assert.ok(!P.f2.state.crm.some(r => r.id === id), 'nor another consultant'); assert.ok(P.f1.state.crm.every(r => r.owner === 'FIELD01'));
});
test('payment: the consultant uploads the proof, only Finance can verify; commission is posted after verification, at the brand percentage', async () => {
  const o = app.engine.get('orders.FNEW1').find(x => x.id === P.oid), due = app.engine.peek('dueOf', [o]).result;
  const pr = await P.f1.rpc('addProof', ['FNEW1', P.oid, { method: 'UPI', ref: 'UTR' + Date.now() + (seq++), amount: due, date: new Date().toISOString().slice(0, 10), name: 'p', size: 70, data: PNG }, 'x', 'x']); assert.ok(!failed(pr), msg(pr));
  assert.equal((await P.f1.rpc('markPaid', ['FNEW1', P.oid, { method: 'UPI', by: 'x' }])).status, 403, 'a consultant can never mark an order paid'); assert.equal(app.engine.get('fcomm').filter(r => r.orderId === P.oid).length, 0, 'no commission before payment is verified');
  const pid = app.engine.get('orders.FNEW1').find(x => x.id === P.oid).proofs[0].id; assert.ok(!failed(await P.fin.rpc('verifyProof', ['FNEW1', P.oid, pid, due, 'Bank line checked ok', 'x', 'x'])));
  const rows = app.engine.get('fcomm').filter(r => r.orderId === P.oid); assert.equal(rows.length, 1); const ord = app.engine.get('orders.FNEW1').find(x => x.id === P.oid), base = ord.items.reduce((n, l) => n + l.qty * l.price, 0); assert.equal(rows[0].pct, 5); assert.ok(Math.abs(rows[0].amount - Math.round(base * 0.05 * 100) / 100) <= 0.02);
  await sync(P.f1); await sync(P.sales); await sync(P.sales2); assert.ok(P.f1.state.fcomm.every(r => r.emp === 'FIELD01')); assert.ok(P.sales.state.fcomm.some(r => r.orderId === P.oid), 'the senior sees it'); assert.ok(!(P.sales2.state.fcomm || []).some(r => r.emp === 'FIELD01'), 'another Sales person does not');
});
test('visits, RTO and the on-field segment', async () => {
  assert.ok(!failed(await P.f1.rpc('addVisit', [{ dealer: 'FNEW1', purpose: 'Introduced the new product', outcome: 'Will order', nextStep: 'Follow up' }, 'x', 'x']))); assert.ok(failed(await P.f1.rpc('addVisit', [{ dealer: 'FDEMO2', purpose: 'Not mine' }, 'x', 'x'])), 'only their own dealers');
  await sync(P.sales); await sync(P.sales2); assert.ok(P.sales.state.visits.some(v => v.dealer === 'FNEW1')); assert.ok(!(P.sales2.state.visits || []).some(v => v.dealer === 'FNEW1'));
  const ords = JSON.parse(app.engine.state.get('sel.v2.orders.FNEW1')); ords.forEach(o => { if (o.id === P.oid) { o.status = 'Dispatched'; o.whPush = true; } }); app.engine.state.set('sel.v2.orders.FNEW1', JSON.stringify(ords)); app.engine.ver.set('sel.v2.orders.FNEW1', ++app.engine.gv);
  assert.ok(!failed(await P.sales.rpc('requestRTO', ['FNEW1', P.oid, 'Dealer refused delivery, returning', 'x', 'x']))); assert.ok(app.engine.get('staffnotifs').some(n => /RTO approval/.test(n.title)));
  assert.ok(failed(await P.sales.rpc('approveRTO', ['FNEW1', P.oid, true, 'x', 'x', 'x'])), 'only the Host approves'); assert.ok(!failed(await P.host.rpc('approveRTO', ['FNEW1', P.oid, true, 'Approved, arrange pickup', 'x', 'x']))); assert.equal(app.engine.get('orders.FNEW1').find(o => o.id === P.oid).status, 'RTO');
  assert.ok(app.engine.peek('fieldOrders', ['SALES', 'employee']).result.some(o => o.id === P.oid)); assert.ok(!app.engine.peek('fieldOrders', ['SALES2', 'employee']).result.some(o => o.id === P.oid), 'another Sales person does not see them');
});

test('offers: a consultant sees the offers of their senior (and the company\'s), never another Sales executive\'s; the consultant cannot create any', async () => {
  const tpl = JSON.parse(JSON.stringify(app.engine.get('offers')[0])); delete tpl.id;
  const mk = (title, code) => Object.assign({}, tpl, { title, code, active: true });
  assert.ok(!failed(await P.sales.rpc('saveOffer', [mk('West deal by SALES', 'WESTX1'), 'x', 'x']))); assert.ok(!failed(await P.sales2.rpc('saveOffer', [mk('North deal by SALES2', 'NORTHX1'), 'x', 'x'])));
  assert.equal(app.engine.get('offers').find(o => o.code === 'WESTX1').createdBy, 'SALES', 'the creator is recorded by the server, not claimed by the browser');
  await sync(P.f1); await sync(P.f2); const t1 = P.f1.state.offers.map(o => o.code), t2 = P.f2.state.offers.map(o => o.code);
  assert.ok(t1.includes('WESTX1') && !t1.includes('NORTHX1'), 'FIELD01 (senior SALES) sees SALES\'s offers only'); assert.ok(t2.includes('NORTHX1') && !t2.includes('WESTX1'), 'FIELD02 (senior SALES2) sees SALES2\'s offers only'); assert.ok(t1.length > 1, 'and the company\'s own offers');
  assert.equal((await P.f1.rpc('saveOffer', [mk('Not allowed', 'NOPE1'), 'x', 'x'])).status, 403); assert.ok(!app.engine.get('offers').some(o => o.code === 'NOPE1'));
});
test('a Sales executive can neither edit nor suspend employees, nor see the Team data of others', async () => {
  for (const [fn, args] of [['saveEmployee', [Object.assign({}, app.engine.get('employees').find(e => e.id === 'FIELD01'), { name: 'Renamed' })]], ['suspendEmployee', ['FIELD01', {}, 'x', 'x']], ['transferEmployee', ['FIELD01', {}, 'x', 'x']], ['setSalary', ['FIELD01', 99999]], ['markEmployeeLeft', ['FIELD01', {}]]]) assert.equal((await P.sales.rpc(fn, args)).status, 403, fn + ' is not for Sales');
  assert.notEqual(app.engine.get('employees').find(e => e.id === 'FIELD01').name, 'Renamed'); await sync(P.sales); assert.ok(Object.keys(P.sales.state.salary || {}).every(k => k === 'SALES') && Object.keys(P.sales.state.att || {}).every(k => k === 'SALES'), 'only their own salary and attendance rows'); assert.ok(!(P.sales.state.employees || []).some(e => e.password));
});
