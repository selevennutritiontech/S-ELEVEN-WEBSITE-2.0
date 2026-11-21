'use strict';
/* Passwords (scrypt, per-user salt), sign-in lockout, sessions, and encryption for stored third-party secrets. */
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const scrypt = promisify(crypto.scrypt);
const N = 16384, R = 8, P = 1, KEYLEN = 64;

async function hashPassword(pw) {
  const salt = crypto.randomBytes(16), h = await scrypt(String(pw), salt, KEYLEN, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 });
  return ['scrypt', N, R, P, salt.toString('base64'), h.toString('base64')].join('$');
}
async function verifyPassword(pw, stored) {
  try {
    const [alg, n, r, p, salt, hash] = String(stored).split('$'); if (alg !== 'scrypt') return false;
    const want = Buffer.from(hash, 'base64'), got = await scrypt(String(pw), Buffer.from(salt, 'base64'), want.length, { N: +n, r: +r, p: +p, maxmem: 64 * 1024 * 1024 });
    return want.length === got.length && crypto.timingSafeEqual(want, got);
  } catch (e) { return false; }
}
let DUMMY = null;   // an unknown user costs the same time as a wrong password (no user enumeration by timing)
async function dummyVerify(pw) { if (!DUMMY) DUMMY = await hashPassword(crypto.randomBytes(8).toString('hex')); await verifyPassword(pw, DUMMY); }

const COMMON = new Set(['password', 'password1', 'password123', '1234567890', '12345678', 'qwerty123', 'qwertyuiop', 'iloveyou1', 'admin12345', 'welcome123', 'letmein123', 'seleven123', 'seleven@123', 's-eleven123']);
/* Used for every password set through the portal after start-up (demo accounts are exempt). */
function passwordProblem(pw) {
  pw = String(pw || '');
  if (pw.length < 10) return 'The password must be at least 10 characters.';
  if (pw.length > 64) return 'The password must be at most 64 characters.';
  if (/\s/.test(pw)) return 'The password cannot contain spaces.';
  if (COMMON.has(pw.toLowerCase())) return 'That password is too common. Choose another.';
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter(x => x.test(pw)).length;
  if (classes < 2) return 'Use at least two kinds of characters (letters, digits, symbols).';
  if (/^(.)\1+$/.test(pw)) return 'The password cannot be one repeated character.';
  return '';
}

/* AES-256-GCM for secrets we must be able to read back (the Google script secret). The key comes from APP_SECRET_KEY, never from the database. */
function seal(plain, keyHex) { const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), iv), enc = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]); return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), enc.toString('base64')].join('.'); }
function unseal(blob, keyHex) { try { const [v, iv, tag, enc] = String(blob).split('.'); if (v !== 'v1') return null; const d = crypto.createDecipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), Buffer.from(iv, 'base64')); d.setAuthTag(Buffer.from(tag, 'base64')); return Buffer.concat([d.update(Buffer.from(enc, 'base64')), d.final()]).toString('utf8'); } catch (e) { return null; } }

const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');
const ATTEMPT_KEY = (kind, code) => kind + ':' + String(code || '').trim().toUpperCase().slice(0, 40);

class Auth {
  constructor(cfg, store) { this.cfg = cfg; this.store = store; this.creds = new Map(); this.sessions = new Map(); this.ipHits = new Map(); }
  async init() {
    this.creds = await this.store.loadCreds();
    for (const s of await this.store.loadSessions()) this.sessions.set(s.h, Object.assign({}, s.data, { _exp: s.exp }));
  }
  /* ---- per-IP limiter (sliding window) ---- */
  hit(map, key, limit, windowMs) { const now = Date.now(), arr = (map.get(key) || []).filter(t => now - t < windowMs); arr.push(now); map.set(key, arr); if (map.size > 20000) { for (const [k, v] of map) if (!v.length || now - v[v.length - 1] > windowMs) map.delete(k); } return arr.length <= limit; }
  /* ---- lockout per account (also for codes that do not exist, so the answer is identical) ---- */
  async lockState(kind, code) { const a = await this.store.getAttempt(ATTEMPT_KEY(kind, code)); const now = Date.now(); return (a && a.lockedUntil > now) ? { locked: true, retryAfterSec: Math.ceil((a.lockedUntil - now) / 1000) } : { locked: false }; }
  async recordFail(kind, code) {
    const k = ATTEMPT_KEY(kind, code), now = Date.now(), a = (await this.store.getAttempt(k)) || { fails: 0, lockedUntil: 0, last: now }; a.fails += 1; a.last = now;
    if (a.fails % this.cfg.lockAfter === 0) { const level = a.fails / this.cfg.lockAfter; a.lockedUntil = now + Math.min(this.cfg.lockMs * Math.pow(2, level - 1), 24 * 3600000); }
    await this.store.setAttempt(k, a); return a;
  }
  async recordSuccess(kind, code) { await this.store.setAttempt(ATTEMPT_KEY(kind, code), { fails: 0, lockedUntil: 0, last: Date.now() }); }
  /* ---- password vault ---- */
  credId(kind, code) { return (kind === 'dealer' ? 'D:' : 'E:') + String(code).trim().toUpperCase(); }
  async check(kind, code, pw) { const h = this.creds.get(this.credId(kind, code)); if (!h) { await dummyVerify(pw); return false; } return verifyPassword(pw, h); }
  /* ---- sessions ---- */
  async createSession(id, ip, ua) {
    const token = crypto.randomBytes(32).toString('base64url'), csrf = crypto.randomBytes(24).toString('base64url'), now = Date.now();
    const rec = { kind: id.kind, code: id.code, role: id.role, dept: id.dept || '', name: id.name || '', csrf, created: now, last: now, closing: 0, ipH: sha256(String(ip || '')).slice(0, 12) };
    const h = sha256(token); rec._exp = now + this.cfg.sessionMaxMs; this.sessions.set(h, rec); await this.store.saveSession(h, rec, rec._exp); return { token, rec };
  }
  lookup(token) {
    if (!token || typeof token !== 'string' || token.length > 100) return null; const h = sha256(token), s = this.sessions.get(h); if (!s) return null; const now = Date.now();
    if (now > s._exp || now - s.last > this.cfg.sessionIdleMs || (s.closing && now - s.closing > 30000)) { this.destroyHash(h); return null; }
    if (now - s.last > 30000) { s.last = now; this.store.saveSession(h, s, s._exp).catch(() => {}); } else s.last = now;
    return s;
  }
  async destroy(token) { await this.destroyHash(sha256(token)); }
  async destroyHash(h) { this.sessions.delete(h); try { await this.store.deleteSession(h); } catch (e) {} }
  async destroyUser(kind, code) { for (const [h, s] of this.sessions) if (s.kind === kind && s.code === code) await this.destroyHash(h); }
  sweep() { const now = Date.now(), gone = []; for (const [h, s] of this.sessions) { if (now > s._exp || now - s.last > this.cfg.sessionIdleMs || (s.closing && now - s.closing > 30000)) { gone.push(s); this.destroyHash(h); } } return gone; }
}
module.exports = { Auth, hashPassword, verifyPassword, passwordProblem, seal, unseal, sha256 };
