'use strict';
/* Google Authenticator (TOTP, RFC 6238) for staff sign-in. The 6-digit code is checked in the same request in which it is entered: no queue, no delay.
   Secrets are stored encrypted (AES-GCM, APP_SECRET_KEY). A code can be used only once (replay refused). Wrong codes count toward the same account lockout as wrong passwords. */
const crypto = require('node:crypto');
const { seal, unseal } = require('./auth.js');
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function b32enc(buf) { let bits = 0, val = 0, out = ''; for (const b of buf) { val = (val << 8) | b; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } } if (bits > 0) out += B32[(val << (5 - bits)) & 31]; return out; }
function b32dec(s) { s = String(s).replace(/[\s=-]/g, '').toUpperCase(); let bits = 0, val = 0; const out = []; for (const ch of s) { const x = B32.indexOf(ch); if (x < 0) continue; val = (val << 5) | x; bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } } return Buffer.from(out); }
function hotp(key, counter) { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(counter)); const h = crypto.createHmac('sha1', key).update(b).digest(), o = h[19] & 15, n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]; return String(n % 1000000).padStart(6, '0'); }
/* the time step a code belongs to (this step, one before or one after for clock drift), and only if it is newer than the last one used */
function match(key, token, nowMs, afterCounter) { token = String(token == null ? '' : token).replace(/\s/g, ''); if (!/^\d{6}$/.test(token)) return null; const step = Math.floor(nowMs / 30000); let hit = null; for (let d = -1; d <= 1; d++) { const c = step + d; if (crypto.timingSafeEqual(Buffer.from(hotp(key, c)), Buffer.from(token))) hit = c; } return hit !== null && hit > (afterCounter || 0) ? hit : null; }
class Tfa {
  constructor(store, cfg) { this.store = store; this.cfg = cfg; this.now = () => Date.now(); }
  async policyMap() { const v = await this.store.getSetting('tfa:policy'); if (!v) return null; try { return JSON.parse(v); } catch (e) { return null; } }
  async required(dept) { const m = await this.policyMap(); if (m && Object.prototype.hasOwnProperty.call(m, dept)) return !!m[dept]; return !!this.cfg.require2fa; }
  async setPolicy(dept, on) { const m = (await this.policyMap()) || {}; m[String(dept)] = !!on; await this.store.setSetting('tfa:policy', JSON.stringify(m)); }
  async setPolicyAll(depts, on) { const m = (await this.policyMap()) || {}; for (const d of depts) m[d] = !!on; await this.store.setSetting('tfa:policy', JSON.stringify(m)); }
  async rec(code) { const v = await this.store.getSetting('tfa:' + code); if (!v) return null; try { const o = JSON.parse(v), b32 = unseal(o.s, this.cfg.appSecretKey); return b32 ? { b32, key: b32dec(b32), last: o.last || 0, at: o.at } : null; } catch (e) { return null; } }
  async enrolled(code) { return !!(await this.rec(code)); }
  newSecret() { return b32enc(crypto.randomBytes(20)); }
  uri(code, secret) { return 'otpauth://totp/S-ELEVEN:' + encodeURIComponent(code) + '?secret=' + secret + '&issuer=S-ELEVEN&algorithm=SHA1&digits=6&period=30'; }
  async save(code, b32, last) { await this.store.setSetting('tfa:' + code, JSON.stringify({ s: seal(b32, this.cfg.appSecretKey), last, at: this.now() })); }
  async reset(code) { await this.store.setSetting('tfa:' + code, ''); }
  /* returns the matched counter, or null */
  check(b32, token, last) { return match(b32dec(b32), token, this.now(), last); }
}
module.exports = { Tfa, hotp, match, b32enc, b32dec };
