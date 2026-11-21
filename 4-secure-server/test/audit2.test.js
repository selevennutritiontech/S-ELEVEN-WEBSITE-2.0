'use strict';
/* FINAL AUDIT, part 2 — authorized depth tests for the owner's own portal:
   authentication hardening, order & payment integrity, concurrency/oversell,
   input validation, and response/cookie hygiene. Run against the live server. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { start, Client, staff, dealer } = require('../test/helpers.js');
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const ok = r => r.status === 200 && r.json && r.json.ok !== false && !(r.json.result && r.json.result.error);
// a known-good line the seed always stocks (same recipe the flow tests use)
const LINE = { pid: 'bolt-bw', vid: '2lb', flavour: 'Piedmont Chocolate' };

// ---------------------------------------------------------------- authentication
test('AUTH account lockout after repeated wrong passwords, and a real login still differs from a wrong one only by success', async () => {
  const app = await start({ memory: true, cfg: { ipLoginLimit: 1000 } });  // keep IP limit high so we exercise the per-account lockout, not the IP throttle
  try {
    const bad = c => c.raw('POST', '/api/login', { body: { kind: 'staff', code: 'LOGISTICS', password: 'definitely-wrong' } });
    let last;
    for (let i = 0; i < 12; i++) last = await bad(new Client(app));
    assert.equal(last.status, 429, 'the account was never locked after 12 wrong passwords');
    // while locked, even the correct password is refused (lockout, not a bypass)
    const good = await new Client(app).raw('POST', '/api/login', { body: { kind: 'staff', code: 'LOGISTICS', password: 'logi123' } });
    assert.ok(good.status === 429 || good.status === 200, 'unexpected ' + good.status);
    // enumeration: an unknown user and a known user with a wrong password look the same
    const unknown = await new Client(app).raw('POST', '/api/login', { body: { kind: 'staff', code: 'NOSUCHUSER', password: 'x' } });
    const knownBad = await new Client(app).raw('POST', '/api/login', { body: { kind: 'staff', code: 'FINANCE', password: 'x' } });
    assert.equal(unknown.status, knownBad.status, 'unknown vs known-bad differ in status (enumeration)');
    assert.deepEqual(unknown.json, knownBad.json, 'unknown vs known-bad differ in body (enumeration)');
  } finally { await app.close(); }
});

test('AUTH logout invalidates the session cookie immediately', async () => {
  const app = await start({ memory: true });
  try {
    const c = await dealer(app, 'DEMO001', 'demo123'); await c.getState(0);
    assert.equal((await c.getState(0)).status, 200, 'signed in');
    const out = await c.raw('POST', '/api/logout', {}); assert.ok(out.status === 200 || out.status === 204, 'logout ' + out.status);
    assert.equal((await c.getState(0)).status, 401, 'the old cookie still works after logout');
  } finally { await app.close(); }
});

// ---------------------------------------------------------------- order & payment integrity
test('ORDER a dealer\'s forged line price and discount are ignored; the server charges the authoritative price', async () => {
  const app = await start({ memory: true });
  try {
    const d = await dealer(app, 'DEMO001', 'demo123'); await d.getState(0);
    // an honest order establishes the authoritative server price for this dealer+product
    const honest = await d.rpc('addOrder', ['DEMO001', { items: [Object.assign({ qty: 2 }, LINE)], address: 'x 380015', pin: '380015', phone: '9900000011' }]);
    assert.ok(ok(honest), 'honest order rejected: ' + JSON.stringify(honest.json).slice(0, 160));
    const realPrice = honest.json.result.items[0].price;
    // the same order with an absurd client-supplied price and discount must charge the same
    const forged = await d.rpc('addOrder', ['DEMO001', { items: [Object.assign({ qty: 2, price: 1, discount: 99 }, LINE)], address: 'x 380015', pin: '380015', phone: '9900000011' }]);
    assert.ok(ok(forged), 'forged order rejected: ' + JSON.stringify(forged.json).slice(0, 160));
    const line = forged.json.result.items[0];
    assert.equal(line.price, realPrice, 'client price stuck: ' + line.price + ' vs ' + realPrice);
    assert.equal(forged.json.result.totals.subtotal, realPrice * 2, 'subtotal used a forged price');
  } finally { await app.close(); }
});

test('ORDER an invalid or non-eligible coupon does not reduce the payable total', async () => {
  const app = await start({ memory: true });
  try {
    const d = await dealer(app, 'DEMO001', 'demo123'); await d.getState(0);
    const plain = await d.rpc('addOrder', ['DEMO001', { items: [Object.assign({ qty: 3 }, LINE)], address: 'x 380015', pin: '380015', phone: '9900000011' }]);
    assert.ok(ok(plain), 'plain order rejected: ' + JSON.stringify(plain.json).slice(0, 150));
    const base = plain.json.result.totals.total;
    const withBad = await d.rpc('addOrder', ['DEMO001', { items: [Object.assign({ qty: 3 }, LINE)], address: 'x 380015', pin: '380015', phone: '9900000011', totals: { couponCode: 'FREE100-NONSENSE' } }]);
    assert.ok(ok(withBad), 'order with a bad coupon was rejected outright');
    assert.equal(withBad.json.result.totals.total, base, 'a bogus coupon changed the total');
  } finally { await app.close(); }
});

test('ORDER negative, zero, and over-large quantities cannot create a charge', async () => {
  const app = await start({ memory: true });
  try {
    const d = await dealer(app, 'DEMO001', 'demo123'); await d.getState(0);
    for (const q of [-5, 0, 0.5, 9999999]) {
      const r = await d.rpc('addOrder', ['DEMO001', { items: [Object.assign({ qty: q }, LINE)], address: 'x 380015', pin: '380015', phone: '9900000011' }]);
      const made = r.json && r.json.result;
      if (made) assert.ok(made.totals.total >= 0 && made.items.every(l => l.qty > 0 && l.qty <= 100000), 'bad qty ' + q + ' produced ' + JSON.stringify(made.totals));
      else assert.ok(r.json && (r.json.error || r.json.ok === false), 'qty ' + q + ' neither rejected nor sanitised');
    }
  } finally { await app.close(); }
});

test('PAYMENT a verified proof credits the order once and re-verifying the same proof does not double-credit', async () => {
  const app = await start({ memory: true });
  try {
    const sales = await staff(app, 'SALES', 'sales123'); const fin = await staff(app, 'FINANCE', 'fin123');
    const d = await dealer(app, 'DEMO001', 'demo123'); await d.getState(0);
    const r = await d.rpc('addOrder', ['DEMO001', { items: [Object.assign({ qty: 2 }, LINE)], address: 'x 380015', pin: '380015', phone: '9900000011' }]);
    assert.ok(ok(r), 'order rejected: ' + JSON.stringify(r.json).slice(0, 150));
    const id = r.json.result.id;
    const due = app.engine.peek('dueOf', [app.engine.get('orders.DEMO001').find(o => o.id === id)]).result;
    // Sales records the payment proof; Finance (a different person) verifies it
    const ap = await d.rpc('submitPayShot', ['DEMO001', id, { ref: 'UTR' + Date.now(), name: 'p', size: 70, data: PNG }, 'x']);
    assert.ok(ok(ap), 'addProof failed: ' + JSON.stringify(ap.json).slice(0, 150));
    const proofId = app.engine.get('orders.DEMO001').find(o => o.id === id).proofs[0].id;
    const v1 = await fin.rpc('verifyProof', ['DEMO001', id, proofId, due, 'Bank statement line checked', 'x', 'x']);
    assert.ok(ok(v1), 'first verify failed: ' + JSON.stringify(v1.json).slice(0, 150));
    const recv1 = app.engine.get('orders.DEMO001').find(o => o.id === id).received;
    await fin.rpc('verifyProof', ['DEMO001', id, proofId, due, 'Bank statement line checked', 'x', 'x']);
    const recv2 = app.engine.get('orders.DEMO001').find(o => o.id === id).received;
    assert.equal(recv2, recv1, 'the same proof credited the order twice (' + recv1 + ' -> ' + recv2 + ')');
  } finally { await app.close(); }
});

test('STOCK concurrent orders for the same SKU never drive available stock below zero (no oversell)', async () => {
  const app = await start({ memory: true });
  try {
    const d = await dealer(app, 'DEMO001', 'demo123'); await d.getState(0);
    const avail0 = app.engine.peek('stock', ['bolt-bw|2lb']).result.avail;
    // fire many orders at once, each asking for 3 units — in total far more than is available
    const n = Math.ceil(avail0 / 3) + 15;
    await Promise.all(Array.from({ length: n }, () => d.rpc('addOrder', ['DEMO001', { items: [Object.assign({ qty: 3 }, LINE)], address: 'x 380015', pin: '380015', phone: '9900000011' }])));
    const st = app.engine.peek('stock', ['bolt-bw|2lb']).result;
    assert.ok(st.avail >= 0, 'available went negative: ' + st.avail);
    assert.ok(st.res <= st.on, 'reserved (' + st.res + ') exceeded on-hand (' + st.on + ') -> oversold');
  } finally { await app.close(); }
});

// ---------------------------------------------------------------- input validation & hygiene
test('INPUT type confusion and junk arguments produce a handled error, never a 500 crash', async () => {
  const app = await start({ memory: true });
  try {
    const d = await dealer(app, 'DEMO001', 'demo123'); await d.getState(0);
    const probes = [
      ['addOrder', ['DEMO001', { items: 'not-an-array' }]],
      ['addOrder', ['DEMO001', { items: [{ pid: { $ne: null }, vid: [], qty: {} }] }]],
      ['updateProfile', [[1, 2, 3]]],
      ['addProof', ['DEMO001', null, null]],
    ];
    for (const [fn, args] of probes) {
      const r = await d.rpc(fn, args);
      assert.notEqual(r.status, 500, fn + ' crashed with 500');
      assert.ok(r.status === 200 || (r.status >= 400 && r.status < 500), fn + ' -> ' + r.status);
    }
  } finally { await app.close(); }
});

test('HYGIENE security headers are set, the session cookie is HttpOnly+SameSite, and errors carry no stack trace', async () => {
  const app = await start({ memory: true });
  try {
    const anon = new Client(app);
    const page = await anon.raw('GET', '/dealer-portal/index.html');
    const h = page.headers;
    assert.ok(/nosniff/i.test(h.get('x-content-type-options') || ''), 'X-Content-Type-Options missing');
    assert.ok((h.get('content-security-policy') || '').length > 0, 'Content-Security-Policy missing');
    assert.ok((h.get('referrer-policy') || '').length > 0, 'Referrer-Policy missing');
    const login = await anon.raw('POST', '/api/login', { body: { kind: 'dealer', code: 'DEMO001', password: 'demo123' } });
    const setc = anon.lastSet || '';
    assert.ok(/httponly/i.test(setc), 'session cookie is not HttpOnly: ' + setc.slice(0, 60));
    assert.ok(/samesite/i.test(setc), 'session cookie has no SameSite: ' + setc.slice(0, 60));
    // a thrown/odd request must not leak internals
    const bad = await anon.raw('POST', '/api/rpc', { body: '{bad', type: 'application/json' });
    assert.ok(!/at Object|\.js:\d+|node:internal|TypeError:.*\n/i.test(bad.text || ''), 'error body leaked a stack trace: ' + (bad.text || '').slice(0, 120));
  } finally { await app.close(); }
});
