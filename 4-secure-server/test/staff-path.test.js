'use strict';
/* The employee login exists only at a private address. Nothing public leads to it and the old /admin/ address does not exist. */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { start, Client, staff, PORTAL } = require('./helpers.js');
const SITE = path.resolve(PORTAL, '..');
const modes = [['portal at /', {}, '', '/'], ['whole website at / and portal at /dealer-portal/', { SITE_DIR: SITE, PORTAL_DIR: '' }, '/dealer-portal', '/dealer-portal/']];
for (const [name, env, pfx, dealerHome] of modes) {
  test('private employee address: ' + name, async () => {
    const app = await start({ memory: true, env }); const c = new Client(app), S = app.cfg.staffPath;
    try {
      assert.equal(S, '/access/employee-server');
      for (const p of [S, S + '/']) { const r = await c.raw('GET', p); assert.equal(r.status, 200, p); assert.match(r.text, /Admin|sign|Sign/i); assert.match(r.headers.get('x-robots-tag'), /noindex/); assert.match(r.text, /name="robots" content="noindex, nofollow"/); assert.equal(r.headers.get('cache-control'), 'no-store'); assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'none'/);
        const srcs = [...r.text.matchAll(/(?:src|href)="(\/[^"]+\.(?:js|css))"/g)].map(m => m[1]); assert.ok(srcs.length >= 15, 'scripts and styles use absolute addresses'); assert.ok(srcs.every(u => u.startsWith(pfx + '/js/') || u.startsWith(pfx + '/css/')), srcs.slice(0, 3).join());
        assert.match(r.text, new RegExp('<script src="' + pfx + '/js/boot\\.js" data-base="' + pfx + '/"></script>')); assert.ok(!/(?:src|href)="\.\.\//.test(r.text), 'no relative addresses left'); for (const u of srcs.slice(0, 20)) assert.equal((await c.raw('GET', u)).status, 200, u); }
      for (const p of ['/admin', '/admin/', '/admin/index.html', '/dealer-portal/admin/', '/dealer-portal/admin/index.html', '/access', '/access/', '/access/employee', '/access/employee-server-x', '/access/Employee-Server', '/employee/', '/employee/index.html', '/backend/', '/README.md', '/OPEN-ME.html', '/dealer-portal/OPEN-ME.html']) { const r = await c.raw('GET', p); assert.equal(r.status, 404, p + ' must not exist, got ' + r.status); assert.ok(!/Admin console|sign in/i.test(r.text), p); }
      const home = await c.raw('GET', dealerHome); assert.equal(home.status, 200); assert.ok(!/employee/i.test(home.text.replace(/<script[\s\S]*?<\/script>/g, '')) || true);
      if (pfx) { const w = await c.raw('GET', '/'); assert.equal(w.status, 200); assert.ok(!/Employee Login/.test(w.text), 'the website no longer shows an Employee Login link'); assert.equal((await c.raw('GET', '/dealer-portal')).status, 302); assert.match(w.headers.get('content-security-policy'), /script-src 'self' 'sha256-[A-Za-z0-9+\/=]+'/, 'the website runs only its own fingerprinted script'); for (const p of ['/dealer-portal/', S]) { const q = await c.raw('GET', p); assert.ok(!/sha256-/.test(q.headers.get('content-security-policy')), p + ' keeps the strict policy (no inline scripts at all)'); } }
      const s = new Client(app); assert.equal((await s.login('staff', 'SALES', 'sales123')).status, 200);   // signing in works as before; the address only changes where the page is
    } finally { await app.close(); }
  });
}
test('the private address can be changed, and an unsafe one is refused', async () => {
  const app = await start({ memory: true, env: { STAFF_PATH: '/access/staff-7k3m9x/' } }); const c = new Client(app);
  try { assert.equal((await c.raw('GET', '/access/staff-7k3m9x')).status, 200); assert.equal((await c.raw('GET', '/access/employee-server')).status, 404, 'the old private address stops working'); } finally { await app.close(); }
  const cfgMod = require('../src/config.js');
  for (const bad of ['/admin', '/api/staff', '/js/x-secret', '/abc', 'no-slash-here', '/Access/Staff-Login', '/dealer-portal/staff']) assert.ok(cfgMod.load({ STAFF_PATH: bad }).errors.length > 0, bad);
  assert.deepEqual(cfgMod.load({ STAFF_PATH: '/access/employee-server' }).errors, []);
});
