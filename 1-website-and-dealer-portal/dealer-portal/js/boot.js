/* S-ELEVEN secure mode, part 1 (must load before db.js).
   When the portal is served by the S-ELEVEN secure server, this file turns the browser into a thin client:
   - the signed-in person comes from the server's session cookie (anything written into browser storage is overwritten here);
   - the browser holds only a read-only, in-memory copy of the data THIS person may see (no passwords, nobody else's dealer data);
   - nothing is kept on disk for the data. Opened as a plain file (demo), none of this runs and the demo works exactly as before. */
(function () {
  'use strict';
  try { var me0 = document.currentScript; if (me0 && me0.getAttribute('data-base')) window.SEL_BASE = me0.getAttribute('data-base'); } catch (e) {}
  if (!/^https?:$/.test(location.protocol)) return;
  function xhr(method, url, body, csrf) {
    var x = new XMLHttpRequest(); x.open(method, url, false); x.setRequestHeader('Accept', 'application/json');
    if (body !== undefined) x.setRequestHeader('Content-Type', 'application/json'); if (csrf) x.setRequestHeader('X-CSRF-Token', csrf);
    try { x.send(body === undefined ? null : JSON.stringify(body)); } catch (e) { return { status: 0, json: null }; }
    var j = null; try { j = JSON.parse(x.responseText); } catch (e) {} return { status: x.status, json: j, retry: x.getResponseHeader('Retry-After') };
  }
  var ping = xhr('GET', '/api/ping'); if (ping.status !== 200 || !ping.json || ping.json.server !== true) return;     // not the secure server: demo mode
  window.SEL_SERVER = true;
  window.SEL_DEMO = !!ping.json.demo;   /* a real installation shows no TEST MODE bar */
  if (!window.SEL_DEMO) { var hideDemo = function () { [].forEach.call(document.querySelectorAll('.demo[role="note"]'), function (e) { e.remove(); }); }; if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hideDemo); else hideDemo(); }
  var PFX = 'sel.v2.', M = {}, overlay = null;
  var core = {
    getItem: function (k) { if (overlay && overlay.has(k)) return overlay.get(k); return Object.prototype.hasOwnProperty.call(M, k) ? M[k] : null; },
    setItem: function (k, v) { if (overlay) overlay.set(k, String(v)); },            // outside a recorded operation nothing may change data
    removeItem: function (k) { if (overlay) overlay.set(k, null); },
    key: function (i) { return Object.keys(M)[i] || null; }
  };
  var keys = function () { var s = Object.keys(M); if (overlay) overlay.forEach(function (v, k) { var i = s.indexOf(k); if (v === null && i > -1) s.splice(i, 1); else if (v !== null && i < 0) s.push(k); }); return s; };
  window.SelStore = new Proxy(core, { ownKeys: keys, getOwnPropertyDescriptor: function (t, k) { return keys().indexOf(k) > -1 ? { enumerable: true, configurable: true, value: core.getItem(k) } : Object.getOwnPropertyDescriptor(t, k); }, get: function (t, k) { return (k in t) ? t[k] : (typeof k === 'string' ? core.getItem(k) : undefined); } });
  var S = window.SelServer = { me: null, csrf: '', ver: 0, lastLogin: null, M: M, xhr: function (m, u, b) { return xhr(m, u, b, m === 'GET' ? '' : S.csrf); },
    begin: function () { overlay = new Map(); return overlay; }, end: function () { var o = overlay; overlay = null; return o; },
    /* take in what the server sent; returns true when something changed */
    apply: function (st) { if (!st) return false; var ch = false, k; if (st.set) for (k in st.set) { M[PFX + k] = st.set[k]; ch = true; } if (st.del) st.del.forEach(function (n) { if (M[PFX + n] !== undefined) { delete M[PFX + n]; ch = true; } }); if (typeof st.ver === 'number') S.ver = st.ver; return ch; },
    reset: function () { Object.keys(M).forEach(function (k) { delete M[k]; }); S.ver = 0; S.me = null; S.csrf = ''; },
    identity: function () { try { sessionStorage.removeItem(PFX + 'staff'); sessionStorage.removeItem(PFX + 'dealer'); if (S.me) { if (S.me.kind === 'staff') sessionStorage.setItem(PFX + 'staff', JSON.stringify({ code: S.me.code, role: S.me.role, dept: S.me.dept, name: S.me.name, tfa: true })); else sessionStorage.setItem(PFX + 'dealer', S.me.code); } } catch (e) {} } };
  var me = xhr('GET', '/api/me');
  if (me.status === 200 && me.json && me.json.signedIn) { S.me = me.json.me; S.csrf = S.me.csrf; S.apply(me.json.state); }
  S.identity();                                   // forged browser values are overwritten with what the server knows
})();
