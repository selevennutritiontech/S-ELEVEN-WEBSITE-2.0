'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { start, Client, staff, dealer } = require('./helpers.js');
const DEMO_PWS = ['demo123', 'demo456', 'demo789', 'admin123', 'sales123', 'logi123', 'wh123', 'fin123', 'brand123', 'it123'];
let app;
test.before(async () => { app = await start({ memory: !process.env.TEST_DATABASE_URL }); });
test.after(async () => { await app.close(); });

test('boot: no plain password remains anywhere in the data; hashes are in the vault', () => {
  const blob = [...app.engine.state.values()].join('\n');
  for (const pw of DEMO_PWS) assert.ok(!blob.includes('"' + pw + '"'), 'plain password found in data: ' + pw);
  assert.ok(!/"password"\s*:/.test(blob), 'a password field is still stored in the data');
  assert.ok(app.auth.creds.size >= 15, 'vault should hold hashes for every dealer and employee'); for (const h of app.auth.creds.values()) assert.match(h, /^scrypt\$16384\$8\$1\$/);
});

test('headers: every response carries the security headers', async () => {
  const c = new Client(app);
  for (const p of ['/', '/api/ping', '/access/employee-server', '/js/db.js']) {
    const r = await c.raw('GET', p); const h = r.headers;
    assert.match(h.get('content-security-policy'), /default-src 'self'.*script-src 'self'.*object-src 'none'.*frame-ancestors 'none'/, p);
    assert.equal(h.get('x-content-type-options'), 'nosniff'); assert.equal(h.get('x-frame-options'), 'DENY'); assert.equal(h.get('referrer-policy'), 'no-referrer');
    assert.ok(h.get('permissions-policy')); assert.equal(h.get('cross-origin-opener-policy'), 'same-origin-allow-popups');
  }
  const api = await c.raw('GET', '/api/me'); assert.equal(api.headers.get('cache-control'), 'no-store');
});

test('static: only the portal files are served (no traversal, no server code, no dotfiles)', async () => {
  const c = new Client(app);
  assert.equal((await c.raw('GET', '/')).status, 200);
  for (const p of ['/../src/server.js', '/%2e%2e/src/server.js', '/js/../../src/config.js', '/..%2f..%2fpackage.json', '/.env', '/js/.hidden', '/%00', '/src/server.js']) { const r = await c.raw('GET', p); assert.ok([400, 403, 404].includes(r.status), p + ' => ' + r.status); assert.ok(!/createApp|scrypt|APP_SECRET/.test(r.text), 'leaked server code via ' + p); }
});

test('sign-in: success sets an HttpOnly SameSite=Strict cookie; wrong and unknown accounts look identical', async () => {
  const ok = new Client(app), r = await ok.login('staff', 'SALES', 'sales123'); assert.equal(r.status, 200);
  assert.match(ok.lastSet, /HttpOnly/); assert.match(ok.lastSet, /SameSite=Strict/); assert.match(ok.lastSet, /Path=\//);
  assert.equal(r.json.me.role, 'employee'); assert.ok(r.json.me.csrf);
  const wrong = await new Client(app).raw('POST', '/api/login', { body: { kind: 'staff', code: 'SALES', password: 'nope' } });
  const unknown = await new Client(app).raw('POST', '/api/login', { body: { kind: 'staff', code: 'NOBODY99', password: 'nope' } });
  assert.equal(wrong.status, 401); assert.equal(unknown.status, 401); assert.deepEqual(wrong.json, unknown.json);
});

test('no response ever contains a password or a password field', async () => {
  const people = [['staff', 'ADMIN', 'admin123'], ['staff', 'SALES', 'sales123'], ['staff', 'FINANCE', 'fin123'], ['staff', 'WAREHOUSE', 'wh123'], ['dealer', 'DEMO001', 'demo123'], ['dealer', 'DEMO002', 'demo456']];
  for (const [k, c, p] of people) { const cl = new Client(app), r = await cl.login(k, c, p); assert.equal(r.status, 200, c); const all = r.text + (await cl.getState(0)).text + (await cl.raw('GET', '/api/me')).text;
    for (const pw of DEMO_PWS) assert.ok(!all.includes(pw), c + ' received a plain password ' + pw); assert.ok(!/"password"|\\"password\\"/.test(all), c + ' received a password field'); assert.ok(!/scrypt\$/.test(all), c + ' received a hash'); }
});

test('forged cookies and tokens are rejected', async () => {
  for (const cookie of ['__Host-sel=forged', 'sel_sid=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 'sel_sid=' + 'x'.repeat(500), 'sel_sid=ADMIN']) { const c = new Client(app); c.cookie = cookie; const r = await c.raw('GET', '/api/state'); assert.equal(r.status, 401, cookie.slice(0, 30)); const m = await c.raw('GET', '/api/me'); assert.equal(m.json.signedIn, false); }
  const c = new Client(app); const r = await c.raw('POST', '/api/login', { body: { kind: 'staff', code: 'ADMIN', password: { $ne: '' } } }); assert.equal(r.status, 401);   // object instead of text
});

test('csrf, origin and content-type are enforced on every change', async () => {
  const s = await staff(app, 'SALES', 'sales123');
  assert.equal((await s.raw('POST', '/api/rpc', { body: { fn: 'listOffers', args: [] }, noCsrf: true })).status, 403);
  assert.equal((await s.raw('POST', '/api/rpc', { body: { fn: 'listOffers', args: [] }, noOrigin: true })).status, 403);
  assert.equal((await s.raw('POST', '/api/rpc', { body: { fn: 'listOffers', args: [] }, headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await s.raw('POST', '/api/rpc', { body: 'fn=x', type: 'application/x-www-form-urlencoded' })).status, 415);
  assert.equal((await s.raw('POST', '/api/rpc', { body: '{not json', type: 'application/json' })).status, 400);
  assert.equal((await s.raw('POST', '/api/rpc', { body: { fn: 'listOffers', args: [] } })).status, 200);
});

test('logout ends the session on the server; the old cookie stops working; sign-in issues a new id', async () => {
  const c = await staff(app, 'LOGISTICS', 'logi123'), old = c.cookie; assert.equal((await c.raw('GET', '/api/state')).status, 200);
  assert.equal((await c.raw('POST', '/api/logout', { body: {} })).status, 200);
  const replay = new Client(app); replay.cookie = old; assert.equal((await replay.raw('GET', '/api/state')).status, 401);
  const f = new Client(app); await f.login('staff', 'LOGISTICS', 'logi123'); const first = f.cookie; await f.login('staff', 'LOGISTICS', 'logi123'); assert.notEqual(f.cookie, first, 'session id must change at every sign-in');
  const stale = new Client(app); stale.cookie = first; assert.equal((await stale.raw('GET', '/api/state')).status, 401, 'the previous session id must be gone');
});

test('lockout: 5 wrong passwords lock the account even for the right password; unknown accounts behave the same', async () => {
  for (const code of ['SALES2', 'GHOST777']) {
    const c = new Client(app); let last;
    for (let i = 0; i < 5; i++) last = await c.raw('POST', '/api/login', { body: { kind: 'staff', code, password: 'wrong' + i } }); assert.equal(last.status, 401);
    const locked = await c.raw('POST', '/api/login', { body: { kind: 'staff', code, password: code === 'SALES2' ? 'sales2123' : 'x' } });
    assert.equal(locked.status, 429, code); assert.equal(locked.json.error, 'locked'); assert.ok(locked.json.retryAfterSec > 800); assert.ok(locked.headers.get('retry-after'));
  }
  const acts = app.store.auditRows ? app.store.auditRows.map(a => a.action) : (await app.store.pool.query('SELECT action FROM portal_audit')).rows.map(x => x.action);
  assert.ok(acts.includes('login_failed') && acts.includes('login_locked'), 'failures and lockouts must be in the audit log');
});

test('brute force from one address is throttled', async () => {
  const a2 = await start({ memory: true, cfg: { ipLoginLimit: 8 } }); try { const c = new Client(a2); let s429 = 0; for (let i = 0; i < 14; i++) { const r = await c.raw('POST', '/api/login', { body: { kind: 'staff', code: 'USER' + i, password: 'x' } }); if (r.status === 429) s429++; } assert.ok(s429 >= 5, 'expected throttling, got ' + s429); } finally { await a2.close(); }
});

test('sessions expire when idle', async () => {
  const a2 = await start({ memory: true, cfg: { sessionIdleMs: 400 } }); try { const c = await staff(a2, 'FINANCE', 'fin123'); assert.equal((await c.raw('GET', '/api/state')).status, 200); await new Promise(r => setTimeout(r, 700)); assert.equal((await c.raw('GET', '/api/state')).status, 401); } finally { await a2.close(); }
});
