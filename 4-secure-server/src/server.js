'use strict';
/* S-ELEVEN secure portal server.
   - Passwords are hashed (scrypt); sign-in is rate-limited and locks after repeated failures.
   - The signed-in person is identified by an HttpOnly session cookie; the browser can never claim an identity or a role.
   - Every operation is checked on the server (acl.js) and runs as the signed-in person.
   - Each person receives only the data they may see (scope.js). Nobody receives a password.
   - Security headers are set on every response. */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cfgMod = require('./config.js');
const { make } = require('./store.js');
const { Engine, PFX } = require('./engine.js');
const { Auth, hashPassword, passwordProblem } = require('./auth.js');
const { snapshot } = require('./scope.js');
const { Acl } = require('./acl.js');
const { Tfa } = require('./tfa.js');
const { Sheets } = require('./sheets.js');
const { SheetSync } = require('./sheetsync.js');

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.pdf': 'application/pdf' };
const WEAK_DEMO = new Set(['demo123', 'demo456', 'demo789']);

function securityHeaders(prod) {
  const h = {
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; frame-src https://docs.google.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'" + (prod ? '; upgrade-insecure-requests' : ''),
    'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
    'Cross-Origin-Opener-Policy': 'same-origin-allow-popups', 'Cross-Origin-Resource-Policy': 'same-origin', 'X-Permitted-Cross-Domain-Policies': 'none', 'X-Sel-Server': '1',
  };
  if (prod) h['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
  return h;
}

async function createApp(cfg) {
  if (cfg.errors && cfg.errors.length) throw new Error('Unsafe configuration:\n - ' + cfg.errors.join('\n - '));
  const store = make(cfg); await store.init();
  const { kv, gv } = await store.loadKV();
  const engine = new Engine(cfg.portalDir, kv, gv);
  const auth = new Auth(cfg, store); await auth.init();
  const acl = new Acl(cfg, engine);
  const sheets = new Sheets(cfg, store); await sheets.load();
  const sheetSync = new SheetSync(cfg, engine, sheets);
  const tfa = new Tfa(store, cfg), pending = new Map();   // pending: password accepted, Google Authenticator code awaited
  for (const c of (cfg.reset2faFor || [])) { await tfa.reset(c); await store.audit('system', 'tfa_reset_at_start', { code: c }); }
  engine.aliasId = id => 'S' + require('node:crypto').createHmac('sha256', String(cfg.appSecretKey || 'k')).update(String(id)).digest('hex').slice(0, 8);   // opaque stand-in for a staff user ID in what dealers receive
  const COOKIE = cfg.prod || !cfg.cookieInsecureDev ? '__Host-sel' : 'sel_sid';
  const HDR = securityHeaders(cfg.prod);

  /* ---- one change at a time: run, check passwords, save, then apply ---- */
  let chain = Promise.resolve();
  const exclusive = fn => { const p = chain.then(fn, fn); chain = p.catch(() => {}); return p; };
  async function commitCall(fn, args, { policy = true, preset, fieldGuard = false } = {}) {
    return exclusive(async () => {
      const r = engine.call(fn, args, { preset }); if (r.error) return { error: r.error };
      if (fieldGuard && r.changes && (r.changes.size || r.changes.length)) return { error: 'A Field Sales Consultant can create, but cannot change or delete.', denied: true, fn };   // default-deny: nothing is stored
      const secrets = engine.extractSecrets(r.changes);
      if (policy) for (const s of secrets) { const p = passwordProblem(s.plain); if (p) return { error: p }; }
      const credRows = []; for (const s of secrets) credRows.push({ id: auth.credId(s.kind, s.code), hash: await hashPassword(s.plain) });
      const prep = engine.prepare(r.changes);
      if (prep.rows.length || credRows.length) await store.commit({ kv: prep.rows, creds: credRows, gv: prep.gv });
      engine.apply(prep.rows, prep.gv); for (const c of credRows) auth.creds.set(c.id, c.hash);
      return { result: r.result, changed: prep.rows.length };
    });
  }
  /* ---- first start: seed, migrate, and move any plain password into the hashed vault ---- */
  async function boot() {
    const first = !engine.state.has(PFX + 'employees');
    if (first) {
      if (cfg.seedDemo) await commitCall('listDealers', [], { policy: false, preset: { [PFX + 'keepdemo']: '1' } });
      else {
        if (!cfg.initialAdminPassword) throw new Error('First start: set INITIAL_ADMIN_PASSWORD (at least 10 characters) so the Host account has its own password.');
        if (!cfg.seedDemo) { const p = passwordProblem(cfg.initialAdminPassword); if (p) throw new Error('INITIAL_ADMIN_PASSWORD: ' + p); }   // demo mode uses short well-known passwords
        /* work out which "already seeded" markers a fully set-up system has, then start from zero WITH those markers so no demo data is ever re-created */
        const keepList = (/KEEP_KEYS = \[([^\]]*)\]/.exec(fs.readFileSync(path.join(cfg.portalDir, 'js', 'db.js'), 'utf8')) || [, ''])[1].match(/'([^']+)'/g).map(x => x.slice(1, -1));
        const probe = engine.call('listDealers', [], { preset: { [PFX + 'keepdemo']: '1' } }); if (probe.error) throw new Error(probe.error);
        const flags = {}; for (const [k, v] of probe.changes) if (k.startsWith(PFX) && keepList.includes(k.slice(PFX.length)) && v !== null && !/(busy|epoch|keepdemo)$/.test(k)) flags[k] = v;
        const r = await commitCall('eraseAll', [], { policy: false, preset: flags }); if (r.error) throw new Error(r.error);
        await exclusive(async () => { const emps = engine.get('employees') || []; const a = emps.find(e => e.id === 'ADMIN'); if (a && !cfg.seedDemo) a.password = cfg.initialAdminPassword; const ch = new Map([[PFX + 'employees', JSON.stringify(emps)]]); const sec = engine.extractSecrets(ch); const rows = [];
          for (const s of sec) rows.push({ id: auth.credId(s.kind, s.code), hash: await hashPassword(s.plain) }); const prep = engine.prepare(ch); await store.commit({ kv: prep.rows, creds: rows, gv: prep.gv }); engine.apply(prep.rows, prep.gv); for (const c of rows) auth.creds.set(c.id, c.hash); });
      }
    } else await commitCall('listDealers', [], { policy: false });          // runs any pending data migrations
    await exclusive(async () => { const ch = new Map(), sec = engine.extractSecrets(ch, true); if (!sec.length && !ch.size) return; const rows = []; for (const s of sec) rows.push({ id: auth.credId(s.kind, s.code), hash: await hashPassword(s.plain) }); const prep = engine.prepare(ch); await store.commit({ kv: prep.rows, creds: rows, gv: prep.gv }); engine.apply(prep.rows, prep.gv); for (const c of rows) auth.creds.set(c.id, c.hash); });
    await commitCall('stageEvents', [], { policy: false });
    if (first && !cfg.seedDemo) { const emps = engine.get('employees') || [], ds = engine.get('dealers') || []; if (emps.length !== 1 || emps[0].id !== 'ADMIN' || ds.length) throw new Error('A clean first start must contain only the Host account. Found ' + emps.length + ' employees and ' + ds.length + ' dealers: refusing to continue.'); }
  }
  await boot();

  /* ---- helpers ---- */
  const realIp = req => { if (cfg.trustProxy) { const x = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim(); if (x) return x; } return req.socket.remoteAddress || ''; };
  const parseCookies = req => { const o = {}; String(req.headers.cookie || '').split(';').forEach(p => { const i = p.indexOf('='); if (i > 0) o[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); }); return o; };
  const setCookie = (res, token, maxAge) => { const a = [COOKIE + '=' + encodeURIComponent(token), 'Path=/', 'HttpOnly', 'SameSite=Strict']; if (!(cfg.cookieInsecureDev && !cfg.prod)) a.push('Secure'); if (maxAge !== undefined) a.push('Max-Age=' + maxAge); res.setHeader('Set-Cookie', a.join('; ')); };
  function send(res, status, body, extra) { const buf = Buffer.from(JSON.stringify(body)); res.writeHead(status, Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': buf.length, 'Cache-Control': 'no-store' }, HDR, extra || {})); res.end(buf); }
  function originOk(req) { const o = req.headers.origin || (req.headers.referer ? new URL(req.headers.referer).origin : ''); if (!o) return false; try { const u = new URL(o), host = (cfg.trustProxy && req.headers['x-forwarded-host']) || req.headers.host; return u.host === host || cfg.allowedOrigins.includes(u.origin); } catch (e) { return false; } }
  function readBody(req, max) { return new Promise((resolve, reject) => { let n = 0; const parts = []; req.on('data', c => { n += c.length; if (n > max) { reject(Object.assign(new Error('too large'), { status: 413 })); req.destroy(); } else parts.push(c); }); req.on('end', () => resolve(Buffer.concat(parts).toString('utf8'))); req.on('error', reject); }); }
  async function jsonBody(req, allowText) { const ct = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase(); if (ct !== 'application/json' && !(allowText && ct === 'text/plain')) throw Object.assign(new Error('bad type'), { status: 415 }); const t = await readBody(req, cfg.maxBodyBytes); try { const v = JSON.parse(t || '{}'); if (!v || typeof v !== 'object' || Array.isArray(v)) throw 0; return v; } catch (e) { throw Object.assign(new Error('bad json'), { status: 400 }); } }
  const sessionOf = req => auth.lookup(parseCookies(req)[COOKIE]);
  const who = s => ({ kind: s.kind, code: s.code, role: s.role, dept: s.dept, name: s.name });
  const audit = (s, action, detail) => store.audit(s ? s.kind + ':' + s.code : null, action, detail);

  /* ---- sign in ---- */
  async function login(req, res, body) {
    const ip = realIp(req), kind = body.kind === 'dealer' ? 'dealer' : 'staff', code = String(body.code || '').trim().toUpperCase().slice(0, 40), pw = String(body.password == null ? '' : body.password).slice(0, 200);
    if (!auth.hit(auth.ipHits, 'login:' + ip, cfg.ipLoginLimit, cfg.ipLoginWindowMs)) { await store.audit(null, 'login_ip_limited', { ip }); return send(res, 429, { error: 'toomany', retryAfterSec: 600 }, { 'Retry-After': '600' }); }
    if (!code || !pw) return send(res, 401, { error: 'invalid' });
    const lk = await auth.lockState(kind, code);
    if (lk.locked) { await store.audit(kind + ':' + code, 'login_locked', { ip }); return send(res, 429, { error: 'locked', retryAfterSec: lk.retryAfterSec }, { 'Retry-After': String(lk.retryAfterSec) }); }
    const ok = await auth.check(kind, code, pw);
    if (!ok) { const a = await auth.recordFail(kind, code); await store.audit(kind + ':' + code, 'login_failed', { ip, fails: a.fails }); return send(res, 401, { error: 'invalid' }); }
    let ident = null;
    if (kind === 'dealer') { const d = (engine.get('dealers') || []).find(x => x.code === code); if (!d) return send(res, 401, { error: 'invalid' }); if (d.active === false) { await store.audit('dealer:' + code, 'login_inactive', { ip }); return send(res, 403, { error: 'inactive' }); } ident = { kind: 'dealer', code, role: 'dealer', dept: '', name: d.name }; }
    else { const e = (engine.get('employees') || []).find(x => x.id === code && x.status === 'active'); if (!e) return send(res, 401, { error: 'invalid' }); ident = { kind: 'staff', code: e.id, role: engine.ROLE_OF[e.dept], dept: e.dept, name: e.name }; }
    if (ident.kind === 'staff' && await tfa.required(ident.dept)) {   // password accepted: now the code from Google Authenticator (the failure counter is NOT reset yet)
      const trec = await tfa.rec(ident.code), ptoken = require('node:crypto').randomBytes(24).toString('hex'), enroll = trec ? null : tfa.newSecret();
      for (const [k, v] of pending) if (v.exp < Date.now()) pending.delete(k);
      pending.set(ptoken, { ident, ip, exp: Date.now() + 300000, tries: 0, enroll }); await store.audit(kind + ':' + code, enroll ? 'tfa_enroll_started' : 'tfa_requested', { ip });
      return send(res, 200, { ok: false, need2fa: enroll ? 'enroll' : 'code', pending: ptoken, name: ident.name, secret: enroll || undefined, uri: enroll ? tfa.uri(ident.code, enroll) : undefined });
    }
    return finishLogin(req, res, ident, ip, kind, code);
  }
  async function finishLogin(req, res, ident, ip, kind, code) {
    await auth.recordSuccess(kind, code);
    const old = parseCookies(req)[COOKIE]; if (old) await auth.destroy(old);                    // a new session id on every sign-in (no fixation)
    const { token, rec } = await auth.createSession(ident, ip, req.headers['user-agent']);
    if (ident.kind === 'staff') await commitCall('portalLogin', [ident.code], { policy: false });
    await audit(rec, 'login', { ip }); setCookie(res, token);
    return send(res, 200, { ok: true, me: Object.assign(who(rec), { csrf: rec.csrf }), state: snapshot(engine, rec, 0) });
  }
  /* the second step: checked at once, in this request */
  async function login2fa(req, res, body) {
    const ip = realIp(req), pt = String(body.pending || ''), p = pending.get(pt);
    if (!auth.hit(auth.ipHits, 'login:' + ip, cfg.ipLoginLimit, cfg.ipLoginWindowMs)) return send(res, 429, { error: 'toomany', retryAfterSec: 600 }, { 'Retry-After': '600' });
    if (!p || p.exp < Date.now()) { pending.delete(pt); return send(res, 401, { error: 'expired' }); }
    const kind = 'staff', code = p.ident.code, lk = await auth.lockState(kind, code); if (lk.locked) { pending.delete(pt); return send(res, 429, { error: 'locked', retryAfterSec: lk.retryAfterSec }, { 'Retry-After': String(lk.retryAfterSec) }); }
    const trec = p.enroll ? null : await tfa.rec(code), b32 = p.enroll || (trec && trec.b32), hit = b32 ? tfa.check(b32, body.code, trec ? trec.last : 0) : null;
    if (hit === null) { p.tries++; const a = await auth.recordFail(kind, code); await store.audit(kind + ':' + code, 'tfa_failed', { ip, tries: p.tries }); if (p.tries >= 5 || a.locked) pending.delete(pt); return send(res, 401, { error: 'invalid_code', left: Math.max(0, 5 - p.tries) }); }
    pending.delete(pt); await tfa.save(code, b32, hit); if (p.enroll) await store.audit(kind + ':' + code, 'tfa_enrolled', { ip });
    return finishLogin(req, res, p.ident, ip, kind, code);
  }
  async function logout(res, s, token) { if (s.kind === 'staff') await commitCall('portalLogout', [s.code], { policy: false }); await audit(s, 'logout', {}); await auth.destroy(token); setCookie(res, '', 0); return send(res, 200, { ok: true }); }

  /* ---- routes ---- */
  const lastSeen = new Map();
  async function api(req, res, url) {
    const ip = realIp(req);
    if (!auth.hit(auth.ipHits, 'api:' + ip, cfg.apiRateLimit, 60000)) return send(res, 429, { error: 'toomany' }, { 'Retry-After': '30' });
    const route = req.method + ' ' + url.pathname;
    if (route === 'GET /api/ping') return send(res, 200, { server: true, demo: !!cfg.seedDemo });
    if (req.method === 'POST' && !originOk(req)) return send(res, 403, { error: 'Bad origin.' });
    if (route === 'POST /api/login') return login(req, res, await jsonBody(req));
    if (route === 'POST /api/login2fa') return login2fa(req, res, await jsonBody(req));
    const token = parseCookies(req)[COOKIE], s = auth.lookup(token);
    if (route === 'GET /api/me') {
      if (!s) { if (token) setCookie(res, '', 0); return send(res, 200, { signedIn: false }); }
      if (s.closing) { s.closing = 0; if (s.kind === 'staff') await commitCall('portalResume', [s.code], { policy: false }); }        // a reload: back in straight away
      return send(res, 200, { signedIn: true, me: Object.assign(who(s), { csrf: s.csrf }), state: snapshot(engine, s, 0) });
    }
    if (!s) return send(res, 401, { error: 'signin' });
    if (route === 'GET /api/security') {   // the Host sees who has set up Google Authenticator and each department's rule
      if (s.kind !== 'staff' || s.dept !== 'host') return send(res, 403, { error: 'host' });
      const emps = (engine.get('employees') || []).filter(e => e.status === 'active'), depts = Object.keys(engine.ctx.DB.DEPTS), out = [];
      for (const e of emps) out.push({ code: e.id, name: e.name, dept: e.dept, required: await tfa.required(e.dept), enrolled: await tfa.enrolled(e.id) });
      const dr = []; for (const d of depts) dr.push({ dept: d, name: engine.ctx.DB.DEPTS[d], required: await tfa.required(d) });
      return send(res, 200, { ok: true, default: !!cfg.require2fa, depts: dr, users: out });
    }
    if (route === 'POST /api/security') {
      const b = await jsonBody(req, true), tok = b.csrf || req.headers['x-csrf-token']; if (!tok || tok !== s.csrf) return send(res, 403, { error: 'csrf' }); if (s.kind !== 'staff' || s.dept !== 'host') return send(res, 403, { error: 'host' });
      const known = Object.keys(engine.ctx.DB.DEPTS);
      if (b.action === 'policy') { if (b.all === true || b.all === false) await tfa.setPolicyAll(known, b.all); else if (known.includes(String(b.dept))) await tfa.setPolicy(String(b.dept), !!b.required); else return send(res, 400, { error: 'dept' }); await store.audit(s.kind + ':' + s.code, 'tfa_policy', { dept: b.dept || 'all', required: b.all !== undefined ? b.all : !!b.required }); return send(res, 200, { ok: true }); }
      if (b.action === 'reset') { const code = String(b.code || '').toUpperCase(); if (!(engine.get('employees') || []).some(e => e.id === code)) return send(res, 404, { error: 'nouser' }); await tfa.reset(code); await auth.destroyUser('staff', code); await store.audit(s.kind + ':' + s.code, 'tfa_reset', { code }); return send(res, 200, { ok: true }); }
      return send(res, 400, { error: 'action' });
    }
    if (route === 'POST /api/closing') { const b = await jsonBody(req, true); if (!b.csrf || b.csrf !== s.csrf) return send(res, 403, { error: 'csrf' }); s.closing = Date.now(); if (s.kind === 'staff') await commitCall('portalClosing', [s.code], { policy: false }); return send(res, 200, { ok: true }); }
    if (route === 'GET /api/state') {
      const since = Math.max(0, parseInt(url.searchParams.get('since'), 10) || 0);
      if (s.kind === 'staff' && Date.now() - (lastSeen.get(s.code) || 0) > 14000) { lastSeen.set(s.code, Date.now()); await commitCall('portalSeen', [s.code], { policy: false }); }
      return send(res, 200, snapshot(engine, s, since));
    }
    if (req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE') if (req.headers['x-csrf-token'] !== s.csrf) return send(res, 403, { error: 'csrf' });
    if (route === 'POST /api/logout') return logout(res, s, token);
    if (route === 'POST /api/rpc') {
      const b = await jsonBody(req); if (!auth.hit(auth.ipHits, 'rpc:' + s.kind + s.code, 240, 60000)) return send(res, 429, { error: 'toomany' });
      const a = acl.authorize(s, b.fn, b.args);
      if (a.error) { await audit(s, 'denied', { fn: String(b.fn).slice(0, 60) }); return send(res, a.denied ? 403 : 400, { error: a.error }); }
      if (a.noop) return send(res, 200, { ok: true, result: null, state: snapshot(engine, s, Math.max(0, +b.since || 0)) });
      const r = await commitCall(a.fn, a.args, { fieldGuard: s.kind === 'staff' && s.dept === 'fieldsales' && !require('./acl.js').FIELD_WRITE.has(a.fn) });
      if (r.denied) { await audit(s, 'denied', { fn: String(a.fn).slice(0, 60), why: 'field-create-only' }); return send(res, 403, { error: r.error }); }
      if (r.error) return send(res, 200, { ok: false, error: r.error, state: snapshot(engine, s, Math.max(0, +b.since || 0)) });
      if (r.changed) { await audit(s, 'op', { fn: a.fn }); scheduleEvents(); }
      return send(res, 200, { ok: true, result: r.result, state: snapshot(engine, s, Math.max(0, +b.since || 0)) });
    }
    if (route === 'POST /api/brand/fetch') {   // Admin (Host) and IT: read a brand's website for the Add brand form
      if (s.kind !== 'staff' || !(s.dept === 'host' || s.dept === 'it')) return send(res, 403, { error: 'Only the Host and IT can add a brand.' });
      if (!auth.hit(auth.ipHits, 'bfetch:' + s.code, 8, 60000)) return send(res, 429, { error: 'toomany' });
      const b = await jsonBody(req), r = await require('./brandfetch.js').fetchBrand(String(b.url || '').slice(0, 300), cfg); await audit(s, 'brand_fetch', { url: String(b.url || '').slice(0, 120), ok: !!r.ok });
      return send(res, r.error ? 400 : 200, r);
    }
    if (route === 'GET /api/sheets/config') { if (s.kind !== 'staff') return send(res, 403, { error: 'no' }); return send(res, 200, await sheets.publicConfig(s)); }
    if (route === 'PUT /api/sheets/config') { if (s.kind !== 'staff') return send(res, 403, { error: 'no' }); const r = await sheets.setConfig(s, await jsonBody(req)); if (r.ok) { await audit(s, 'sheets_config', {}); sheetSync.lastGv = -1; } return send(res, r.error ? 400 : 200, r); }
    if (route === 'PUT /api/sheets/glink') { if (s.kind !== 'staff') return send(res, 403, { error: 'no' }); const b = await jsonBody(req), r = await sheets.setGlink(s, String(b.dept || ''), b.url ? String(b.url) : ''); if (r.ok) { await audit(s, 'sheets_glink', { dept: b.dept }); sheetSync.lastGv = -1; } return send(res, r.error ? 400 : 200, r); }
    if (route === 'POST /api/sheets/sync') { if (s.kind !== 'staff') return send(res, 403, { error: 'no' }); if (!auth.hit(auth.ipHits, 'ssync:' + s.code, 12, 60000)) return send(res, 429, { error: 'toomany' }); await sheetSync.run(true); await sheets.flush(); return send(res, 200, await sheets.publicConfig(s)); }
    if (route === 'POST /api/sheets/push') { if (s.kind !== 'staff') return send(res, 403, { error: 'no' }); const r = await sheets.push(s, (await jsonBody(req)).items); return send(res, r.error ? (r.code || 400) : 200, r); }
    return send(res, 404, { error: 'Not found.' });
  }
  let evTimer = null; function scheduleEvents() { if (evTimer) return; evTimer = setTimeout(() => { evTimer = null; commitCall('stageEvents', [], { policy: false }).catch(e => console.error('events', e.message)); }, 400); }

  /* ---- static files ---- */
  const ROOT = fs.realpathSync(cfg.siteDir || cfg.portalDir), URLP = cfg.siteDir ? '/dealer-portal' : '';
  /* these never exist as public addresses: the employee console lives only at the private staff address */
  const HIDDEN = cfg.siteDir ? [/^\/dealer-portal\/admin(\/|$)/i, /^\/employee(\/|$)/i, /^\/backend(\/|$)/i, /^\/(README\.md|OPEN-ME\.html|vercel\.json)$/i, /^\/dealer-portal\/OPEN-ME\.html$/i] : [/^\/admin(\/|$)/i];
  const staffHtml = (() => {
    let h = fs.readFileSync(path.join(fs.realpathSync(cfg.portalDir), 'admin', 'index.html'), 'utf8');
    h = h.replace(/(src|href)="\.\.\/(js|css)\//g, '$1="' + URLP + '/$2/').replace(/<script src="([^"]*\/js\/boot\.js)"><\/script>/, '<script src="$1" data-base="' + URLP + '/"></script>');
    return h.replace('<head>', '<head>\n<meta name="robots" content="noindex, nofollow">');
  })();
  function serveStaff(req, res) {
    const buf = Buffer.from(staffHtml);
    res.writeHead(200, Object.assign({ 'Content-Type': MIME['.html'], 'Content-Length': buf.length, 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' }, HDR)); if (req.method === 'HEAD') return res.end(); res.end(buf);
  }
  function serveStatic(req, res, url) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Method not allowed.' });
    let p; try { p = decodeURIComponent(url.pathname); } catch (e) { return send(res, 400, { error: 'Bad request.' }); } if (p.includes('\0')) return send(res, 400, { error: 'Bad request.' });
    if (p === cfg.staffPath || p === cfg.staffPath + '/') return serveStaff(req, res);
    if (HIDDEN.some(r => r.test(p))) return send(res, 404, { error: 'Not found.' });
    if (p.endsWith('/')) p += 'index.html';
    let base = ROOT; if (!cfg.siteDir && p.startsWith('/assets/')) base = fs.realpathSync(path.join(cfg.portalDir, '..'));   // product pictures live in the website's assets folder even when only the portal is served
    const full = path.resolve(base, '.' + p); if (full !== base && !full.startsWith(base + path.sep)) return send(res, 403, { error: 'Forbidden.' });
    const ext = path.extname(full).toLowerCase();
    fs.stat(full, (err, st) => {
      if (!err && st.isDirectory() && !ext) { res.writeHead(302, Object.assign({ Location: url.pathname + '/' }, HDR)); return res.end(); }
      if (!MIME[ext] || path.basename(full).startsWith('.') || err || !st.isFile()) return send(res, 404, { error: 'Not found.' });
      if (ext === '.html') {   // a page with its own inline script (the public website) may run exactly that script, identified by its fingerprint; nothing else is opened up
        fs.readFile(full, (e2, buf) => {
          if (e2) return send(res, 404, { error: 'Not found.' });
          const hashes = [...buf.toString('utf8').matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].filter(m => m[1].trim()).map(m => "'sha256-" + crypto.createHash('sha256').update(m[1]).digest('base64') + "'");
          const h = Object.assign({ 'Content-Type': MIME[ext], 'Content-Length': buf.length, 'Cache-Control': 'no-cache' }, HDR);
          if (hashes.length) h['Content-Security-Policy'] = HDR['Content-Security-Policy'].replace("script-src 'self'", "script-src 'self' " + hashes.join(' '));
          res.writeHead(200, h); if (req.method === 'HEAD') return res.end(); res.end(buf);
        });
        return;
      }
      res.writeHead(200, Object.assign({ 'Content-Type': MIME[ext], 'Content-Length': st.size, 'Cache-Control': ext === '.js' || ext === '.css' ? 'no-cache' : 'public, max-age=86400' }, HDR));
      if (req.method === 'HEAD') return res.end(); fs.createReadStream(full).pipe(res);
    });
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      if (url.pathname.startsWith('/api/')) return await api(req, res, url);
      return serveStatic(req, res, url);
    } catch (e) { const st = e.status || 500; if (st === 500) console.error('request error:', e && e.stack || e); if (!res.headersSent) send(res, st, { error: st === 413 ? 'Too large.' : (st === 415 || st === 400) ? 'Bad request.' : 'Something went wrong.' }); else res.end(); }
  });
  server.requestTimeout = 30000; server.headersTimeout = 15000; server.keepAliveTimeout = 5000;
  /* ---- background upkeep ---- */
  const timers = [
    setInterval(() => { auth.sweep(); store.purgeSessions(Date.now()).catch(() => {}); }, 10000),
    setInterval(() => { commitCall('reconcileAttendance', [], { policy: false }).catch(() => {}); commitCall('releaseSlips', [Date.now()], { policy: false }).catch(() => {}); commitCall('expirePreorders', [], { policy: false }).catch(() => {}); scheduleEvents(); }, 15000),
    setInterval(() => sheets.flush(), 30000),
    setInterval(() => { sheetSync.run(false).catch(e => console.error('sheet sync', e.message)); }, 20000),
  ]; timers.forEach(t => t.unref());
  async function close() { timers.forEach(clearInterval); if (evTimer) clearTimeout(evTimer); await new Promise(r => server.close(r)); await chain.catch(() => {}); await store.close(); }
  return { server, close, engine, auth, store, sheets, sheetSync, commitCall, cfg, COOKIE, tfa };
}

if (require.main === module) {
  const cfg = cfgMod.load();
  createApp(cfg).then(app => { app.server.listen(cfg.port, cfg.host, () => console.log(`S-ELEVEN server listening on http://${cfg.host}:${cfg.port} (${cfg.prod ? 'production' : 'development'}${cfg.seedDemo ? ', DEMO data' : ''})`)); const stop = () => app.close().then(() => process.exit(0)); process.on('SIGTERM', stop); process.on('SIGINT', stop); })
    .catch(e => { console.error('Cannot start:', e.message); process.exit(1); });
}
module.exports = { createApp };
