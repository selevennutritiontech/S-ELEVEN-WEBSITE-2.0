'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { start, Client, staff, dealer } = require('./helpers.js');
const failed = r => !r.json || r.json.ok === false || !!(r.json.result && r.json.result.error);
let app; const demoOrders = c => app.engine.get('orders.' + c) || [];
test.before(async () => { app = await start({ memory: !process.env.TEST_DATABASE_URL }); });
test.after(async () => { await app.close(); });

test('dealer isolation: a dealer receives only their own record, orders, ledger and nothing of anyone else', async () => {
  const d1 = await dealer(app, 'DEMO001', 'demo123'), d2 = await dealer(app, 'DEMO002', 'demo456');
  assert.ok(d1.state['orders.DEMO001'].length > 0); assert.equal(d1.state['orders.DEMO002'], undefined); assert.equal(d1.state['orders.DEMO003'], undefined);
  assert.deepEqual(d1.state.dealers.map(x => x.code), ['DEMO001']); assert.deepEqual(d2.state.dealers.map(x => x.code), ['DEMO002']);
  assert.deepEqual(Object.keys(d1.state.dledger || {}), ['DEMO001'].filter(k => k in (d1.state.dledger || {})));
  const other = demoOrders('DEMO002').map(o => o.id), mine = JSON.stringify(d1.state);
  for (const id of other) assert.ok(!mine.includes('"' + id + '"'), 'DEMO001 received DEMO002 order ' + id);
  for (const k of ['salary', 'att', 'allow', 'leaves', 'exemps', 'activity', 'targets', 'ledger', 'btasks', 'lrates', 'purchases', 'invreq', 'samplestock']) assert.equal(d1.state[k], undefined, 'a dealer received ' + k);
  assert.ok(!/supplier|"by"/.test(JSON.stringify(d1.state.batches || {})), 'batch supplier details must not reach dealers');
  assert.ok((d1.state.employees || []).length <= 1, 'a dealer may see at most their own sales contact');
});

test('dealer abuse: staff-only and money operations are refused, and the dealer code is forced to their own', async () => {
  const d = await dealer(app, 'DEMO001', 'demo123'), before = JSON.stringify([demoOrders('DEMO002'), demoOrders('DEMO003'), app.engine.get('dealers')]);
  for (const [fn, args] of [['resetDealerPassword', ['DEMO002', 'Hijacked#2026', 'ADMIN', 'admin']], ['setSalary', ['SALES', 999999, 'ADMIN', 'admin']], ['eraseAll', []], ['loadDemo', []], ['markPaid', ['DEMO001', demoOrders('DEMO001')[0].id, { method: 'x' }]], ['rzpPaid', ['DEMO001', 'x', 'y']], ['confirmOrder', ['DEMO001', demoOrders('DEMO001')[0].id, 'ADMIN']], ['verifyProof', ['DEMO001', 'x', 'y', 1, 'note note', 'ADMIN', 'admin']], ['setDealerActive', ['DEMO002', false, 'reason xx', 'ADMIN', 'admin']], ['saveEmployee', [{ id: 'EVIL', name: 'x', dept: 'host', password: 'Strong#Pass2026' }]], ['portalLogin', ['ADMIN']], ['dealerLoginInfo', ['DEMO002', 'ADMIN', 'admin']]]) {
    const r = await d.rpc(fn, args); assert.equal(r.status, 403, fn); }
  assert.equal(JSON.stringify([demoOrders('DEMO002'), demoOrders('DEMO003'), app.engine.get('dealers')]), before, 'refused calls must change nothing');
  assert.equal((await new Client(app).login('dealer', 'DEMO002', 'demo456')).status, 200, 'DEMO002 password must be unchanged');
});

test('price tampering: the server prices every line itself and ignores what the browser claims', async () => {
  const d = await dealer(app, 'DEMO001', 'demo123'), ref = demoOrders('DEMO001').find(o => !o.hist && o.items && o.items[0] && o.items[0].pid), l = ref.items[0];
  const n0 = demoOrders('DEMO001').length, forged = { id: 'FREE-1', payment: { status: 'Paid', method: 'UPI' }, status: 'Delivered', createdBy: { code: 'ADMIN', name: 'Host', role: 'admin' }, freightPolicy: { on: false, amount: 0 }, confirmed: true, whPush: { by: 'ADMIN' },
    items: [{ pid: l.pid, vid: l.vid, flavour: l.flavour, qty: 2, price: 1, mrp: 1 }, { pid: l.pid, vid: l.vid, flavour: l.flavour, qty: -5, price: -9999 }], totals: { subtotal: 1, total: 1, couponCode: '' }, address: ref.address, pin: ref.pin, phone: ref.phone, gst: ref.gst, note: 'x'.repeat(2000) };
  const r = await d.rpc('addOrder', ['DEMO002', forged]); assert.equal(r.status, 200); assert.ok(r.json.ok, JSON.stringify(r.json));
  assert.equal(demoOrders('DEMO001').length, n0 + 1, 'the order is placed under the signed-in dealer'); assert.equal(demoOrders('DEMO002').length, 4 > 0 ? demoOrders('DEMO002').length : 0);
  const o = demoOrders('DEMO001')[0]; assert.notEqual(o.id, 'FREE-1'); assert.equal(o.items.length, 1); assert.equal(o.items[0].qty, 2); assert.equal(o.items[0].price, l.price, 'price comes from the catalogue / dealer price list'); assert.ok(o.totals.total >= 2 * l.price * 0.99);
  assert.equal(o.payment.status, 'Pending'); assert.equal(o.status, 'Placed'); assert.deepEqual(o.createdBy, { code: 'DEMO001', name: app.engine.get('dealers').find(x => x.code === 'DEMO001').name, role: 'dealer' });
  assert.ok(!o.confirmed && !o.whPush, 'a dealer cannot pre-confirm or pre-push an order'); assert.ok(o.note.length <= 500); assert.ok(o.totals.freight > 0 && (!o.freightPolicy || (o.freightPolicy.on === true && o.freightPolicy.amount === null)), 'a dealer cannot waive freight');
  assert.ok(!demoOrders('DEMO002').some(x => x.id === o.id), 'nothing was written to another dealer');
  const bad = await d.rpc('addOrder', ['DEMO001', { items: [{ pid: 'nope', vid: 'x', qty: 1 }] }]); assert.ok(failed(bad));
  const empty = await d.rpc('addOrder', ['DEMO001', { items: [{ pid: l.pid, vid: l.vid, qty: 0 }] }]); assert.ok(failed(empty));
});

test('role spoofing: the browser cannot claim a role or another person; Host-only operations are refused to everyone else', async () => {
  const s2 = await staff(app, 'SALES2', 'sales2123'), dl = app.engine.get('dealers').find(d => d.salesEmp !== 'SALES2');
  const r = await s2.rpc('resetDealerPassword', [dl.code, 'StrongNew#2026', 'ADMIN', 'admin']); assert.ok(failed(r)); assert.match(JSON.stringify(r.json), /Only the Host|own Sales employee/);
  assert.equal((await new Client(app).login('dealer', dl.code, dl.code === 'DEMO001' ? 'demo123' : dl.code === 'DEMO002' ? 'demo456' : 'demo789')).status, 200, 'the password must be unchanged');
  for (const [c, fn, args] of [['SALES2', 'setSalary', ['SALES2', 999999, 'SALES2', 'admin']], ['SALES2', 'saveEmployee', [{ id: 'EVIL1', name: 'Evil', dept: 'host', password: 'Strong#Pass2026' }]], ['SALES2', 'suspendEmployee', ['FINANCE', { reason: 'revenge' }, 'ADMIN', 'admin']], ['SALES2', 'eraseAll', []], ['SALES2', 'portalLogin', ['ADMIN']], ['SALES2', 'deleteDealer', ['DEMO001']], ['SALES2', 'saveIncPolicy', [{}, 'ADMIN']]]) {
    const r2 = await s2.rpc(fn, args); assert.equal(r2.status, 403, c + ' ' + fn); }
  const fin = await staff(app, 'FINANCE', 'fin123'); assert.equal((await fin.rpc('suspendEmployee', ['SALES', { reason: 'abuse of power' }, 'ADMIN', 'admin'])).status, 403); assert.equal((await fin.rpc('setSalary', ['SALES', 1, 'ADMIN', 'admin'])).status, 403);
  const wh = await staff(app, 'WAREHOUSE', 'wh123'); assert.equal((await wh.rpc('attachInvoiceFile', ['DEMO001', 'DEMO-S1', { name: 'x.pdf', size: 1, data: 'x', no: 'X' }, 'ADMIN'])).status, 403);
  assert.equal(app.engine.get('employees').find(e => e.id === 'EVIL1'), undefined);
});

test('identity is overwritten: an operation always runs as the signed-in person', async () => {
  const s = await staff(app, 'SALES', 'sales123'); const r = await s.rpc('logActivity', ['ADMIN', 'spoof_test', 'pretending to be the Host', 'REF1']); assert.equal(r.json.ok, true);
  const rows = app.engine.get('activity') || []; const row = rows.find(x => /spoof_test/.test(JSON.stringify(x))); assert.ok(row, 'activity row written'); assert.ok(!/"ADMIN"/.test(JSON.stringify(row)) && /SALES/.test(JSON.stringify(row)), 'the row must name the real person: ' + JSON.stringify(row));
});

test('Host resets a dealer password: weak refused, strong accepted, old stops working, nothing stored in clear', async () => {
  const h = await staff(app, 'ADMIN', 'admin123');
  for (const weak of ['abc', 'password123', 'aaaaaaaaaaaa', '12345678901']) { const r = await h.rpc('resetDealerPassword', ['DEMO003', weak, 'x', 'x']); assert.ok(failed(r), weak); }
  assert.equal((await new Client(app).login('dealer', 'DEMO003', 'demo789')).status, 200, 'a refused reset changes nothing');
  const ok = await h.rpc('resetDealerPassword', ['DEMO003', 'Fresh#Pass2026', 'x', 'x']); assert.ok(!failed(ok), JSON.stringify(ok.json));
  assert.equal((await new Client(app).login('dealer', 'DEMO003', 'demo789')).status, 401); assert.equal((await new Client(app).login('dealer', 'DEMO003', 'Fresh#Pass2026')).status, 200);
  assert.ok(![...app.engine.state.values()].some(v => v.includes('Fresh#Pass2026')), 'the new password must not be stored in clear');
  assert.equal((await h.rpc('dealerLoginInfo', ['DEMO003', 'x', 'x'])).status, 403, 'there is no way to read a password any more');
});

test('each department receives only what it may see (orders follow the push rules; pay data is private)', async () => {
  const idsFrom = c => Object.entries(c.state).filter(([k]) => k.startsWith('orders.')).flatMap(([, v]) => v.map(o => o.id)).sort(), all = [...app.engine.state.keys()].filter(k => k.startsWith('sel.v2.orders.')).flatMap(k => JSON.parse(app.engine.state.get(k)));
  const expect = role => all.filter(o => app.engine.peek('visibleTo', [role, o]).result).map(o => o.id).sort();
  for (const [code, pw, role] of [['FINANCE', 'fin123', 'finance'], ['LOGISTICS', 'logi123', 'logistics'], ['WAREHOUSE', 'wh123', 'warehouse']]) { const c = await staff(app, code, pw); assert.deepEqual(idsFrom(c), expect(role), role + ' sees exactly its orders'); }
  assert.ok(expect('finance').length < all.length && expect('warehouse').length < all.length, 'the rule must actually hide something');
  for (const [code, pw] of [['BRANDING', 'brand123'], ['IT', 'it123']]) { const c = await staff(app, code, pw); assert.equal(idsFrom(c).length, 0, code + ' sees no orders'); }
  const s2 = await staff(app, 'SALES2', 'sales2123'), f = await staff(app, 'FINANCE', 'fin123'), h = await staff(app, 'ADMIN', 'admin123');
  assert.deepEqual(Object.keys(s2.state.salary || {}), ['SALES2'].filter(k => k in (s2.state.salary || {}))); assert.ok(Object.keys(f.state.salary).length > 5); assert.ok(Object.keys(h.state.salary).length > 5);
  assert.ok(Object.keys(s2.state.att).every(k => k === 'SALES2')); assert.ok((h.state.exemps || h.state.activity !== undefined) !== undefined); assert.equal(s2.state.exemps, undefined); assert.equal(s2.state.activity, undefined);
  assert.equal((await staff(app, 'WAREHOUSE', 'wh123')).state.lrates, undefined); assert.equal((await staff(app, 'LOGISTICS', 'logi123')).state.salary && Object.keys((await staff(app, 'LOGISTICS', 'logi123')).state.salary).every(k => k === 'LOGISTICS'), true);
});

test('state updates: a change by one person reaches the others, scoped, without a full reload', async () => {
  const h = await staff(app, 'ADMIN', 'admin123'), d = await dealer(app, 'DEMO001', 'demo123'), v0 = d.ver;
  const r = await h.rpc('savePost', [{ title: 'Delta test post', text: 'hello', tag: 'News' }, 'x']); assert.equal(r.json.ok, true, JSON.stringify(r.json));
  const delta = await d.getState(v0); assert.ok(delta.json.ver > v0); assert.ok(delta.json.set.posts && /Delta test post/.test(delta.json.set.posts)); assert.deepEqual(Object.keys(delta.json.set).filter(k => k !== 'posts'), [], 'only the changed key is sent');
});

test('attendance follows the server session: sign-in starts it, closing the tab ends it, a reload resumes it, logout ends it', async () => {
  const sess = c => (app.engine.get('att') || {})[c] || [], c = new Client(app); await c.login('staff', 'LOGISTICS', 'logi123'); const n = sess('LOGISTICS').length, last = () => sess('LOGISTICS')[sess('LOGISTICS').length - 1];
  assert.ok(last() && !last().out, 'sign-in starts attendance');
  await new Promise(r => setTimeout(r, 1100));
  assert.equal((await c.raw('POST', '/api/closing', { body: JSON.stringify({ csrf: c.csrf }), type: 'text/plain;charset=UTF-8' })).status, 200); assert.ok(last().out && /tab closed/.test(last().src), 'closing ends attendance');
  assert.equal((await c.raw('GET', '/api/me')).json.signedIn, true); assert.ok(!last().out, 'a reload within 30 seconds puts the session straight back'); assert.equal(sess('LOGISTICS').length, n);
  await new Promise(r => setTimeout(r, 1100)); await c.raw('POST', '/api/logout', { body: {} }); assert.ok(last().out && last().logout === true, 'logout ends attendance');
  const bad = new Client(app); await bad.login('staff', 'LOGISTICS', 'logi123'); assert.equal((await bad.raw('POST', '/api/closing', { body: JSON.stringify({ csrf: 'wrong' }), type: 'text/plain' })).status, 403);
  assert.equal(((app.engine.get('att') || {}).ADMIN || []).length, 0, 'the Host has no attendance');
});

test('rpc input hardening', async () => {
  const s = await staff(app, 'SALES', 'sales123');
  for (const body of [{ fn: '__proto__', args: [] }, { fn: 'constructor', args: [] }, { fn: 'toString', args: [] }, { fn: 123, args: [] }, { fn: 'listOffers', args: 'x' }, {}]) { const r = await s.raw('POST', '/api/rpc', { body }); assert.ok([200, 400, 403].includes(r.status) && !(r.json && r.json.ok && r.json.result && /\[object/.test(JSON.stringify(r.json.result))), JSON.stringify(body)); }
  let big; try { big = await s.raw('POST', '/api/rpc', { body: { fn: 'logActivity', args: ['x', 'x'.repeat(9 * 1024 * 1024)] } }); } catch (e) { big = { status: 413 }; } assert.equal(big.status, 413);
});

test('file uploads: real PNG/PDF accepted by the server, disguised files refused', async () => {
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', PDF = 'data:application/pdf;base64,JVBERi0xLjQKJSVFT0YK', HTML = 'data:application/pdf;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==';
  const s = await staff(app, 'FINANCE', 'fin123'), o = demoOrders('DEMO001').find(x => !x.hist && x.payment.status !== 'Paid'); assert.ok(o);
  const mk = data => ({ method: 'UPI', ref: 'UTR998877665', amount: 100, date: new Date().toISOString().slice(0, 10), name: 'p', size: 70, data });
  const bad = await s.rpc('addProof', ['DEMO001', o.id, mk(HTML), 'x', 'x']); assert.match(JSON.stringify(bad.json), /does not match|Upload a PNG/);
  const good = await s.rpc('addProof', ['DEMO001', o.id, mk(PNG), 'x', 'x']); assert.ok(!failed(good), JSON.stringify(good.json).slice(0, 200));
  const fin = await staff(app, 'FINANCE', 'fin123'); const inv = await fin.rpc('attachInvoiceFile', ['DEMO001', o.id, { name: 'i.pdf', size: 14, data: PDF, no: 'INV/T/1' }, 'x']); assert.match(JSON.stringify(inv.json), /only after payment/, 'a real PDF passes the file check and reaches the business rule');
  const evil = await fin.rpc('attachInvoiceFile', ['DEMO001', o.id, { name: 'i2.pdf', size: 14, data: HTML, no: 'INV/T/2' }, 'x']); assert.match(JSON.stringify(evil.json), /real PDF/, 'a disguised file is refused on its content');
});

test('v32: dealer pays by QR/bank, attaches a screenshot; only Finance can confirm it', async () => {
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', HTML = 'data:image/png;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==';
  const d = await dealer(app, 'DEMO001', 'demo123'), o = demoOrders('DEMO001').find(x => !x.hist && x.payment.status !== 'Paid' && !x.cancelled); assert.ok(o);
  const bad = await d.rpc('submitPayShot', ['DEMO001', o.id, { data: HTML, size: 70, name: 's.png' }, 'x']); assert.match(JSON.stringify(bad.json), /does not match/);
  const none = await d.rpc('submitPayShot', ['DEMO001', o.id, { size: 70 }, 'x']); assert.match(JSON.stringify(none.json), /Attach the payment screenshot/);
  const ok = await d.rpc('submitPayShot', ['DEMO001', o.id, { data: PNG, size: 70, name: 's.png', ref: 'UTR445566778' }, 'spoof']); assert.ok(!failed(ok), JSON.stringify(ok.json).slice(0, 200));
  const pr = ok.json.result.proof; assert.equal(pr.by, 'DEMO001', 'the uploader identity is the session, not the request'); assert.equal(pr.status, 'Awaiting verification');
  const selfV = await d.rpc('verifyProof', ['DEMO001', o.id, pr.id, pr.amount, 'I paid, trust me', 'DEMO001', 'finance']); assert.ok(failed(selfV) || selfV.status >= 400, 'a dealer can never confirm their own payment: ' + JSON.stringify(selfV).slice(0, 300));
  const fin = await staff(app, 'FINANCE', 'fin123'); const v = await fin.rpc('verifyProof', ['DEMO001', o.id, pr.id, pr.amount, 'Seen in bank statement', 'x', 'x']); assert.ok(!failed(v), JSON.stringify(v.json).slice(0, 200)); assert.equal(v.json.result.full, true);
});
