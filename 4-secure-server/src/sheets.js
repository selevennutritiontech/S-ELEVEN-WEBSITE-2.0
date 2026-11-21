'use strict';
/* Google Sheets relay. The Google script address and its secret live ONLY on the server (the secret is encrypted with APP_SECRET_KEY).
   The browser never sees the secret; it sends rows here, and the server forwards them, adding the secret and the department's own sheet. */
const { seal, unseal } = require('./auth.js');
const SCRIPT_URL = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/;   // overridable only outside production (tests use a local stand-in for Google)
const SHEET_URL = /^https:\/\/docs\.google\.com\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})/;
const DEPTS = new Set(['host', 'sales', 'fieldsales', 'logistics', 'warehouse', 'finance', 'branding', 'it', 'hr']);

class Sheets {
  constructor(cfg, store) { this.cfg = cfg; this.store = store; this.queue = []; this.sending = false; this.cache = null; this.status = { lastRunAt: 0, lastOkAt: 0, lastWritten: 0, lastError: '', lastErrors: [], queued: 0 }; this.urlOk = u => (cfg.sheetsUrlPattern || SCRIPT_URL).test(u); }
  async load() { if (!this.cache) { const r = await this.store.getSetting('sheets'); this.cache = r ? JSON.parse(r) : { url: '', secretSealed: '', owner: '', glinks: {} }; const q = await this.store.getSetting('sheets.queue'); this.queue = q ? JSON.parse(q) : []; } return this.cache; }
  async save() { await this.store.setSetting('sheets', JSON.stringify(this.cache)); }
  async saveQueue() { await this.store.setSetting('sheets.queue', JSON.stringify(this.queue.slice(-2000))); }
  /* what a signed-in person may see: never the secret; a department sees only its own link */
  async publicConfig(s) { const c = await this.load(), out = { connected: !!(c.url && c.secretSealed), owner: c.owner || '', glinks: {}, queued: this.queue.length + (this.status.queued || 0), status: Object.assign({}, this.status, { lastErrors: (this.status.lastErrors || []).slice(0, 5) }) }; for (const d of Object.keys(c.glinks)) if (s.dept === 'host' || d === s.dept) out.glinks[d] = { url: c.glinks[d].url, by: c.glinks[d].by, at: c.glinks[d].at }; return out; }
  async setConfig(s, body) {
    if (s.dept !== 'host') return { error: 'Only the Host can connect Google.' }; const c = await this.load();
    if (typeof body.url === 'string') { if (body.url && !this.urlOk(body.url)) return { error: 'The address should look like https://script.google.com/macros/s/.../exec' }; c.url = body.url; }
    if (typeof body.secret === 'string' && body.secret) { if (body.secret.length < 8 || body.secret.length > 200) return { error: 'The secret must be 8 to 200 characters.' }; c.secretSealed = seal(body.secret, this.cfg.appSecretKey); }
    if (typeof body.owner === 'string') c.owner = body.owner.slice(0, 120);
    if (body.disconnect === true) { c.url = ''; c.secretSealed = ''; }
    await this.save(); return { ok: true };
  }
  async setGlink(s, dept, url) {
    if (!DEPTS.has(dept)) return { error: 'Unknown department.' }; if (s.dept !== 'host' && s.dept !== dept) return { error: 'You can link only your own department\u2019s sheet.' };
    const c = await this.load(); if (!url) { delete c.glinks[dept]; await this.save(); return { ok: true }; }
    const m = SHEET_URL.exec(String(url)); if (!m) return { error: 'Paste a Google Sheets link (it starts with https://docs.google.com/spreadsheets/d/).' };
    c.glinks[dept] = { id: m[1], url: String(url).slice(0, 300), by: s.code, at: Date.now() }; await this.save(); return { ok: true, id: m[1] };
  }
  /* rows from the browser: keep only rows this person may send, and attach the target sheet the SERVER knows for that department */
  async push(s, items) {
    const c = await this.load(); if (!(c.url && c.secretSealed)) return { error: 'Google is not connected.', code: 409 }; const out = [];
    for (const it of (Array.isArray(items) ? items.slice(0, 200) : [])) {
      if (!it || typeof it.book !== 'string' || typeof it.tab !== 'string' || !Array.isArray(it.row) || it.row.length > 60 || (it.headers && (!Array.isArray(it.headers) || it.headers.length > 60))) continue;
      const dept = typeof it.dept === 'string' ? it.dept : '';
      if (dept) { if (!DEPTS.has(dept) || (s.dept !== 'host' && dept !== s.dept)) continue; } else if (s.dept !== 'host' && it.book !== 'My sheets: ' + s.code && it.book !== 'Activity') continue;
      const g = dept ? c.glinks[dept] : null;
      out.push({ book: it.book.slice(0, 90), dept, target: g ? g.id : '', tab: it.tab.slice(0, 90), key: String(it.key == null ? '' : it.key).slice(0, 120), headers: (it.headers || []).map(x => String(x).slice(0, 80)), row: it.row.map(x => (typeof x === 'number' || x === null) ? x : String(x).slice(0, 500)) });
    }
    this.queue.push(...out); await this.saveQueue(); this.flush(); return { ok: true, accepted: out.length };
  }
  /* Send rows to the Google script and read its answer. ok is true only when the script says so: a wrong secret, an unreachable script or a refusal is an ERROR, never "sent". */
  async forwardTrusted(items) {
    if (items.length > 200) { let last = { ok: true, written: 0, errors: [] }; for (let i = 0; i < items.length; i += 200) { const r = await this.forwardTrusted(items.slice(i, i + 200)); if (!r.ok) return r; last = { ok: true, written: (last.written || 0) + (r.written || 0), errors: (last.errors || []).concat(r.errors || []) }; } return last; }   // the Google script takes at most 200 rows per request
    const c = await this.load(), secret = unseal(c.secretSealed, this.cfg.appSecretKey); this.status.lastRunAt = Date.now();
    if (!c.url || !c.secretSealed) return this.fail('Google is not connected.');
    if (!secret) return this.fail('The stored Google secret cannot be read (APP_SECRET_KEY changed). Enter the Google secret again in Sheets > Connect Google.');
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 25000); let r, text;
    try { r = await fetch(c.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ secret, items }), signal: ctl.signal, redirect: 'follow' }); text = await r.text(); }
    catch (e) { clearTimeout(t); return this.fail(e.name === 'AbortError' ? 'Google did not answer within 25 seconds.' : 'Google could not be reached: ' + String(e.message || e).slice(0, 100)); }
    clearTimeout(t); let j = null; try { j = JSON.parse(text); } catch (e) {}
    if (!j) return this.fail(r.ok ? 'Google sent an unexpected reply. Deploy the script as a web app that runs as you and is open to "Anyone", then paste its /exec address again.' : 'Google answered HTTP ' + r.status + '.');
    if (!j.ok) return this.fail(j.error === 'Wrong secret' ? 'The Google script refused the rows: the secret in the portal is not the one saved in the script (run setSecret in the script with the same text, or enter the secret here again).' : 'The Google script refused the rows: ' + String(j.error || 'unknown reason').slice(0, 160));
    this.status.lastOkAt = Date.now(); this.status.lastWritten = j.written || 0; this.status.lastError = ''; this.status.lastErrors = Array.isArray(j.errors) ? j.errors.slice(0, 20) : [];
    if (this.status.lastErrors.length) { const e0 = this.status.lastErrors[0]; this.status.lastError = 'Some rows were not written (' + (e0.book || '') + ' / ' + (e0.tab || '') + '): ' + e0.error + (/permission|access|not found|No item/i.test(e0.error) ? ' Share the Google Sheet with the Google account that owns the script, as Editor.' : ''); }
    return { ok: true, written: j.written || 0, errors: this.status.lastErrors };
  }
  fail(msg) { this.status.lastError = msg; return { ok: false, error: msg }; }
  /* rows pushed by browsers (activity log, personal sheets): kept until Google accepts them */
  async flush() {
    if (this.sending || !this.queue.length) return; this.sending = true;
    try {
      while (this.queue.length) {
        const batch = this.queue.slice(0, 25), r = await this.forwardTrusted(batch);
        if (!r.ok) { this.status.queued = this.queue.length; this.sending = false; if (!this.retryT) { this.retryT = setTimeout(() => { this.retryT = null; this.flush(); }, 60000); this.retryT.unref(); } return; }
        this.queue.splice(0, batch.length); await this.saveQueue();
      }
    } finally { if (!this.queue.length) this.sending = false; }
    this.sending = false; this.status.queued = 0;
  }
}
module.exports = { Sheets };
