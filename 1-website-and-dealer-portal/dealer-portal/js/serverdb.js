/* S-ELEVEN secure mode, part 2 (loads right after db.js).
   Every function of the data layer keeps working for the screens. Reading uses the local read-only copy. As soon as a call would CHANGE data,
   it is discarded locally and sent to the server instead; the server decides, applies it as the signed-in person, and sends back the result. */
(function () {
  'use strict';
  if (!window.SEL_SERVER || !window.DB) return;
  var S = window.SelServer, DB = window.DB, RAW = {}, depth = 0, PFX = 'sel.v2.';
  var NOOP = { stageEvents: 1, reconcileAttendance: 1, releaseSlips: 1, expirePreorders: 1, portalSeen: 1, portalLogin: 1, portalLogout: 1, portalClosing: 1, portalResume: 1 };   // the server does these itself
  function note(msg) { try { var n = document.getElementById('sel-srv-note'); if (!n) { n = document.createElement('div'); n.id = 'sel-srv-note'; n.setAttribute('role', 'alert'); n.style.cssText = 'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);background:#171a3a;color:#fff;padding:10px 16px;border-radius:12px;z-index:9999;max-width:90vw;font:600 14px system-ui'; document.body.appendChild(n); } n.textContent = msg; n.style.display = 'block'; clearTimeout(n._t); n._t = setTimeout(function () { n.style.display = 'none'; }, 4000); } catch (e) {} }
  function expired() { S.reset(); S.identity(); note('Your session has ended. Please sign in again.'); setTimeout(function () { location.reload(); }, 600); }
  var lastPull = 0;
  function pullNow() { var r = S.xhr('GET', '/api/state?since=' + S.ver); if (r.status === 200 && r.json) return S.apply(r.json); if (r.status === 401) expired(); return false; }
  function remote(name, args) {
    var clean; try { clean = JSON.parse(JSON.stringify(args, function (k, v) { return v === undefined ? null : v; })); } catch (e) { return { error: 'That could not be sent.' }; }
    var r = S.xhr('POST', '/api/rpc', { fn: name, args: clean, since: S.ver });
    if (r.status === 200 && r.json) { S.apply(r.json.state); if (r.json.ok === false) return { error: r.json.error || 'Not done.' }; return r.json.result === undefined ? null : r.json.result; }
    if (r.status === 401) { expired(); return { error: 'Please sign in again.' }; }
    if (r.status === 403) { var m = (r.json && r.json.error) || 'You are not allowed to do that.'; note(m); return { error: m }; }
    if (r.status === 429) { note('Too many requests. Wait a moment.'); return { error: 'Too many requests. Wait a moment.' }; }
    note('The server could not be reached. Try again.'); return { error: 'The server could not be reached. Try again.' };
  }
  Object.keys(DB).forEach(function (name) {
    var f = DB[name]; if (typeof f !== 'function') return; RAW[name] = f;
    DB[name] = function () {
      if (depth > 0) return f.apply(DB, arguments);                                       // a function calling another inside the data layer
      if (NOOP[name]) return undefined;
      var args = Array.prototype.slice.call(arguments), changed = false, res, err = null, tries = 0;
      for (;;) {
        err = null; depth++; var ov = S.begin();
        try { res = f.apply(DB, args); } catch (e) { err = e; } finally { depth--; changed = ov.size > 0; S.end(); }
        /* the local copy may be a few seconds behind: before refusing, fetch the latest and try once more */
        if (!changed && !err && res && typeof res === 'object' && res.error && tries === 0 && S.me && Date.now() - lastPull > 1500) { tries++; lastPull = Date.now(); if (pullNow()) continue; }
        break;
      }
      if (err) throw err; if (!changed) return res;                                        // only read: answer from the local copy
      var out = remote(name, args);
      if (name === 'addOrder' && out && out.id && args[1] && typeof args[1] === 'object') { try { Object.keys(out).forEach(function (k) { args[1][k] = out[k]; }); } catch (e) {} }   // the screen keeps using the order the SERVER created
      return out;
    };
  });
  /* never available in secure mode */
  ['eraseAll', 'loadDemo', 'resetDemo'].forEach(function (n) { DB[n] = function () { return { error: 'Not available.' }; }; });
  DB.dealerLoginInfo = function () { return null; };                                       // passwords can never be read back
  /* sign-in */
  var memo = null;
  function afterLogin(r, kind, code, pw) {
    if (r.status === 200 && r.json && r.json.ok) { S.reset(); S.me = r.json.me; S.csrf = S.me.csrf; S.apply(r.json.state); S.identity(); S.lastLogin = null; memo = null; return true; }
    var e = (r.json && r.json.error) || (r.status === 429 ? 'toomany' : 'invalid'); S.lastLogin = { error: e, retryAfterSec: (r.json && r.json.retryAfterSec) || 0 }; memo = { k: kind + '|' + String(code).toUpperCase() + '|' + pw, status: e === 'inactive' ? 'inactive' : (e === 'locked' || e === 'toomany') ? 'locked' : 'invalid', at: Date.now() }; return false;
  }
  S.loginMessage = function () { var l = S.lastLogin; if (!l) return ''; if (l.error === 'locked') return 'Too many wrong attempts. This account is locked for ' + Math.max(1, Math.ceil(l.retryAfterSec / 60)) + ' minute(s).'; if (l.error === 'toomany') return 'Too many sign-in attempts from this device. Please wait a few minutes.'; return ''; };
  DB.verifyStaff = function (code, pw) {
    var r = S.xhr('POST', '/api/login', { kind: 'staff', code: String(code || ''), password: String(pw || '') });
    if (r.status === 200 && r.json && r.json.need2fa) return { tfa2: true, mode: r.json.need2fa, pending: r.json.pending, secret: r.json.secret || '', uri: r.json.uri || '', name: r.json.name || '', code: String(code || '').toUpperCase() };   /* password accepted: the code from Google Authenticator comes next */
    return afterLogin(r, 'staff', code, pw) ? { code: S.me.code, role: S.me.role, dept: S.me.dept, name: S.me.name } : null;
  };
  /* the code is sent and checked in this one request: the answer is immediate */
  DB.verifyStaff2fa = function (pending, token) {
    var r = S.xhr('POST', '/api/login2fa', { pending: String(pending || ''), code: String(token || '') });
    if (afterLogin(r, 'staff', '', '')) return { code: S.me.code, role: S.me.role, dept: S.me.dept, name: S.me.name };
    var j = r.json || {}, e = j.error;
    if (e === 'invalid_code') return { error: 'That code is not right.' + (typeof j.left === 'number' ? ' ' + j.left + ' attempt' + (j.left === 1 ? '' : 's') + ' left.' : ''), restart: j.left === 0 };
    if (e === 'expired') return { error: 'This sign-in expired. Please start again with your password.', restart: true };
    if (e === 'locked') return { error: 'Too many wrong attempts. This account is locked for ' + Math.max(1, Math.ceil((j.retryAfterSec || 60) / 60)) + ' minute(s).', restart: true };
    if (e === 'toomany') return { error: 'Too many attempts from this device. Please wait a few minutes.', restart: true };
    return { error: 'The code could not be checked. Try again.' };
  };
  /* the Host's Security page */
  DB.securityInfo = function () { var r = S.xhr('GET', '/api/security'); return r.status === 200 && r.json ? r.json : null; };
  DB.securityPolicy = function (dept, required) { var r = S.xhr('POST', '/api/security', { action: 'policy', dept: dept, required: !!required }, S.csrf); return r.status === 200; };
  DB.securityPolicyAll = function (on) { var r = S.xhr('POST', '/api/security', { action: 'policy', all: !!on }, S.csrf); return r.status === 200; };
  DB.securityReset = function (code) { var r = S.xhr('POST', '/api/security', { action: 'reset', code: String(code || '') }, S.csrf); return r.status === 200; };
  DB.verifyDealer = function (code, pw) { var r = S.xhr('POST', '/api/login', { kind: 'dealer', code: String(code || ''), password: String(pw || '') }); return afterLogin(r, 'dealer', code, pw) ? DB.getDealer(S.me.code) : null; };
  DB.dealerLoginStatus = function (code, pw) { return memo && memo.k === 'dealer|' + String(code).toUpperCase() + '|' + pw && Date.now() - memo.at < 15000 ? memo.status : 'invalid'; };
  /* sign-out: end the server session, then forget everything */
  document.addEventListener('click', function (e) { var t = e.target && e.target.closest && e.target.closest('[data-act="logout"],[data-a="logout"]'); if (!t || !S.me) return; S.xhr('POST', '/api/logout', {}); S.reset(); S.identity(); }, true);
  /* closing the tab: tell the server (attendance ends at once; a reload within 30 seconds puts it straight back) */
  window.addEventListener('pagehide', function () { if (S.me && S.csrf && navigator.sendBeacon) { try { navigator.sendBeacon('/api/closing', new Blob([JSON.stringify({ csrf: S.csrf })], { type: 'text/plain;charset=UTF-8' })); } catch (e) {} } });
  /* keep the local copy current: poll for changes, and refresh the screen when it is safe (no pop-up open, no one typing) */
  var pending = false;
  function safe() { var a = document.activeElement; return !document.querySelector('.overlay, .modal, #amodal, #gw, details.order[open], details[open] input, details[open] textarea') && !(a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)); }
  function refresh() { if (!S.me) return; if (safe()) { pending = false; try { window.dispatchEvent(new HashChangeEvent('hashchange')); } catch (e) {} } else pending = true; }
  function poll() {
    if (!S.me || document.hidden && false) return; var x = new XMLHttpRequest(); x.open('GET', '/api/state?since=' + S.ver); x.onload = function () { if (x.status === 401) { expired(); return; } if (x.status !== 200) return; try { if (S.apply(JSON.parse(x.responseText))) refresh(); } catch (e) {} }; x.send();
  }
  setInterval(poll, 10000); setInterval(function () { if (pending) refresh(); }, 3000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) poll(); });
})();
