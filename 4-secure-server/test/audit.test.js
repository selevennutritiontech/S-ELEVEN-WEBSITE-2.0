'use strict';
/* FINAL AUDIT — authorized negative tests for the owner's own portal.
   Independent of the regression suite: each test drives the live server as an untrusted client
   (forged cookie, another dealer's ids, staff-only calls from a dealer, traversal, method/replay)
   and asserts the server refuses. "ok" means the attempt was correctly blocked. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { start, Client, staff, dealer } = require('../test/helpers.js');
let app, A, B, F1, SALES, WH, HOST;
const blocked = r => r.status === 401 || r.status === 403 || (r.json && (r.json.denied || (r.json.result && r.json.result.error) || r.json.error));

test.before(async () => {
  app = await start({ memory: !process.env.TEST_DATABASE_URL });
  HOST = await staff(app, 'ADMIN', 'admin123'); SALES = await staff(app, 'SALES', 'sales123'); WH = await staff(app, 'WAREHOUSE', 'wh123');
  A = await dealer(app, 'DEMO001', 'demo123'); B = await dealer(app, 'DEMO002', 'demo456'); F1 = await dealer(app, 'FDEMO1', 'fdemo123');
  for (const c of [HOST, SALES, WH, A, B, F1]) { const r = await c.getState(0); c.apply(r.json); }
});
test.after(async () => { await app.close(); });

test('A1 anonymous requests to data and action routes are refused', async () => {
  const c = new Client(app);
  const routes = [['GET', '/api/state?since=0'], ['GET', '/api/security'], ['GET', '/api/sheets/config']];
  for (const [m, p] of routes) { const r = await c.raw(m, p); assert.ok(r.status === 401 || r.status === 403, m + ' ' + p + ' got ' + r.status); }
  // /api/me is the login-screen probe: it answers 200 but must carry no identity and no data when anonymous
  const me = await c.raw('GET', '/api/me');
  assert.equal(me.json && me.json.signedIn, false, '/api/me leaked a session');
  assert.ok(me.json && !me.json.me && !me.json.state, '/api/me returned identity or data to an anonymous client');
  for (const [p, body] of [['/api/rpc', { fn: 'addOrder', args: [] }], ['/api/security', { action: 'reset', code: 'ADMIN' }], ['/api/closing', { closing: {} }]]) {
    const r = await c.raw('POST', p, { body }); assert.ok(r.status === 401 || r.status === 403, p + ' got ' + r.status);
  }
});

test('A2 forged or mutated session cookies never authenticate', async () => {
  const good = A.cookie.split('=')[1];
  for (const forged of ['sid=' + 'a'.repeat(good.length), 'sid=', 'sid=' + good.slice(0, -2) + 'zz']) {
    const c = new Client(app); c.cookie = forged; assert.equal((await c.getState(0)).status, 401, forged.slice(0, 16));
  }
});

test('A3 a write without the CSRF token, with a wrong token, or from a foreign Origin is refused', async () => {
  const body = { fn: 'updateProfile', args: [{ phone: '9111111111' }], since: 0 };
  assert.ok(blocked(await A.raw('POST', '/api/rpc', { body, noCsrf: true })), 'missing token');
  const saved = A.csrf; A.csrf = 'x'.repeat(saved.length || 32);
  assert.ok(blocked(await A.raw('POST', '/api/rpc', { body })), 'wrong token'); A.csrf = saved;
  assert.ok(blocked(await A.raw('POST', '/api/rpc', { body, headers: { Origin: 'https://not-ours.example' } })), 'foreign Origin');
});

test('A4 a dealer session receives only its own records, and no staff or credential material', async () => {
  const keys = Object.keys(A.state);
  assert.ok(keys.length > 2, 'dealer A does get its own data');
  assert.deepEqual(keys.filter(k => /DEMO002|DEMO003|FDEMO/.test(k)), [], 'another dealer key leaked');
  const blob = JSON.stringify(A.state);
  assert.ok(!/passhash|"hash"|\$2[aby]\$|scrypt:/i.test(blob), 'credential material in dealer state');
  assert.ok(A.state.employees == null || A.state.employees.length === 0, 'employee records exposed to a dealer');
});

test('A5 a dealer cannot read, change, or reprice another dealer\'s order through the data layer', async () => {
  const bOrders = HOST.state['orders.DEMO002'] || [];
  assert.ok(bOrders.length > 0, 'precondition: dealer B has orders');
  const victim = bOrders[0].id;
  // a dealer only ever names its own code to the API; try to act on B's order while signed in as A
  for (const [fn, args] of [['addProof', ['DEMO002', victim, { method: 'UPI', ref: 'X', amount: 1 }]], ['cancelOrder', ['DEMO002', victim]], ['confirmReceipt', ['DEMO002', victim]]]) {
    assert.ok(blocked(await A.rpc(fn, args)), fn + ' on another dealer was not blocked');
  }
  // and A's own state still shows nothing belonging to B
  assert.equal((A.state['orders.DEMO002'] || []).length, 0, 'B orders appeared in A state');
});

test('A6 staff-only actions are refused from a dealer session', async () => {
  for (const [fn, args] of [['saveEmployee', [{ id: 'HACK', name: 'x', dept: 'host', password: 'Whatever12345' }]], ['setFieldCommission', ['FIELD01', 'bolt', { mode: 'percent', pct: 99 }]], ['verifyProof', ['DEMO001', 'x', 'y', 1, 'z']], ['receiveStock', ['bolt|2lb', 100, 'x']]]) {
    assert.ok(blocked(await A.rpc(fn, args)), fn + ' ran for a dealer');
  }
  assert.ok(blocked(await A.raw('POST', '/api/security', { body: { action: 'policy', all: false } })), 'security page for a dealer');
});

test('A7 role boundaries hold between staff departments', async () => {
  // Warehouse cannot move stock or set commission; those belong to Finance/Logistics/Host
  assert.ok(blocked(await WH.rpc('receiveStock', ['bolt|2lb', 5, 'x'])), 'warehouse changed stock');
  assert.ok(blocked(await WH.rpc('setFieldCommission', ['FIELD01', 'bolt', { mode: 'percent', pct: 5 }])), 'warehouse set commission');
  // Sales cannot reach HR actions
  assert.ok(blocked(await SALES.rpc('decideLeave', ['x', 'approve'])), 'sales decided leave');
  assert.ok(blocked(await SALES.rpc('setSalary', ['LOGISTICS', 50000])), 'sales set a salary');
});

test('A8 path traversal and hidden paths are refused by the static server', async () => {
  const c = new Client(app);
  for (const p of ['/../src/config.js', '/..%2f..%2fsrc/server.js', '/dealer-portal/js/%2e%2e/%2e%2e/src/store.js', '/.env', '/employee/index.html', '/backend/']) {
    const r = await c.raw('GET', p); assert.ok(r.status === 404 || r.status === 403 || r.status === 400, p + ' served ' + r.status);
  }
});

test('A9 non-GET methods on the static server and bad bodies are handled, not crashed', async () => {
  const c = new Client(app);
  assert.equal((await c.raw('PUT', '/dealer-portal/index.html', { body: 'x' })).status, 405, 'PUT on a file');
  const r = await A.raw('POST', '/api/rpc', { body: '{ not json', type: 'application/json' }); assert.ok(r.status >= 400 && r.status < 500, 'bad JSON -> ' + r.status);
});

test('A10 an unknown rpc name and a non-allow-listed field write are rejected', async () => {
  assert.ok(blocked(await A.rpc('dropEverything', [])), 'unknown rpc accepted');
  // mass-assignment attempt: a dealer tries to flip its own account fields through a known rpc
  await A.rpc('updateProfile', [{ phone: '9222222222', salesEmp: 'NOBODY', creditLimit: 9e9, active: true }]);
  const me = (A.state.dealers || []).find(d => d.code === 'DEMO001') || {};
  assert.notEqual(me.creditLimit, 9e9, 'creditLimit was mass-assigned');
  assert.notEqual(me.salesEmp, 'NOBODY', 'salesEmp was mass-assigned');
});
