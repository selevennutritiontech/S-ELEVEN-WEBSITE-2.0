'use strict';
/* Persistence. PgStore keeps everything in PostgreSQL; MemStore is for tests and local development only.
   Data (kv), password hashes (creds), sessions, login attempts, audit log and settings are separate tables. */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS portal_kv (k text PRIMARY KEY, v text NOT NULL, ver bigint NOT NULL);
CREATE TABLE IF NOT EXISTS portal_creds (id text PRIMARY KEY, hash text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS portal_sessions (h text PRIMARY KEY, data jsonb NOT NULL, expires_at bigint NOT NULL);
CREATE TABLE IF NOT EXISTS portal_attempts (k text PRIMARY KEY, fails int NOT NULL, locked_until bigint NOT NULL DEFAULT 0, last bigint NOT NULL);
CREATE TABLE IF NOT EXISTS portal_audit (id bigserial PRIMARY KEY, at timestamptz NOT NULL DEFAULT now(), actor text, action text NOT NULL, detail jsonb);
CREATE TABLE IF NOT EXISTS portal_settings (k text PRIMARY KEY, v text NOT NULL);
CREATE INDEX IF NOT EXISTS portal_audit_at ON portal_audit (at);`;

class MemStore {
  constructor() { this.kv = new Map(); this.creds = new Map(); this.sess = new Map(); this.att = new Map(); this.auditRows = []; this.settings = new Map(); this.gv = 0; }
  async init() {}
  async loadKV() { return { kv: new Map(this.kv), gv: this.gv }; }
  async loadCreds() { return new Map(this.creds); }
  async commit({ kv = [], creds = [], gv }) { for (const c of kv) { if (c.v === null) this.kv.delete(c.k); else this.kv.set(c.k, { v: c.v, ver: c.ver }); } for (const c of creds) this.creds.set(c.id, c.hash); if (gv !== undefined) this.gv = gv; }
  async loadSessions() { return [...this.sess.values()]; }
  async saveSession(h, data, exp) { this.sess.set(h, { h, data, exp }); }
  async deleteSession(h) { this.sess.delete(h); }
  async purgeSessions(now) { for (const [h, s] of this.sess) if (s.exp < now) this.sess.delete(h); }
  async getAttempt(k) { return this.att.get(k) || null; }
  async setAttempt(k, a) { this.att.set(k, a); }
  async audit(actor, action, detail) { this.auditRows.push({ at: new Date().toISOString(), actor, action, detail }); if (this.auditRows.length > 5000) this.auditRows.shift(); }
  async getSetting(k) { return this.settings.has(k) ? this.settings.get(k) : null; }
  async setSetting(k, v) { this.settings.set(k, v); }
  async close() {}
}

class PgStore {
  constructor(url) { const pg = require('pg'); this.pool = new pg.Pool({ connectionString: url, max: 10 }); }
  async init() { await this.pool.query(SCHEMA); }
  async loadKV() { const r = await this.pool.query('SELECT k, v, ver FROM portal_kv'); const kv = new Map(); let gv = 0; for (const x of r.rows) { const ver = Number(x.ver); kv.set(x.k, { v: x.v, ver }); if (ver > gv) gv = ver; } return { kv, gv }; }
  async loadCreds() { const r = await this.pool.query('SELECT id, hash FROM portal_creds'); return new Map(r.rows.map(x => [x.id, x.hash])); }
  async commit({ kv = [], creds = [] }) {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      for (const x of kv) { if (x.v === null) await c.query('DELETE FROM portal_kv WHERE k=$1', [x.k]); else await c.query('INSERT INTO portal_kv (k,v,ver) VALUES ($1,$2,$3) ON CONFLICT (k) DO UPDATE SET v=EXCLUDED.v, ver=EXCLUDED.ver', [x.k, x.v, x.ver]); }
      for (const x of creds) await c.query('INSERT INTO portal_creds (id,hash) VALUES ($1,$2) ON CONFLICT (id) DO UPDATE SET hash=EXCLUDED.hash, updated_at=now()', [x.id, x.hash]);
      await c.query('COMMIT');
    } catch (e) { try { await c.query('ROLLBACK'); } catch (_) {} throw e; } finally { c.release(); }
  }
  async loadSessions() { const r = await this.pool.query('SELECT h, data, expires_at FROM portal_sessions'); return r.rows.map(x => ({ h: x.h, data: x.data, exp: Number(x.expires_at) })); }
  async saveSession(h, data, exp) { await this.pool.query('INSERT INTO portal_sessions (h,data,expires_at) VALUES ($1,$2,$3) ON CONFLICT (h) DO UPDATE SET data=EXCLUDED.data, expires_at=EXCLUDED.expires_at', [h, JSON.stringify(data), exp]); }
  async deleteSession(h) { await this.pool.query('DELETE FROM portal_sessions WHERE h=$1', [h]); }
  async purgeSessions(now) { await this.pool.query('DELETE FROM portal_sessions WHERE expires_at < $1', [now]); }
  async getAttempt(k) { const r = await this.pool.query('SELECT fails, locked_until, last FROM portal_attempts WHERE k=$1', [k]); return r.rows[0] ? { fails: r.rows[0].fails, lockedUntil: Number(r.rows[0].locked_until), last: Number(r.rows[0].last) } : null; }
  async setAttempt(k, a) { await this.pool.query('INSERT INTO portal_attempts (k,fails,locked_until,last) VALUES ($1,$2,$3,$4) ON CONFLICT (k) DO UPDATE SET fails=EXCLUDED.fails, locked_until=EXCLUDED.locked_until, last=EXCLUDED.last', [k, a.fails, a.lockedUntil, a.last]); }
  async audit(actor, action, detail) { try { await this.pool.query('INSERT INTO portal_audit (actor,action,detail) VALUES ($1,$2,$3)', [actor || null, action, JSON.stringify(detail || {})]); } catch (e) { console.error('audit write failed', e.message); } }
  async getSetting(k) { const r = await this.pool.query('SELECT v FROM portal_settings WHERE k=$1', [k]); return r.rows[0] ? r.rows[0].v : null; }
  async setSetting(k, v) { await this.pool.query('INSERT INTO portal_settings (k,v) VALUES ($1,$2) ON CONFLICT (k) DO UPDATE SET v=EXCLUDED.v', [k, v]); }
  async close() { await this.pool.end(); }
}
function make(cfg) { return cfg.databaseUrl ? new PgStore(cfg.databaseUrl) : new MemStore(); }
module.exports = { make, MemStore, PgStore };
