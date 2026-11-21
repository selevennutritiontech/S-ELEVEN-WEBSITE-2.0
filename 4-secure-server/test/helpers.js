'use strict';
const http = require('node:http');
const cfgMod = require('../src/config.js');
const { createApp } = require('../src/server.js');
const PORTAL = require('node:path').resolve(__dirname, '..', '..', '1-website-and-dealer-portal', 'dealer-portal');

async function start(over = {}) {
  const env = Object.assign({ NODE_ENV: 'test', SEED_DEMO: '1', COOKIE_INSECURE_DEV: '1', PORTAL_DIR: PORTAL, PORT: '0', DEMO_PAYMENTS: '' }, over.env || {});
  if (process.env.TEST_DATABASE_URL && !over.memory) env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  if (env.DATABASE_URL && !over.keep) { const pg = require('pg'), p = new pg.Pool({ connectionString: env.DATABASE_URL }); await p.query('DROP TABLE IF EXISTS portal_kv, portal_creds, portal_sessions, portal_attempts, portal_audit, portal_settings'); await p.end(); }   // every test file starts from an empty database
  const cfg = cfgMod.load(env); Object.assign(cfg, { ipLoginLimit: 1000, apiRateLimit: 100000 }, over.cfg || {});
  const app = await createApp(cfg); await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  app.base = 'http://127.0.0.1:' + app.server.address().port; return app;
}
/* a browser-like client: keeps the cookie, sends Origin and the CSRF token like the portal does */
class Client {
  constructor(app) { this.app = app; this.cookie = ''; this.csrf = ''; this.me = null; this.lastSet = ''; }
  async raw(method, path, { body, headers = {}, noOrigin, noCsrf, type } = {}) {
    const h = Object.assign({}, headers); if (this.cookie) h.Cookie = this.cookie; if (!noOrigin && method !== 'GET' && !h.Origin) h.Origin = this.app.base;
    if (this.csrf && !noCsrf && method !== 'GET') h['X-CSRF-Token'] = this.csrf;
    let payload; if (body !== undefined) { payload = typeof body === 'string' ? body : JSON.stringify(body); h['Content-Type'] = type || 'application/json'; }
    const r = await fetch(this.app.base + path, { method, headers: h, body: payload, redirect: 'manual' });
    const set = r.headers.get('set-cookie'); if (set) { this.lastSet = set; const m = /^([^=]+)=([^;]*)/.exec(set); if (m) this.cookie = m[2] ? m[1] + '=' + m[2] : ''; }
    const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch (e) {}
    return { status: r.status, json, text, headers: r.headers };
  }
  async login(kind, code, password) { const r = await this.raw('POST', '/api/login', { body: { kind, code, password } }); if (r.status === 200) { this.me = r.json.me; this.csrf = r.json.me.csrf; this.state = {}; this.apply(r.json.state); } return r; }
  apply(st) { if (!st) return; this.ver = st.ver; for (const [k, v] of Object.entries(st.set || {})) this.state[k] = JSON.parse(v); for (const k of st.del || []) delete this.state[k]; }
  async rpc(fn, args) { const r = await this.raw('POST', '/api/rpc', { body: { fn, args, since: this.ver || 0 } }); if (r.json && r.json.state) this.apply(r.json.state); return r; }
  async getState(since = 0) { const r = await this.raw('GET', '/api/state?since=' + since); return r; }
}
const staff = async (app, code, pw) => { const c = new Client(app); const r = await c.login('staff', code, pw); if (r.status !== 200) throw new Error('login failed ' + code + ' ' + r.status); return c; };
const dealer = async (app, code, pw) => { const c = new Client(app); const r = await c.login('dealer', code, pw); if (r.status !== 200) throw new Error('login failed ' + code + ' ' + r.status); return c; };
module.exports = { start, Client, staff, dealer, PORTAL };
