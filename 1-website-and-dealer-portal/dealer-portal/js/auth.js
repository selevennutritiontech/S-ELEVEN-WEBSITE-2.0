/* S-ELEVEN staff sign-in: password + Google Authenticator (TOTP, RFC 6238). Used by the Employee Portal and the Admin Console.
   DEMO: the authenticator secret is kept in this browser. In the live platform it is stored encrypted on the server and verification happens there. */
(function () {
  'use strict';
  var KEY = 'sel.v2.tfa', SESSION = 'sel.v2.staff', B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  function sha1(bytes) {
    var h0 = 0x67452301, h1 = 0xEFCDAB89, h2 = 0x98BADCFE, h3 = 0x10325476, h4 = 0xC3D2E1F0, ml = bytes.length * 8, n = ((bytes.length + 9 + 63) >> 6) << 6, m = new Uint8Array(n);
    m.set(bytes); m[bytes.length] = 0x80; var dv = new DataView(m.buffer); dv.setUint32(n - 4, ml >>> 0); dv.setUint32(n - 8, Math.floor(ml / 4294967296)); var w = new Uint32Array(80), i, j;
    for (i = 0; i < n; i += 64) {
      for (j = 0; j < 16; j++) w[j] = dv.getUint32(i + j * 4); for (j = 16; j < 80; j++) { var x = w[j - 3] ^ w[j - 8] ^ w[j - 14] ^ w[j - 16]; w[j] = (x << 1) | (x >>> 31); }
      var a = h0, b = h1, c = h2, d = h3, e = h4;
      for (j = 0; j < 80; j++) { var f, k; if (j < 20) { f = (b & c) | (~b & d); k = 0x5A827999; } else if (j < 40) { f = b ^ c ^ d; k = 0x6ED9EBA1; } else if (j < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8F1BBCDC; } else { f = b ^ c ^ d; k = 0xCA62C1D6; }
        var t = (((a << 5) | (a >>> 27)) + f + e + k + w[j]) >>> 0; e = d; d = c; c = ((b << 30) | (b >>> 2)) >>> 0; b = a; a = t; }
      h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
    }
    var out = new Uint8Array(20), o = new DataView(out.buffer); o.setUint32(0, h0); o.setUint32(4, h1); o.setUint32(8, h2); o.setUint32(12, h3); o.setUint32(16, h4); return out;
  }
  function hmac(key, msg) { if (key.length > 64) key = sha1(key); var k = new Uint8Array(64); k.set(key); var ip = new Uint8Array(64 + msg.length), op = new Uint8Array(84), i; for (i = 0; i < 64; i++) { ip[i] = k[i] ^ 0x36; op[i] = k[i] ^ 0x5c; } ip.set(msg, 64); op.set(sha1(ip), 64); return sha1(op); }
  function b32dec(s) { s = String(s).replace(/[\s=-]/g, '').toUpperCase(); var bits = 0, val = 0, out = []; for (var i = 0; i < s.length; i++) { var x = B32.indexOf(s[i]); if (x < 0) continue; val = (val << 5) | x; bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } } return new Uint8Array(out); }
  function b32enc(bytes) { var bits = 0, val = 0, out = ''; for (var i = 0; i < bytes.length; i++) { val = (val << 8) | bytes[i]; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } } if (bits > 0) out += B32[(val << (5 - bits)) & 31]; return out; }
  function hotp(secret, counter) { var msg = new Uint8Array(8), dv = new DataView(msg.buffer); dv.setUint32(0, Math.floor(counter / 4294967296)); dv.setUint32(4, counter >>> 0); var h = hmac(b32dec(secret), msg), off = h[19] & 15, bin = ((h[off] & 127) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3]; return ('000000' + (bin % 1000000)).slice(-6); }
  function totp(secret, ms) { return hotp(secret, Math.floor((ms == null ? Date.now() : ms) / 30000)); }
  function load() { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; } }
  function save(o) { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) {} }
  /* which departments need Google Authenticator in this browser (demo): the Host's choice, else SEL_CONFIG.REQUIRE_2FA */
  var PKEY = 'sel.v2.tfapolicy';
  function policy() { try { return JSON.parse(localStorage.getItem(PKEY) || 'null') || {}; } catch (e) { return {}; } }
  function required(dept) { var p = policy(); if (Object.prototype.hasOwnProperty.call(p, dept)) return !!p[dept]; return !!(window.SEL_CONFIG && window.SEL_CONFIG.REQUIRE_2FA === true); }
  function setPolicy(dept, on) { var p = policy(); p[dept] = !!on; try { localStorage.setItem(PKEY, JSON.stringify(p)); } catch (e) {} }
  function setPolicyAll(depts, on) { var p = policy(); depts.forEach(function (d) { p[d] = !!on; }); try { localStorage.setItem(PKEY, JSON.stringify(p)); } catch (e) {} }
  function newSecret() { var b = new Uint8Array(20); (window.crypto || window.msCrypto).getRandomValues(b); return b32enc(b); }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  /* verifies a 6-digit code (current step +/- 1), refuses a code that was already used, and locks the account for 5 minutes after 5 wrong tries */
  function verify(code, token, secret) {
    var all = load(), r = all[code] || {}, now = Date.now(); if (r.lockUntil && now < r.lockUntil) return { error: 'Too many wrong codes. Try again in ' + Math.ceil((r.lockUntil - now) / 60000) + ' minute(s).' };
    token = String(token || '').replace(/\s/g, ''); var step = Math.floor(now / 30000), hit = null, sec = secret || r.secret;
    if (/^\d{6}$/.test(token)) for (var d = -1; d <= 1; d++) if (hotp(sec, step + d) === token) hit = step + d;
    if (hit === null || (r.last && hit <= r.last)) { r.fails = (r.fails || 0) + 1; var locked = false; if (r.fails >= 5) { r.lockUntil = now + 300000; r.fails = 0; locked = true; } all[code] = r; save(all); if (locked) return { error: 'Too many wrong codes. Try again in 5 minute(s).' }; return { error: hit !== null ? 'That code was already used. Wait for the next one.' : 'That code is not correct. Check the time on your phone.' }; }
    r.last = hit; r.fails = 0; r.lockUntil = 0; if (secret) r.secret = secret; all[code] = r; save(all); return { ok: true };
  }
  function uri(code, secret) { return 'otpauth://totp/S-ELEVEN:' + encodeURIComponent(code) + '?secret=' + secret + '&issuer=S-ELEVEN&algorithm=SHA1&digits=6&period=30'; }
  function qrSvg(text) { if (!window.qrcode) return ''; var q = window.qrcode(0, 'M'); q.addData(text); q.make(); return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true }); }
  function finish(s, cb) { s.tfa = true; try { sessionStorage.setItem(SESSION, JSON.stringify(s)); } catch (e) {} if (window.DB && DB.portalLogin) DB.portalLogin(s.code); if (window.DB && DB.notifyAction) DB.notifyAction(s.code, 'Signed in', s.name + ' signed in (' + (DB.DEPTS[s.dept] || s.role) + ')', 'signin'); cb(s); }
  /* renders the 3 steps into `root`: credentials -> (first time) scan QR + confirm -> code */
  function mount(root, cb, opts) {
    opts = opts || {}; var st = { step: 'cred', s: null, secret: null };
    function draw() {
      var h = '<div class="login-wrap" style="max-width:30rem;margin:0 auto"><section class="card login-card glass-login"><h1>' + esc(opts.title || 'Staff sign-in') + '</h1>';
      if (st.step === 'cred') h += '<p class="sub">' + 'Sign in with your user ID and password. If your department uses Google Authenticator, you will be asked for the 6-digit code next.' + '</p><form id="aForm" novalidate><div class="field"><label for="sc">User ID</label><input id="sc" autocomplete="username" autocapitalize="characters"></div><div class="field"><label for="sp">Password</label><input id="sp" type="password" autocomplete="current-password"></div><p class="err" id="aErr" role="alert"></p><button class="btn block" type="submit">Continue</button></form>' + (opts.hint || '');
      else if (st.step === 'enroll') h += '<p class="sub">Set up Google Authenticator (one time). Hello ' + esc(st.s.name) + '.</p><ol class="osm" style="margin:0 0 10px 18px"><li>Install <b>Google Authenticator</b> on your phone.</li><li>Tap <b>+</b> then <b>Scan a QR code</b> and scan this.</li><li>Type the 6-digit code it shows.</li></ol><div class="qrbox">' + qrSvg(uri(st.s.code, st.secret)) + '</div><p class="osm" style="text-align:center">Cannot scan? Enter this key in the app:<br><b class="tkey">' + st.secret.replace(/(.{4})/g, '$1 ').trim() + '</b></p><form id="aForm" novalidate><div class="field"><label for="ac">6-digit code</label><input id="ac" inputmode="numeric" maxlength="7" autocomplete="one-time-code"></div><p class="err" id="aErr" role="alert"></p><button class="btn block" type="submit">Confirm and sign in</button></form>';
      else h += '<p class="sub">Step 2 of 2: open Google Authenticator and enter the 6-digit code for <b>S-ELEVEN (' + esc(st.s.code) + ')</b>.</p><form id="aForm" novalidate><div class="field"><label for="ac">6-digit code</label><input id="ac" inputmode="numeric" maxlength="7" autocomplete="one-time-code"></div><p class="err" id="aErr" role="alert"></p><button class="btn block" type="submit">Sign in</button></form>';
      if (st.step !== 'cred') h += '<p style="text-align:center;margin-top:10px"><a href="#" id="aBack" class="rm">\u2190 Use a different account</a></p>';
      if (!window.SEL_SERVER && st.step === 'cred') h = h.replace('<form', '<p class="err" role="alert" style="margin:0 0 10px">Not connected to the S-ELEVEN secure server, so sign-in is unavailable. Open the portal from your company portal address.</p><form');
      h += '</section></div>'; root.innerHTML = h; var f = root.querySelector('#aForm'), er = root.querySelector('#aErr'), first = root.querySelector('input'); if (first) first.focus();
      var ac = root.querySelector('#ac'); if (ac) ac.addEventListener('input', function () { var v = ac.value.replace(/\D/g, '').slice(0, 6); if (ac.value !== v) ac.value = v; if (v.length === 6) f.dispatchEvent(new Event('submit', { cancelable: true })); });   /* the code is checked the moment the sixth digit is typed */
      var back = root.querySelector('#aBack'); if (back) back.addEventListener('click', function (e) { e.preventDefault(); st = { step: 'cred' }; draw(); });
      f.addEventListener('submit', function (e) {
        e.preventDefault();
        if (st.step === 'cred') { var s = DB.verifyStaff(root.querySelector('#sc').value, root.querySelector('#sp').value); if (!s) { er.textContent = (window.SelServer && SelServer.loginMessage && SelServer.loginMessage()) || 'Invalid user ID or password.'; return; } if (s.tfa2) { st.s = { code: s.code, name: s.name }; st.server = s; st.step = s.mode === 'enroll' ? 'enroll' : 'code'; st.secret = s.secret; draw(); return; }   /* secure build: the server asks for the code */
          st.s = s; if (!required(s.dept)) { finish(s, cb); return; } var rec = load()[s.code]; if (rec && rec.secret) st.step = 'code'; else { st.step = 'enroll'; st.secret = newSecret(); } draw(); return; }
        var tok = root.querySelector('#ac').value;
        if (st.server) { var sr = DB.verifyStaff2fa(st.server.pending, tok); if (sr.error) { er.textContent = sr.error; if (sr.restart) { st = { step: 'cred' }; setTimeout(draw, 1800); } else { root.querySelector('#ac').value = ''; root.querySelector('#ac').focus(); } return; } finish(sr, cb); return; }
        var r = verify(st.s.code, tok, st.step === 'enroll' ? st.secret : null); if (r.error) { er.textContent = r.error; root.querySelector('#ac').value = ''; root.querySelector('#ac').focus(); return; }
        if (st.step === 'enroll' && window.DB && DB.notifyAction) DB.notifyAction(st.s.code, 'Two-factor enabled', st.s.name + ' set up Google Authenticator', 'security'); finish(st.s, cb);
      });
    }
    draw();
  }
  window.Auth = { mount: mount, totp: totp, hotp: hotp, verify: verify, has: function (code) { return !!(load()[code] || {}).secret; }, required: required, setPolicy: setPolicy, setPolicyAll: setPolicyAll, reset: function (code) { var a = load(); delete a[code]; save(a); }, _sha1: sha1, _b32: b32enc, _b32d: b32dec, _secret: function (code) { return (load()[code] || {}).secret; } };
})();
