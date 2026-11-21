'use strict';
/* The engine runs the portal's own business logic (data.js + db.js) on the server, against server-held data.
   A call never touches real data directly: it works on an overlay that is committed only if the call succeeds and is saved. */
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const PFX = 'sel.v2.';
const TRANSIENT = new Set([PFX + 'busy', PFX + 'epoch']);

class Engine {
  constructor(portalDir, kv, gv) {
    this.state = new Map(); this.ver = new Map(); this.dead = new Map(); this.gv = gv || 0; this.overlay = null;
    for (const [k, x] of kv) { this.state.set(k, x.v); this.ver.set(k, x.ver); }
    this._boot(portalDir);
  }
  _read(k) { if (this.overlay && this.overlay.has(k)) return this.overlay.get(k); return this.state.has(k) ? this.state.get(k) : null; }
  _boot(dir) {
    const self = this, g = {};
    g.window = g; g.document = {}; g.SEL_ENGINE = true; g.SEL_CONFIG = {}; g.console = console; g.setTimeout = () => 0; g.setInterval = () => 0; g.clearTimeout = () => {}; g.navigator = { userAgent: 'server' };
    g.atob = atob; g.btoa = btoa; g.TextEncoder = TextEncoder; g.TextDecoder = TextDecoder; g.URL = URL;     // browser functions the portal code expects (file-type checks use atob)
    g.sessionStorage = { getItem() { return null; }, setItem() {}, removeItem() {}, clear() {} };
    const keys = () => { const s = new Set(self.state.keys()); if (self.overlay) for (const [k, v] of self.overlay) { if (v === null) s.delete(k); else s.add(k); } return [...s]; };
    g.localStorage = new Proxy({
      getItem: k => self._read(k), setItem: (k, v) => { v = String(v); if (self.overlay) self.overlay.set(k, v); else self.state.set(k, v); },
      removeItem: k => { if (self.overlay) self.overlay.set(k, null); else self.state.delete(k); }, key: i => keys()[i] || null,
    }, { ownKeys: () => keys(), getOwnPropertyDescriptor: (t, k) => (typeof k === 'string' && keys().includes(k)) ? { enumerable: true, configurable: true, value: self._read(k) } : Object.getOwnPropertyDescriptor(t, k), get: (t, k) => (k in t) ? t[k] : (typeof k === 'string' ? self._read(k) : undefined) });
    vm.createContext(g); this.ctx = g;
    for (const f of ['data.js', 'db.js']) vm.runInContext(fs.readFileSync(path.join(dir, 'js', f), 'utf8'), g, { filename: f });
    vm.runInContext(`
      window.__call = function (fn, argsJson) { var args = JSON.parse(argsJson), f = DB[fn]; if (typeof f !== 'function') return JSON.stringify({ nofn: true }); var r = f.apply(DB, args); return JSON.stringify({ r: r === undefined ? null : r }); };
      window.__filterOrders = function (role, json) { var a = JSON.parse(json), out = []; for (var i = 0; i < a.length; i++) { if (DB.visibleTo(role, a[i])) out.push(a[i]); } return JSON.stringify(out); };
      window.__placeOrder = function (code, orderJson, actorJson, allowFreight) {
        var o = JSON.parse(orderJson), a = JSON.parse(actorJson), d = DB.getDealer(code);
        if (!d) return JSON.stringify({ error: 'Dealer not found.' });
        if (DB.isDealerActive && !DB.isDealerActive(code)) return JSON.stringify({ error: 'This dealer account is deactivated.' });
        var lines = [];
        (o.items || []).forEach(function (s) { var q = parseInt(s.qty, 10); if (!(q > 0) || q > 100000) return; var l = DB.__lineFor(d, String(s.pid), String(s.vid), s.flavour || '', q); if (!l) throw new Error('A product was not found.'); var ex = lines.filter(function (x) { return x.key === l.key; })[0]; if (ex) ex.qty += q; else lines.push(l); });
        if (!lines.length) return JSON.stringify({ error: 'The order has no valid items.' });
        var bad = DB.validateLines(lines); if (bad) return JSON.stringify({ error: bad });
        var sub = 0; lines.forEach(function (l) { sub += l.price * l.qty; });
        var cc = o.totals && o.totals.couponCode, cp = null; if (cc) { var vc = DB.validateCoupon(cc, lines, sub, d.category); if (vc && vc.coupon) cp = vc.coupon; }
        var addr = String(o.address || d.address || '').slice(0, 300), pin = String(o.pin || d.pincode || '').slice(0, 10), gst = String(o.gst || d.gst || '').slice(0, 20), phone = String(o.phone || d.phone || '').slice(0, 15);
        var gj = DB.isGujarat(addr, pin, gst), fp = (allowFreight && o.freightPolicy) ? { freightPolicy: { on: !!o.freightPolicy.on, amount: o.freightPolicy.amount == null ? null : Math.max(0, +o.freightPolicy.amount || 0) } } : null;
        var now = new Date().toISOString();
        var order = { id: DB.newOrderId(), date: now, status: 'Placed', payment: { method: String((o.payment && o.payment.method) || 'Pending').slice(0, 40), status: 'Pending', txn: '' }, items: lines, totals: null, address: addr, pin: pin, phone: phone, gst: gst, note: String(o.note || '').slice(0, 500), shipment: null, history: [{ status: 'Placed', at: now }], buyer: { name: d.name, gst: gst, address: d.address, pin: d.pincode, phone: d.phone }, ship: { address: addr, pin: pin, phone: phone }, createdBy: a };
        if (fp) order.freightPolicy = fp.freightPolicy;
        order.totals = DB.calcTotals(lines, cp, gj, DB.freightOpt(d, order));
        if (o.freebies && o.freebies.length) { var picks = o.freebies.map(function (f) { return { fid: f.fid || f.id, qty: f.qty }; }), fv = DB.validateFreebies(code, lines, cc || null, picks); if (fv && !fv.error && fv.list) { order.freebies = fv.list; order.freebieValue = fv.used; } }
        var ad = DB.addOrder(code, order); if (ad && ad.error) return JSON.stringify({ error: ad.error }); return JSON.stringify({ r: order });
      };
      window.__maskOrders = function (role, json) { var a = JSON.parse(json), out = []; for (var i = 0; i < a.length; i++) out.push(DB.maskOrderFor(role, a[i])); return JSON.stringify(out); };
      window.__sigs = function () { var o = {}; Object.keys(DB).forEach(function (k) { if (typeof DB[k] === 'function') { var m = DB[k].toString().match(/^function\\s*\\(([^)]*)\\)/); o[k] = m ? m[1].split(',').map(function (x) { return x.trim(); }).filter(Boolean) : []; } }); return JSON.stringify(o); };
    `, g);
    this.sigs = JSON.parse(this._run('__sigs()'));
    this.ROLE_OF = JSON.parse(this._run('JSON.stringify(DB.ROLE_OF)'));
    this.DEPTS = JSON.parse(this._run('JSON.stringify(DB.DEPTS || {})'));
  }
  _run(code, ms = 4000) { return vm.runInContext(code, this.ctx, { timeout: ms }); }
  /* run one operation. Returns the result and the changes it would make; nothing is committed here. */
  call(fn, args, { preset } = {}) {
    if (fn !== '__placeOrder' && !Object.prototype.hasOwnProperty.call(this.sigs, fn)) return { error: 'Unknown operation.', nofn: true };
    this.overlay = new Map(); if (preset) for (const [k, v] of Object.entries(preset)) this.overlay.set(k, v);
    try {
      this.ctx.__fn = fn; this.ctx.__args = JSON.stringify(args || []);
      const out = JSON.parse(this._run(fn === '__placeOrder' ? '__placeOrder.apply(null, JSON.parse(__args))' : '__call(__fn, __args)'));
      if (out.error) { this.overlay = null; return { error: out.error }; }
      const changes = this.overlay; this.overlay = null;
      for (const k of TRANSIENT) changes.delete(k);
      return { result: out.r, changes };
    } catch (e) { this.overlay = null; return { error: 'The operation failed: ' + String(e && e.message || e).slice(0, 160), threw: true }; }
  }
  /* read without any chance of changing data (changes made during the call are thrown away) */
  peek(fn, args) { const r = this.call(fn, args); return r.error ? r : { result: r.result }; }
  maskOrders(role, arr) { this.ctx.__r = role; this.ctx.__j = JSON.stringify(arr); return JSON.parse(this._run('__maskOrders(__r, __j)')); }
  filterOrders(role, arr) { this.ctx.__r = role; this.ctx.__j = JSON.stringify(arr); return JSON.parse(this._run('__filterOrders(__r, __j)')); }
  get(k) { const v = this.state.get(PFX + k); if (v === undefined) return null; try { return JSON.parse(v); } catch (e) { return null; } }
  keys() { return [...this.state.keys()]; }
  /* take passwords out of the data: returns the plain passwords to be hashed. Data never keeps a password. */
  extractSecrets(changes, all) {
    const found = [], view = k => changes.has(k) ? changes.get(k) : (this.state.has(k) ? this.state.get(k) : null);
    for (const [key, kind] of [[PFX + 'dealers', 'dealer'], [PFX + 'employees', 'staff']]) {
      if (!all && !changes.has(key)) continue; const raw = view(key); if (!raw) continue; let arr; try { arr = JSON.parse(raw); } catch (e) { continue; } let dirty = false;
      for (const rec of arr) {
        if (!rec || typeof rec !== 'object' || !('password' in rec)) continue;
        if (typeof rec.password === 'string' && rec.password) found.push({ kind, code: kind === 'dealer' ? rec.code : rec.id, plain: rec.password });
        delete rec.password; dirty = true;
      }
      if (dirty) changes.set(key, JSON.stringify(arr));
    }
    return found;
  }
  /* turn changes into versioned rows to save; call apply() once they are saved */
  prepare(changes) { let v = this.gv; const rows = []; for (const [k, val] of changes) { const cur = this.state.has(k) ? this.state.get(k) : null; if (cur === val) continue; v += 1; rows.push({ k, v: val, ver: v }); } return { rows, gv: v }; }
  apply(rows, gv) { for (const r of rows) { if (r.v === null) { this.state.delete(r.k); this.ver.delete(r.k); this.dead.set(r.k, r.ver); } else { this.state.set(r.k, r.v); this.ver.set(r.k, r.ver); this.dead.delete(r.k); } } this.gv = gv; if (this.dead.size > 5000) this.dead.clear(); }
}
module.exports = { Engine, PFX };
