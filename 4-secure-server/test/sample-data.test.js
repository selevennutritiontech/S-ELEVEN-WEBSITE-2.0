'use strict';
/* The demo's sample data: 4 consultants in 4 zones under a senior Sales executive of the same zone, their dealers inside their state, orders at every stage, leads, visits, an RTO waiting. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { start, staff, dealer } = require('./helpers.js');
let app; const P = {};
test.before(async () => { app = await start({ memory: true }); for (const [k, c, p] of [['host', 'ADMIN', 'admin123'], ['sales', 'SALES', 'sales123'], ['sales2', 'SALES2', 'sales2123'], ['sales3', 'SALES3', 'sales3123'], ['fin', 'FINANCE', 'fin123'], ['log', 'LOGISTICS', 'logi123'], ['wh', 'WAREHOUSE', 'wh123'], ['f1', 'FIELD01', 'field123'], ['f2', 'FIELD02', 'field123'], ['f3', 'FIELD03', 'field123']]) { P[k] = await staff(app, c, p); await P[k].getState(0).then(r => P[k].apply(r.json)); } });
test.after(async () => { await app.close(); });
const ids = (c, code) => (c.state['orders.' + code] || []).map(o => o.id).sort();

test('the sample data is consistent: zones, states, seniors and dealers all agree', () => {
  const emps = app.engine.get('employees'), fe = emps.filter(e => e.dept === 'fieldsales'), Z = app.engine.ctx.DB.ZSTATES;
  assert.deepEqual(fe.map(e => [e.id, e.zone, e.state, e.manager].join(':')).sort(), ['FIELD01:West:Gujarat:SALES', 'FIELD02:North:Delhi:SALES2', 'FIELD03:South:Karnataka:SALES3', 'FIELD04:East:West Bengal:SALES4']);
  assert.deepEqual(emps.filter(e => e.dept === 'sales').map(e => e.zone).sort(), ['East', 'North', 'South', 'West']);
  for (const e of fe) { assert.ok(Z[e.zone].includes(e.state), e.id + ': the state belongs to the zone'); assert.equal(emps.find(m => m.id === e.manager).zone, e.zone, e.id + ': the senior works in the same zone'); }
  for (const d of app.engine.get('dealers').filter(d => /^FDEMO/.test(d.code))) { const c = fe.find(e => e.id === d.salesEmp); assert.ok(c, d.code + ' belongs to a consultant'); assert.equal(app.engine.ctx.DB.stateFromPin(d.pincode).name, c.state, d.code + ' is inside the consultant\'s state'); }
});
test('orders at every stage; an RTO waiting for the Host; commission; leads; visits', () => {
  const od = [].concat(...['FDEMO1', 'FDEMO2', 'FDEMO3', 'FDEMO4', 'FDEMO5'].map(c => app.engine.get('orders.' + c))), st = Object.fromEntries(od.map(o => [o.id, o.status + '/' + o.payment.status]));
  assert.deepEqual(st, { 'DEMO-FO1': 'Delivered/Paid', 'DEMO-FO2': 'Dispatched/Paid', 'DEMO-FO3': 'Placed/Pending', 'DEMO-FO4': 'Placed/Pending', 'DEMO-FO5': 'Placed/Paid', 'DEMO-FO6': 'Delivered/Paid', 'DEMO-FO7': 'Dispatched/Paid', 'DEMO-FO8': 'Placed/Paid', 'DEMO-FO9': 'Placed/Paid' });
  assert.ok(od.every(o => app.engine.get('employees').some(e => e.id === o.attr.emp && e.dept === 'fieldsales'))); assert.equal(od.find(o => o.id === 'DEMO-FO7').rto.status, 'Pending'); assert.ok(app.engine.get('staffnotifs').some(n => n.popup === 'rto' && n.orderId === 'DEMO-FO7'));
  assert.ok(app.engine.get('fcomm').length >= 6 && app.engine.get('fcomm').every(r => r.amount > 0)); assert.ok(app.engine.get('fcomm').every(r => od.some(o => o.id === r.orderId && o.payment.status === 'Paid')), 'commission exists only for paid orders');
  assert.equal(app.engine.get('crm').length, 12); assert.equal(app.engine.get('visits').length, 10);
});
test('each Sales executive receives their own leads plus their consultants\'; the Host all; Finance none', () => {
  const ix = c => (c.state.crm || []).map(r => r.id).sort();
  assert.deepEqual(ix(P.sales), ['CRM-0001', 'CRM-0002', 'CRM-0003', 'CRM-0004', 'CRM-0005', 'CRM-0008', 'CRM-0009']); assert.deepEqual(ix(P.sales2), ['CRM-0006', 'CRM-0007', 'CRM-0010']); assert.deepEqual(ix(P.sales3), ['CRM-0011']); assert.equal(P.host.state.crm.length, 12); assert.equal(P.fin.state.crm, undefined);
  assert.deepEqual([...new Set(P.sales.state.visits.map(v => v.emp))], ['FIELD01']); assert.deepEqual([...new Set(P.sales2.state.visits.map(v => v.emp))], ['FIELD02']); assert.equal(P.host.state.visits.length, 10); assert.equal(P.wh.state.visits, undefined);
  assert.ok(P.sales.state.fcomm.length > 0 && P.sales.state.fcomm.every(r => r.emp === 'FIELD01')); assert.equal((P.sales2.state.fcomm || []).length, 0, 'FIELD02 has no paid order yet'); assert.equal(P.wh.state.fcomm, undefined);
});
test('a consultant sees only their own dealers, orders, leads, visits and commission', () => {
  assert.deepEqual(P.f1.state.dealers.map(d => d.code).sort(), ['FDEMO1', 'FDEMO4']); assert.deepEqual(Object.keys(P.f1.state).filter(k => k.startsWith('orders.')).sort(), ['orders.FDEMO1', 'orders.FDEMO4']); assert.deepEqual(ids(P.f1, 'FDEMO1'), ['DEMO-FO1', 'DEMO-FO2']);
  assert.ok(P.f1.state.visits.every(v => v.emp === 'FIELD01') && P.f1.state.visits.length === 4); assert.ok(P.f1.state.fcomm.every(r => r.emp === 'FIELD01') && P.f1.state.fcomm.length === 4); assert.ok(P.f1.state.crm.every(r => r.owner === 'FIELD01') && P.f1.state.crm.length === 2);
  assert.deepEqual(P.f2.state.dealers.map(d => d.code), ['FDEMO2']); assert.equal((P.f2.state.fcomm || []).length, 0); assert.equal(P.f1.state.employees.find(e => e.id === 'FIELD02').fieldBrands, undefined, 'other consultants\' commission rates are not shared');
});
test('on-field orders: the data layer returns all 9; a Sales executive only their consultants\'', () => {
  const f = (role, code) => app.engine.peek('fieldOrders', [code, role]).result.map(o => o.id).sort();
  for (const [role, code] of [['logistics', 'LOGISTICS'], ['finance', 'FINANCE'], ['admin', 'ADMIN']]) assert.equal(f(role, code).length, 9);
  assert.deepEqual(f('employee', 'SALES'), ['DEMO-FO1', 'DEMO-FO2', 'DEMO-FO7']); assert.deepEqual(f('employee', 'SALES2'), ['DEMO-FO3', 'DEMO-FO4']); assert.deepEqual(f('employee', 'SALES3'), ['DEMO-FO5', 'DEMO-FO6', 'DEMO-FO8']); assert.deepEqual(f('employee', 'FIELD02'), ['DEMO-FO3', 'DEMO-FO4']);
});
test('the Host approves the sample RTO; a Sales person cannot', async () => {
  assert.equal((await P.sales.rpc('approveRTO', ['FDEMO4', 'DEMO-FO7', true, 'x', 'x', 'x'])).status, 403);
  const r = await P.host.rpc('approveRTO', ['FDEMO4', 'DEMO-FO7', true, 'Approved, arrange the pickup', 'x', 'x']); assert.ok(r.json.result.ok, JSON.stringify(r.json).slice(0, 200)); assert.equal(app.engine.get('orders.FDEMO4').find(o => o.id === 'DEMO-FO7').status, 'RTO');
});
test('only the senior Sales executive (or the Host) confirms an on-field order', async () => {
  assert.equal((await P.f3.rpc('confirmOrder', ['FDEMO3', 'DEMO-FO8', 'x'])).status, 403, 'the consultant cannot confirm their own order');
  const other = await P.sales.rpc('confirmOrder', ['FDEMO3', 'DEMO-FO8', 'x']); assert.match(JSON.stringify(other.json), /allocated/i, 'a Sales executive who is not the senior cannot'); assert.ok(!app.engine.get('orders.FDEMO3').find(o => o.id === 'DEMO-FO8').confirmed);
  const ok = await P.sales3.rpc('confirmOrder', ['FDEMO3', 'DEMO-FO8', 'x']); assert.ok(!ok.json.result || !ok.json.result.error, JSON.stringify(ok.json).slice(0, 200)); assert.ok(app.engine.get('orders.FDEMO3').find(o => o.id === 'DEMO-FO8').confirmed);
});
test('a sample consultant\'s dealer signs in to the dealer portal and sees only its own data', async () => {
  const d = await dealer(app, 'FDEMO2', 'fdemo123'); await d.getState(0).then(r => d.apply(r.json)); assert.deepEqual(Object.keys(d.state).filter(k => k.startsWith('orders.')), ['orders.FDEMO2']); for (const k of ['crm', 'fcomm', 'visits', 'staffnotifs', 'att', 'salary']) assert.equal(d.state[k], undefined, k);
});

test('a CLEAN install gets no sample data at all and starts with the Host only', async () => {
  const clean = await start({ memory: true, cfg: { seedDemo: false, initialAdminPassword: 'Admin#Pass2026' } });
  try {
    assert.deepEqual(clean.engine.get('employees').map(e => e.id), ['ADMIN']); assert.equal(clean.engine.get('dealers').length, 0);
    for (const k of ['crm', 'visits', 'fcomm']) assert.ok(!(clean.engine.get(k) || []).length, k + ' must be empty on a clean install');
    const h = await staff(clean, 'ADMIN', 'Admin#Pass2026'); assert.ok(h, 'the Host signs in with the chosen password');
    assert.ok(!clean.engine.get('employees').some(e => /^FIELD/.test(e.id)) && !clean.engine.get('dealers').some(d => /^FDEMO/.test(d.code)), 'no demo consultants or dealers');
  } finally { await clean.close(); }
});
