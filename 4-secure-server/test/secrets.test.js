'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { start, Client, staff, dealer } = require('./helpers.js');
const cfgMod = require('../src/config.js');
const { createApp } = require('../src/server.js');
const SECRET = 'super-secret-script-key-9876', GOOD = 'https://script.google.com/macros/s/AKfycbTESTSCRIPT/exec';
const SID_SALES = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789', SID_FIN = '1ZyXwVuTsRqPoNmLkJiHgFeDcBa9876543210';
const hasSecret = t => t.includes(SECRET);

test('the Google script secret is write-only: never returned, never stored in clear, never reaches a browser', async () => {
  const app = await start({ memory: true }); const real = global.fetch, sent = [];
  global.fetch = (u, o) => String(u).startsWith('https://script.google.com') ? (sent.push({ u: String(u), body: JSON.parse(o.body) }), Promise.resolve(new Response('{"ok":true}', { status: 200 }))) : real(u, o);
  try {
    const h = await staff(app, 'ADMIN', 'admin123'), s = await staff(app, 'SALES', 'sales123'), d = await dealer(app, 'DEMO001', 'demo123');
    assert.equal((await s.raw('PUT', '/api/sheets/config', { body: { url: GOOD, secret: SECRET } })).status, 400, 'only the Host can connect Google');
    assert.equal((await d.raw('GET', '/api/sheets/config')).status, 403, 'dealers have no access to the Google settings');
    assert.equal((await h.raw('PUT', '/api/sheets/config', { body: { url: 'https://evil.example/exec', secret: SECRET } })).status, 400, 'only a Google script address is accepted');
    const put = await h.raw('PUT', '/api/sheets/config', { body: { url: GOOD, secret: SECRET, owner: 'accounts@s-eleven.com' } }); assert.equal(put.status, 200); assert.ok(!hasSecret(put.text));
    for (const c of [h, s]) { const g = await c.raw('GET', '/api/sheets/config'); assert.equal(g.status, 200); assert.equal(g.json.connected, true); assert.ok(!hasSecret(g.text), 'the secret must never be returned'); assert.ok(!/secret/i.test(Object.keys(g.json).join(',')), 'no secret field'); }
    const stored = await app.store.getSetting('sheets'); assert.ok(!hasSecret(stored), 'the secret must be encrypted at rest'); assert.match(stored, /"secretSealed":"v1\./);
    for (const c of [h, s, d]) { const all = JSON.stringify(c.state) + (await c.getState(0)).text + (await c.raw('GET', '/api/me')).text; assert.ok(!hasSecret(all)); }
    // the browser can send rows but cannot choose the target sheet or other people's workbooks
    assert.equal((await s.raw('PUT', '/api/sheets/glink', { body: { dept: 'finance', url: 'https://docs.google.com/spreadsheets/d/' + SID_FIN + '/edit' } })).status, 400, 'Sales cannot link the Finance sheet');
    assert.equal((await s.raw('PUT', '/api/sheets/glink', { body: { dept: 'sales', url: 'https://example.com/x' } })).status, 400);
    assert.equal((await s.raw('PUT', '/api/sheets/glink', { body: { dept: 'sales', url: 'https://docs.google.com/spreadsheets/d/' + SID_SALES + '/edit' } })).status, 200);
    assert.equal((await h.raw('PUT', '/api/sheets/glink', { body: { dept: 'finance', url: 'https://docs.google.com/spreadsheets/d/' + SID_FIN + '/edit' } })).status, 200);
    const cfgS = (await s.raw('GET', '/api/sheets/config')).json; assert.deepEqual(Object.keys(cfgS.glinks), ['sales'], 'a department sees only its own link'); assert.deepEqual(Object.keys((await h.raw('GET', '/api/sheets/config')).json.glinks).sort(), ['finance', 'sales']);
    const row = (book, dept, extra) => Object.assign({ book, dept, tab: 'Orders', key: 'K1', headers: ['Order ID'], row: ['K1', 5] }, extra || {});
    const r = await s.raw('POST', '/api/sheets/push', { body: { items: [row('Sales sheets', 'sales', { target: 'EVILTARGETSHEETID000000000' }), row('Finance sheets', 'finance'), row('My sheets: ADMIN', ''), row('My sheets: SALES', ''), row('Sales sheets', 'nonsense')] } });
    assert.equal(r.status, 200); assert.equal(r.json.accepted, 2, 'only Sales\u2019 own rows are accepted'); assert.ok(!hasSecret(r.text));
    await new Promise(r2 => setTimeout(r2, 300)); const items = sent.flatMap(x => x.body.items), call = sent[0];
    assert.ok(call && call.body.secret === SECRET && call.u === GOOD, 'the SERVER adds the secret when it forwards the rows');
    const salesRow = items.find(i => i.dept === 'sales'); assert.equal(salesRow.target, SID_SALES, 'the target comes from the server, not from the browser'); assert.ok(!items.some(i => i.target === 'EVILTARGETSHEETID000000000'));
    assert.equal(items.find(i => i.book === 'My sheets: SALES').target, ''); assert.ok(!items.some(i => i.dept === 'finance' || i.book === 'My sheets: ADMIN'));
    assert.equal((await d.raw('POST', '/api/sheets/push', { body: { items: [] } })).status, 403);
  } finally { global.fetch = real; await app.close(); }
});

test('production refuses an unsafe start', () => {
  const bad = cfgMod.load({ NODE_ENV: 'production', SEED_DEMO: '1', COOKIE_INSECURE_DEV: '1', DEMO_PAYMENTS: '1' }).errors; assert.ok(bad.length >= 5, bad.join('|'));
  const good = cfgMod.load({ NODE_ENV: 'production', DATABASE_URL: 'postgres://u:p@h/d', APP_SECRET_KEY: 'a'.repeat(64) }); assert.deepEqual(good.errors, []); assert.equal(good.seedDemo, false); assert.equal(good.demoPayments, false);
});
test('production first start needs a real Host password; a weak one is refused', async () => {
  const mk = over => cfgMod.load(Object.assign({ NODE_ENV: 'test', COOKIE_INSECURE_DEV: '1', PORT: '0', PORTAL_DIR: require('./helpers.js').PORTAL }, over));
  await assert.rejects(createApp(mk({})), /INITIAL_ADMIN_PASSWORD/); await assert.rejects(createApp(mk({ INITIAL_ADMIN_PASSWORD: 'admin123' })), /at least 10/);
  const app = await createApp(mk({ INITIAL_ADMIN_PASSWORD: 'My#Host2026pass' })); await new Promise(r => app.server.listen(0, '127.0.0.1', r)); app.base = 'http://127.0.0.1:' + app.server.address().port;
  try { assert.equal((await new Client(app).login('staff', 'ADMIN', 'admin123')).status, 401, 'the factory password must not work'); { const c = new Client(app), r = await c.raw('POST', '/api/login', { body: { kind: 'staff', code: 'ADMIN', password: 'My#Host2026pass' } }); assert.equal(r.status, 200); assert.equal(r.json.need2fa, 'enroll', 'a real install asks the Host for Google Authenticator right after the password'); assert.ok(!r.headers.get('set-cookie') && !r.json.me, 'and gives no session until the code is right'); } assert.equal((app.engine.get('dealers') || []).length, 0, 'a real installation starts empty: no demo dealers'); } finally { await app.close(); }
});

test('durable: with PostgreSQL, data, hashes and sessions survive a restart', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const pg = require('pg');
  let app = await start({}); const h = await staff(app, 'ADMIN', 'admin123'); await h.rpc('savePost', [{ title: 'Survives restart', text: 'x', tag: 'News' }, 'x']); await h.rpc('resetDealerPassword', ['DEMO002', 'Restart#Pass2026', 'x', 'x']); const cookie = h.cookie, csrf = h.csrf;
  await app.close(); app = await start({ keep: true });
  try {
    const again = new Client(app); again.cookie = cookie; again.csrf = csrf; const st = await again.raw('GET', '/api/state'); assert.equal(st.status, 200, 'the session survives a restart'); assert.ok(/Survives restart/.test(st.text), 'data survives');
    assert.equal((await new Client(app).login('dealer', 'DEMO002', 'Restart#Pass2026')).status, 200, 'hashes survive'); assert.equal((await new Client(app).login('dealer', 'DEMO002', 'demo456')).status, 401);
    const c = new Pool(); function Pool() { return new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL }); } const q = await c.query("SELECT count(*)::int AS n FROM portal_kv WHERE v LIKE '%demo123%' OR v LIKE '%admin123%'"); assert.equal(q.rows[0].n, 0, 'no plain password in the database'); const a = await c.query("SELECT count(*)::int AS n FROM portal_audit WHERE action IN ('login','op')"); assert.ok(a.rows[0].n >= 2, 'actions are in the audit log'); await c.end();
  } finally { await app.close(); }
});
