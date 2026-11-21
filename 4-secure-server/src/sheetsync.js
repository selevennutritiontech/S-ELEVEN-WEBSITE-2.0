'use strict';
/* Server-side sheet updates. The portal's own sheet-building code (js/sheets.js) runs here, in a private sandbox, as the Host, against the real data.
   So the department sheets and the linked Google sheets stay current by themselves, whoever has the portal open (or nobody).
   The sandbox is read-only for portal data; its own workbooks and send queue live in memory. */
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const KEEP_OWN = /^sel\.v2\.sheets/;      // workbooks, Google settings, send queue: private to the sandbox

class SheetSync {
  constructor(cfg, engine, relay) { this.cfg = cfg; this.engine = engine; this.relay = relay; this.own = new Map(); this.junk = new Map(); this.ctx = null; this.lastGv = -1; this.running = false; this.failed = false; this.builtErr = ''; }
  _build() {
    const self = this, eng = this.engine, g = {};
    const get = k => { if (self.own.has(k)) return self.own.get(k); if (self.junk.has(k)) return self.junk.get(k); const v = eng.state.get(k); return v === undefined ? null : v; };
    const shim = { getItem: get, setItem: (k, v) => { (KEEP_OWN.test(k) ? self.own : self.junk).set(k, String(v)); }, removeItem: k => { self.own.delete(k); self.junk.delete(k); }, key: () => null, length: 0 };
    const hostStaff = JSON.stringify({ code: 'ADMIN', role: 'admin', dept: 'host', name: 'Host' });
    const doc = { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, addEventListener() {} }), body: { insertAdjacentHTML() {}, appendChild() {} }, addEventListener() {}, hidden: false };
    Object.assign(g, { window: null, document: doc, navigator: { userAgent: 'server' }, console, localStorage: shim, SelStore: shim, SEL_SERVER: false,   // false so the portal's cfg() reads from localStorage (the sandbox's shim), not from an API endpoint SEL_CONFIG: {}, atob, btoa, URL, TextEncoder, TextDecoder, Promise, JSON, Date, Math,
      sessionStorage: { getItem: k => (k === 'sel.v2.staff' ? hostStaff : null), setItem() {}, removeItem() {}, clear() {} },
      setTimeout: (fn, ms) => { if ((ms || 0) > 5000) return 0; const t = setTimeout(fn, ms || 0); if (t.unref) t.unref(); return t; }, clearTimeout: t => clearTimeout(t), setInterval: () => 0, clearInterval: () => {},
      addEventListener() {},
      fetch: () => new Promise(() => {})   // never resolves: the queue stays intact; we read it ourselves outside the sandbox
    });
    g.window = g; vm.createContext(g);
    for (const f of ['data.js', 'db.js', 'sheets.js']) vm.runInContext(fs.readFileSync(path.join(this.cfg.portalDir, 'js', f), 'utf8'), g, { filename: f });
    this.ctx = g;
  }
  queueLength() { try { return JSON.parse(this.own.get('sel.v2.sheetsq') || '[]').length; } catch (e) { return 0; } }
  /* build all department sheets from the current data and send what changed; keeps what Google did not accept */
  async run(force) {
    if (this.running) return false; const c = await this.relay.load(); if (!(c.url && c.secretSealed)) return false;
    if (!force && this.lastGv === this.engine.gv && this.queueLength() === 0) return false;
    this.running = true; this.failed = false;
    try {
      if (!this.ctx) { try { this._build(); this.builtErr = ''; } catch (e) { this.builtErr = 'The automatic sheet builder could not start: ' + String(e.message || e).slice(0, 140); this.relay.fail(this.builtErr); return false; } }
      const cur = (() => { try { return JSON.parse(this.own.get('sel.v2.sheetscfg') || '{}'); } catch (e) { return {}; } })(), gl = {};
      for (const d of Object.keys(c.glinks || {})) gl[d] = { id: c.glinks[d].id, url: c.glinks[d].url, by: c.glinks[d].by, at: c.glinks[d].at };
      this.own.set('sel.v2.sheetscfg', JSON.stringify({ url: 'https://relay.internal/exec', secret: 'x', owner: c.owner || '', glinks: gl, last: cur.last, err: cur.err }));
      this.engine.overlay = null;
      this.lastGv = this.engine.gv;
      // The sandbox's autoSync builds the rows and queues them in localStorage.
      // The sandbox's fetch() forwards them to the relay as a Promise, but since
      // the VM runs synchronously, the Promise never resolves inside the sandbox.
      // So we collect the queued rows ourselves and send them through the relay.
      try { const changed = this.ctx.Sheets.syncOrders(); if (!changed && this.queueLength() === 0) { /* no rows changed and nothing in the queue — nothing to send */ } } catch (e) { console.error('sheetsync syncOrders error:', e.message); }
      const qk = 'sel.v2.sheetsq';
      let remaining = JSON.parse(this.own.get(qk) || '[]');
      while (remaining.length) {
        const batch = remaining.splice(0, 100);
        this.own.set(qk, JSON.stringify(remaining));
        const r = await this.relay.forwardTrusted(batch);
        if (!r.ok) { this.failed = true; this.own.set(qk, JSON.stringify(batch.concat(remaining))); break; }
        this.own.set(qk, JSON.stringify(remaining));
      }
      this.relay.status.queued = this.queueLength(); this.relay.status.lastRunAt = Date.now();
      if (this.failed) this.lastGv = -1;      // try again on the next round
      return !this.failed;
    } catch (e) { this.relay.fail('Automatic sheet update failed: ' + String(e.message || e).slice(0, 140)); this.lastGv = -1; return false; }
    finally { this.running = false; }
  }
}
module.exports = { SheetSync };
