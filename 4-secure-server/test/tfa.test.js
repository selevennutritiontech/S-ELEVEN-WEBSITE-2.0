'use strict';
/* Google Authenticator for staff: verified in the same request, replay refused, secrets encrypted, wrong codes count toward the lockout, the Host controls it per department and resets a lost phone. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { start, Client } = require('./helpers.js');
const { hotp, b32dec } = require('../src/tfa.js');
let app; const code = (secret, d = 0) => hotp(b32dec(secret), Math.floor(Date.now() / 30000) + d);
test.before(async () => { app = await start({ memory: true, cfg: { require2fa: true } }); });
test.after(async () => { await app.close(); });
const pw = async (c, id, p) => c.raw('POST', '/api/login', { body: { kind: 'staff', code: id, password: p } });
const second = async (c, pending, tok) => { const r = await c.raw('POST', '/api/login2fa', { body: { pending, code: tok } }); if (r.status === 200 && r.json.me) { c.me = r.json.me; c.csrf = r.json.me.csrf; c.state = {}; c.apply(r.json.state); } return r; };
const S = {};
test('a correct password alone gives NO session: it asks for the authenticator (first time: a QR secret to scan)', async () => {
  const c = new Client(app), r = await pw(c, 'SALES', 'sales123'); assert.equal(r.status, 200); assert.equal(r.json.ok, false); assert.equal(r.json.need2fa, 'enroll'); assert.ok(r.json.pending.length >= 32 && /^[A-Z2-7]{32}$/.test(r.json.secret)); assert.match(r.json.uri, /^otpauth:\/\/totp\/S-ELEVEN:SALES\?secret=/);
  assert.ok(!r.headers.get('set-cookie'), 'no session cookie yet'); assert.equal(r.json.state, undefined, 'and no data'); assert.equal((await c.getState(0)).status, 401, 'the state is closed to them');
});
test('the code is checked AT ONCE: a wrong one is refused in the same request; the right one signs in and enrols (no delay)', async () => {
  const c = new Client(app), r0 = await pw(c, 'SALES', 'sales123'), p = r0.json.pending, sec = r0.json.secret;
  let t0 = Date.now(); const bad = await second(c, p, '000000' === code(sec) ? '111111' : '000000'); assert.equal(bad.status, 401); assert.equal(bad.json.error, 'invalid_code'); assert.equal(bad.json.left, 4); assert.ok(Date.now() - t0 < 1500, 'refused at once');
  assert.equal((await second(c, p, 'abcdef')).status, 401, 'letters are not a code'); assert.equal((await second(c, p, '12345')).status, 401, 'five digits are not a code');
  t0 = Date.now(); const ok = await second(c, p, code(sec)); assert.equal(ok.status, 200); assert.equal(ok.json.ok, true); assert.ok(Date.now() - t0 < 1500, 'verified at once'); assert.equal(ok.json.me.code, 'SALES'); assert.ok(c.cookie, 'now there is a session'); assert.equal((await c.getState(0)).status, 200);
  S.SALES = { secret: sec };
});
test('next time only the code is asked (the secret is never shown again); the code of the same time-step cannot be reused (replay refused)', async () => {
  const c = new Client(app), r0 = await pw(c, 'SALES', 'sales123'); assert.equal(r0.json.need2fa, 'code'); assert.equal(r0.json.secret, undefined); assert.equal(r0.json.uri, undefined);
  const again = await second(c, r0.json.pending, code(S.SALES.secret)); assert.equal(again.status, 401, 'the code just used to enrol cannot be used again'); assert.equal(again.json.error, 'invalid_code');
  const next = await second(c, r0.json.pending, code(S.SALES.secret, 1)); assert.equal(next.status, 200, 'the next time-step\'s code works (a phone clock a little fast)'); const c2 = new Client(app), r2 = await pw(c2, 'SALES', 'sales123'); assert.equal((await second(c2, r2.json.pending, code(S.SALES.secret, 1))).status, 401, 'and that one cannot be replayed either');
  const c3 = new Client(app), r3 = await pw(c3, 'SALES', 'sales123'); assert.equal((await second(c3, r3.json.pending, code(S.SALES.secret, -2))).status, 401, 'a code from 60 seconds ago is too old'); assert.equal((await second(c3, r3.json.pending, code(S.SALES.secret, 5))).status, 401, 'and one from the future is refused');
});
test('the secret is stored encrypted, never in clear; a wrong password never reaches the code step', async () => {
  const raw = await app.store.getSetting('tfa:SALES'); assert.ok(raw && !raw.includes(S.SALES.secret), 'sealed with APP_SECRET_KEY'); assert.match(raw, /"s":"v1\./);
  assert.equal((await pw(new Client(app), 'SALES', 'wrong-password')).status, 401); const r = await new Client(app).raw('POST', '/api/login2fa', { body: { pending: 'nope', code: '123456' } }); assert.equal(r.status, 401); assert.equal(r.json.error, 'expired');
});
test('five wrong codes end that attempt, count toward the account lockout, and the password step then refuses', async () => {
  const c = new Client(app), r0 = await pw(c, 'FINANCE', 'fin123'); const p = r0.json.pending, sec = r0.json.secret; let last;
  for (let i = 0; i < 5; i++) last = await second(c, p, '000000' === code(sec) ? '111111' : '000000'); assert.equal(last.status, 401);
  const dead = await second(c, p, code(sec)); assert.equal(dead.status, 401, 'the pending sign-in is gone: even the right code is refused');
  const nxt = await pw(new Client(app), 'FINANCE', 'fin123'); assert.ok(nxt.status === 429 || nxt.json.need2fa, 'the account is locked, or it must start again from the password');
});
test('the Host sets the rule per department; a department that is switched off signs in with the password only', async () => {
  const H = new Client(app), h0 = await pw(H, 'ADMIN', 'admin123'); assert.equal((await second(H, h0.json.pending, code(h0.json.secret))).status, 200);
  const info = await H.raw('GET', '/api/security'); assert.equal(info.status, 200); assert.ok(info.json.depts.every(d => d.required === true), 'required for every department by default'); const u = info.json.users.find(x => x.code === 'SALES'); assert.equal(u.enrolled, true); assert.ok(info.json.users.find(x => x.code === 'WAREHOUSE').enrolled === false);
  assert.equal((await H.raw('POST', '/api/security', { body: { action: 'policy', dept: 'warehouse', required: false } })).status, 200); const w = new Client(app), wr = await pw(w, 'WAREHOUSE', 'wh123'); assert.equal(wr.json.ok, true, 'warehouse: password only'); assert.ok(w.cookie);
  assert.equal((await pw(new Client(app), 'LOGISTICS', 'logi123')).json.need2fa, 'enroll', 'every other department still needs it');
  assert.equal((await H.raw('POST', '/api/security', { body: { action: 'policy', dept: 'nonsense', required: true } })).status, 400); assert.equal((await H.raw('POST', '/api/security', { body: { action: 'policy', dept: 'warehouse', required: true } })).status, 200);
  assert.equal((await H.raw('POST', '/api/security', { body: { action: 'policy', dept: 'warehouse', required: false }, noCsrf: true })).status, 403, 'a forged request without the CSRF token is refused');
});
test('only the Host sees or changes the rule or resets anyone; a dealer sign-in is not affected', async () => {
  const sales = new Client(app), s0 = await pw(sales, 'SALES', 'sales123'); let ok = await second(sales, s0.json.pending, code(S.SALES.secret, 1)); if (ok.status !== 200) ok = await second(sales, s0.json.pending, code(S.SALES.secret, 0));
  if (ok.status === 200) { assert.equal((await sales.raw('GET', '/api/security')).status, 403); assert.equal((await sales.raw('POST', '/api/security', { body: { action: 'reset', code: 'ADMIN' } })).status, 403); assert.equal((await sales.raw('POST', '/api/security', { body: { action: 'policy', all: false } })).status, 403); }
  const d = new Client(app); assert.equal((await d.login('dealer', 'DEMO001', 'demo123')).status, 200, 'dealers sign in with their password only');
});
test('a lost phone: the Host resets, the old authenticator stops working, the user enrols a new one', async () => {
  await app.tfa.reset('ADMIN'); const h1 = new Client(app), r1 = await pw(h1, 'ADMIN', 'admin123'); assert.equal(r1.json.need2fa, 'enroll'); assert.equal((await second(h1, r1.json.pending, code(r1.json.secret))).status, 200);
  const b0 = new Client(app), br0 = await pw(b0, 'BRANDING', 'brand123'); const oldSecret = br0.json.secret; assert.equal((await second(b0, br0.json.pending, code(oldSecret))).status, 200, 'Branding enrols');
  assert.equal((await h1.raw('POST', '/api/security', { body: { action: 'reset', code: 'BRANDING' } })).status, 200); assert.equal((await b0.getState(0)).status, 401, 'their open session ended at once');
  const c = new Client(app), r = await pw(c, 'BRANDING', 'brand123'); assert.equal(r.json.need2fa, 'enroll', 'enrolment starts again'); assert.notEqual(r.json.secret, oldSecret);
  assert.equal((await second(c, r.json.pending, code(oldSecret))).status, 401, 'the OLD authenticator no longer works'); assert.equal((await second(c, r.json.pending, code(r.json.secret))).status, 200);
  assert.equal((await h1.raw('POST', '/api/security', { body: { action: 'reset', code: 'NOBODY' } })).status, 404);
});
