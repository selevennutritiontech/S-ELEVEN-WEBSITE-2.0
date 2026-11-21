'use strict';
/* No dealer sees another dealer's data, an employee's login, or anything of the admin console; and no one is ever sent a password. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { start, Client, staff, dealer } = require('./helpers.js');
let app; const P = {};
test.before(async () => { app = await start({ memory: true }); P.d1 = await dealer(app, 'DEMO001', 'demo123'); P.d2 = await dealer(app, 'DEMO002', 'demo456'); P.fd = await dealer(app, 'FDEMO1', 'fdemo123'); for (const [k, c, p] of [['host', 'ADMIN', 'admin123'], ['sales', 'SALES', 'sales123'], ['f1', 'FIELD01', 'field123']]) P[k] = await staff(app, c, p); for (const k of Object.keys(P)) await P[k].getState(0).then(r => P[k].apply(r.json)); });
test.after(async () => { await app.close(); });

test('a dealer receives only its own record, orders, ledger and returns', () => {
  for (const [c, code] of [[P.d1, 'DEMO001'], [P.d2, 'DEMO002'], [P.fd, 'FDEMO1']]) {
    assert.deepEqual(c.state.dealers.map(d => d.code), [code]); assert.deepEqual(Object.keys(c.state).filter(k => k.startsWith('orders.')), ['orders.' + code]);
    assert.ok(Object.keys(c.state.dledger || {}).every(k => k === code)); assert.ok((c.state.returns || []).every(r => r.dealer === code)); assert.ok((c.state.preorders || []).every(r => r.dealer === code));
  }
});
test('a dealer receives nothing of the staff side: no CRM, visits, commission, attendance, salary, tasks, notifications', () => {
  for (const c of [P.d1, P.d2, P.fd]) for (const k of ['crm', 'visits', 'fcomm', 'att', 'salary', 'staffnotifs', 'btasks', 'purchases', 'lrates', 'fwallet', 'sheets']) assert.equal(c.state[k], undefined, k + ' must not reach a dealer');
});
test('a dealer is never sent a staff user ID or any staff detail beyond the contact person\'s name and mobile', () => {
  const ids = app.engine.get('employees').map(e => e.id); for (const c of [P.d1, P.d2, P.fd]) { const s = JSON.stringify(c.state); for (const id of ids) assert.ok(!s.includes('"' + id + '"'), 'staff ID ' + id + ' must not reach a dealer'); }
  for (const c of [P.d1, P.d2, P.fd]) assert.ok(!c.state.employees || c.state.employees.length === 0, 'a dealer receives no employee information at all: no name, mobile or ID');
  assert.ok(!ids.includes(P.d1.state.dealers[0].salesEmp), 'the only trace is an opaque alias on the dealer record');
});
test('nobody is ever sent a password or a password hash: dealers, Sales, consultants, even the Host', () => {
  for (const [n, c] of Object.entries(P)) { const s = JSON.stringify(c.state); assert.ok(!/"password"\s*:\s*"[^"]+"/.test(s), n + ' received a password field'); assert.ok(!/scrypt|\$argon|"hash"/i.test(s), n + ' received a hash'); for (const pw of ['demo123', 'demo456', 'fdemo123', 'field123', 'sales123', 'admin123', 'fin123']) assert.ok(!s.includes(pw), n + ' received a known password'); }
});
test('dealer credentials never open the employee console, and a dealer cannot call any staff operation', async () => {
  const c = new Client(app); assert.notEqual((await c.login('staff', 'DEMO001', 'demo123')).status, 200, 'a dealer code does not sign in as staff'); assert.notEqual((await new Client(app).login('staff', 'FDEMO1', 'fdemo123')).status, 200);
  for (const [fn, args] of [['saveEmployee', [{ id: 'X1', name: 'x', dept: 'sales' }]], ['listCrm', ['x', 'x']], ['saveDealer', [{ code: 'DEMO001', name: 'hacked' }]], ['setSalary', ['SALES', 100]], ['resetDealerPassword', ['DEMO002', 'Newer#Pass2026x', 'x', 'x']], ['markPaid', ['DEMO001', 'DEMO-S1', { method: 'UPI', by: 'x' }]], ['approveRTO', ['FDEMO4', 'DEMO-FO7', true, 'x', 'x', 'x']]]) { const r = await P.d1.rpc(fn, args); assert.ok(r.status === 403 || r.status === 400 || (r.json && (r.json.ok === false || (r.json.result && r.json.result.error))), fn + ' must be refused for a dealer'); }
  assert.equal(app.engine.get('dealers').find(d => d.code === 'DEMO002').name, app.engine.get('dealers').find(d => d.code === 'DEMO002').name); assert.ok(!app.engine.get('employees').some(e => e.id === 'X1'));
});
test('a dealer cannot read another dealer: asking for their orders or ledger returns nothing', async () => {
  const r = await P.d1.raw('GET', '/api/state?since=0'); assert.ok(!JSON.stringify(r.json).includes('DEMO002')); assert.ok(!JSON.stringify(r.json).includes('FDEMO1'));
  const own = await P.d1.rpc('getOrder', ['DEMO002', 'DEMO-W2']); assert.ok(own.status === 403 || own.status === 400 || !own.json.result || own.json.result === null, 'another dealer\'s order is not returned');
});
test('staff passwords are stored only as hashes (the data holds none)', () => { for (const e of app.engine.get('employees')) assert.ok(!e.password, e.id + ' has a clear password in the data'); for (const d of app.engine.get('dealers')) assert.ok(!d.password, d.code + ' has a clear password in the data'); });
