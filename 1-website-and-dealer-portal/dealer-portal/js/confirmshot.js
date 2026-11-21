/* ============================================================================
   ConfirmShot — "shoot the file through the hoop" confirmation gate.
   An employee must drag the ball and swish it through the basketball hoop
   before a file upload or a delete goes through. Vanilla JS, no dependencies.

     ConfirmShot.upload({ fileName })  -> Promise  (resolve on a swish, reject on cancel)
     ConfirmShot.delete({ fileName })  -> Promise

   Reject reason is 'cancelled'. Safe to call repeatedly; only one gate at a time.
   ========================================================================== */
(function () {
  'use strict';
  if (window.ConfirmShot) return;

  function injectCSS() {
    if (document.getElementById('cshot-css')) return;
    var s = document.createElement('style'); s.id = 'cshot-css';
    s.textContent = [
      '#cshot{position:fixed;inset:0;z-index:100050;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(1,60,88,.55);backdrop-filter:blur(2px);animation:cshotIn .18s ease}',
      '@keyframes cshotIn{from{opacity:0}to{opacity:1}}',
      '#cshot .cs-card{background:#fff;color:#013C58;border-radius:20px;width:100%;max-width:25rem;box-shadow:0 24px 70px rgba(0,0,0,.4);overflow:hidden;font-family:inherit}',
      '#cshot .cs-head{padding:16px 18px 10px;position:relative}',
      '#cshot .cs-head h3{margin:0;font-size:1.15rem;font-weight:800;letter-spacing:-.01em}',
      '#cshot .cs-head p{margin:3px 0 0;font-size:.82rem;color:#5a7384;word-break:break-all}',
      '#cshot .cs-x{position:absolute;top:12px;right:12px;width:30px;height:30px;border:none;border-radius:50%;background:#eef4f7;color:#013C58;font-size:1rem;cursor:pointer;line-height:1}',
      '#cshot .cs-x:hover{background:#dde8ee}',
      '#cshot .cs-court{position:relative;height:300px;margin:4px 14px 0;border-radius:16px;background:linear-gradient(180deg,#eaf6fb 0%,#dff0f8 60%,#d2e9f3 100%);overflow:hidden;touch-action:none;user-select:none}',
      '#cshot.del .cs-court{background:linear-gradient(180deg,#fdeeee 0%,#fbe3e3 60%,#f7d6d6 100%)}',
      '#cshot .cs-board{position:absolute;top:18px;left:50%;transform:translateX(-50%);width:120px;height:78px;border-radius:8px;background:#fff;border:3px solid #013C58;box-shadow:0 6px 16px rgba(1,60,88,.18)}',
      '#cshot .cs-board .cs-sq{position:absolute;left:50%;bottom:10px;transform:translateX(-50%);width:46px;height:34px;border:3px solid #F5A201}',
      '#cshot .cs-rim{position:absolute;top:92px;left:50%;transform:translateX(-50%);width:84px;height:16px;border:5px solid #F5A201;border-radius:50%;box-shadow:0 2px 0 rgba(0,0,0,.08);z-index:3}',
      '#cshot .cs-net{position:absolute;top:104px;left:50%;transform:translateX(-50%);z-index:2}',
      '#cshot .cs-hint{position:absolute;left:0;right:0;bottom:12px;text-align:center;font-size:.8rem;font-weight:600;color:#3f6075;pointer-events:none;transition:opacity .2s}',
      '#cshot.del .cs-hint{color:#9b3b3b}',
      '#cshot .cs-ball{position:absolute;width:62px;height:62px;border-radius:50%;cursor:grab;z-index:5;touch-action:none;background:radial-gradient(circle at 34% 30%,#ff9d4d,#e8731a 70%,#c85c10);box-shadow:inset -6px -8px 14px rgba(0,0,0,.28),0 8px 16px rgba(0,0,0,.25);display:flex;align-items:center;justify-content:center}',
      '#cshot .cs-ball:active{cursor:grabbing}',
      '#cshot .cs-ball svg{width:26px;height:26px;opacity:.92;filter:drop-shadow(0 1px 1px rgba(0,0,0,.25))}',
      '#cshot .cs-ball .cs-seam{position:absolute;inset:0;border-radius:50%;pointer-events:none}',
      '#cshot .cs-score{position:absolute;top:120px;left:50%;transform:translateX(-50%);font-weight:900;font-size:1.6rem;color:#1a8f4a;opacity:0;z-index:7;pointer-events:none}',
      '#cshot.del .cs-score{color:#c0392b}',
      '@keyframes csScore{0%{opacity:0;transform:translateX(-50%) translateY(6px) scale(.6)}30%{opacity:1}100%{opacity:0;transform:translateX(-50%) translateY(-46px) scale(1.1)}}',
      '#cshot .cs-foot{padding:12px 18px 16px;display:flex;align-items:center;gap:10px;justify-content:space-between}',
      '#cshot .cs-status{font-size:.9rem;font-weight:700;display:flex;align-items:center;gap:7px}',
      '#cshot .cs-status .cs-dot{width:9px;height:9px;border-radius:50%;background:#c9d6de}',
      '#cshot .cs-status.ok{color:#1a8f4a}#cshot .cs-status.ok .cs-dot{background:#1a8f4a}',
      '#cshot.del .cs-status.ok{color:#c0392b}#cshot.del .cs-status.ok .cs-dot{background:#c0392b}',
      '#cshot .cs-cancel{border:2px solid #cfdbe3;background:#fff;color:#45627a;font:inherit;font-weight:700;border-radius:99px;padding:8px 18px;cursor:pointer}',
      '#cshot .cs-cancel:hover{background:#f3f7f9}',
      '#cshot .cs-net-strand{stroke:#9fb4c0;stroke-width:1.5;fill:none}',
      '#cshot .cs-done .cs-ball,#cshot .cs-done .cs-hint{display:none}'
    ].join('');
    document.head.appendChild(s);
  }

  var FILE_SVG = '<svg viewBox="0 0 24 24" fill="none"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5z" fill="#fff"/><path d="M14 3v5h5" stroke="#e8731a" stroke-width="1.6" fill="none"/></svg>';
  var TRASH_SVG = '<svg viewBox="0 0 24 24" fill="none"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m2 0v12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V7" stroke="#fff" stroke-width="1.7"/></svg>';

  function netSVG() {
    // simple basketball net drawn as crossing strands
    var w = 84, strands = '', i, top = 0, botY = 42, cols = 7;
    for (i = 0; i <= cols; i++) {
      var x = (i / cols) * w, bx = w / 2 + (x - w / 2) * 0.42;
      strands += '<path class="cs-net-strand" d="M' + x.toFixed(1) + ',0 L' + bx.toFixed(1) + ',' + botY + '"/>';
    }
    for (i = 0; i < 4; i++) {
      var y = (i + 1) / 5 * botY, sh = w * (1 - (i + 1) / 5 * 0.58), x0 = (w - sh) / 2;
      strands += '<path class="cs-net-strand" d="M' + x0.toFixed(1) + ',' + y.toFixed(1) + ' Q' + (w / 2) + ',' + (y + 5).toFixed(1) + ' ' + (x0 + sh).toFixed(1) + ',' + y.toFixed(1) + '"/>';
    }
    return '<svg width="' + w + '" height="' + (botY + 2) + '" viewBox="0 0 ' + w + ' ' + (botY + 2) + '">' + strands + '</svg>';
  }

  function run(kind, opts) {
    opts = opts || {};
    injectCSS();
    var isDel = kind === 'delete';
    var fileName = opts.fileName || (isDel ? 'this file' : 'your file');
    var title = isDel ? 'Confirm delete' : 'Confirm upload';
    var verb = isDel ? 'remove' : 'upload';
    var doneWord = isDel ? 'Deleted' : 'Uploaded';

    return new Promise(function (resolve, reject) {
      var ov = document.createElement('div'); ov.id = 'cshot'; if (isDel) ov.className = 'del';
      ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-label', title);
      ov.innerHTML =
        '<div class="cs-card">' +
          '<div class="cs-head"><h3>' + title + '</h3><p>Shoot <b>' + esc(fileName) + '</b> through the hoop to ' + verb + ' it.</p>' +
            '<button class="cs-x" type="button" aria-label="Cancel">✕</button></div>' +
          '<div class="cs-court">' +
            '<div class="cs-board"><div class="cs-sq"></div></div>' +
            '<div class="cs-rim"></div>' +
            '<div class="cs-net">' + netSVG() + '</div>' +
            '<div class="cs-score">+1</div>' +
            '<div class="cs-ball">' + (isDel ? TRASH_SVG : FILE_SVG) + '<span class="cs-seam"></span></div>' +
            '<div class="cs-hint">Drag the ball up and release it in the hoop</div>' +
          '</div>' +
          '<div class="cs-foot"><span class="cs-status"><span class="cs-dot"></span>Waiting for your shot</span>' +
            '<button class="cs-cancel" type="button">Cancel</button></div>' +
        '</div>';
      document.body.appendChild(ov);

      var court = ov.querySelector('.cs-court'), ball = ov.querySelector('.cs-ball'),
          rim = ov.querySelector('.cs-rim'), status = ov.querySelector('.cs-status'),
          score = ov.querySelector('.cs-score'), hint = ov.querySelector('.cs-hint');
      var settled = false;

      // place ball at bottom-centre
      function reset() {
        var cw = court.clientWidth, ch = court.clientHeight;
        ball.style.left = (cw / 2 - 31) + 'px';
        ball.style.top = (ch - 74) + 'px';
        ball.style.transition = 'none';
      }
      requestAnimationFrame(reset);

      var drag = null;
      function onDown(e) {
        if (settled) return;
        e.preventDefault();
        var p = pt(e), r = ball.getBoundingClientRect();
        drag = { dx: p.x - r.left, dy: p.y - r.top, lastY: p.y, vy: 0, t: Date.now() };
        ball.style.transition = 'none';
        ball.setPointerCapture && e.pointerId != null && ball.setPointerCapture(e.pointerId);
        window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp);
        window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
        window.addEventListener('touchmove', onMove, { passive: false }); window.addEventListener('touchend', onUp);
      }
      function onMove(e) {
        if (!drag || settled) return; e.preventDefault();
        var p = pt(e), cr = court.getBoundingClientRect();
        var nx = p.x - cr.left - drag.dx, ny = p.y - cr.top - drag.dy;
        nx = Math.max(-6, Math.min(cr.width - 56, nx)); ny = Math.max(-10, Math.min(cr.height - 56, ny));
        ball.style.left = nx + 'px'; ball.style.top = ny + 'px';
        var now = Date.now(); drag.vy = (p.y - drag.lastY); drag.lastY = p.y; drag.t = now;
      }
      function onUp() {
        if (!drag || settled) return;
        window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp);
        window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp);
        window.removeEventListener('touchmove', onMove); window.removeEventListener('touchend', onUp);
        var cr = court.getBoundingClientRect(), rr = rim.getBoundingClientRect();
        var bc = ball.getBoundingClientRect();
        var ballCx = bc.left + bc.width / 2, ballCy = bc.top + bc.height / 2;
        var rimCx = rr.left + rr.width / 2, rimCy = rr.top + rr.height / 2;
        var overRim = Math.abs(ballCx - rimCx) < rr.width * 0.72;
        var highEnough = ballCy < rimCy + 46;            // dragged up near/above the rim
        drag = null;
        if (overRim && highEnough) swish(rimCx - cr.left, rimCy - cr.top); else missBack();
      }
      ball.addEventListener('pointerdown', onDown);
      ball.addEventListener('mousedown', onDown);
      ball.addEventListener('touchstart', onDown, { passive: false });

      function missBack() {
        status.textContent = 'Missed — try again'; status.className = 'cs-status';
        status.insertBefore(dot(), status.firstChild);
        ball.style.transition = 'left .45s cubic-bezier(.34,1.3,.5,1),top .55s cubic-bezier(.5,.1,.3,1)';
        reset.call(); requestAnimationFrame(function () { var cw = court.clientWidth, ch = court.clientHeight; ball.style.left = (cw / 2 - 31) + 'px'; ball.style.top = (ch - 74) + 'px'; });
      }

      function swish(rx, ry) {
        settled = true;
        hint.style.opacity = '0';
        // arc the ball to the rim centre, then drop it through the net
        ball.style.transition = 'left .22s ease-out,top .22s ease-out,transform .22s ease-out';
        ball.style.left = (rx - 31) + 'px'; ball.style.top = (ry - 31) + 'px'; ball.style.transform = 'scale(.82)';
        score.style.animation = 'csScore 1s ease forwards';
        setTimeout(function () {
          ball.style.transition = 'top .5s cubic-bezier(.5,.05,.6,1),opacity .5s ease,transform .5s ease';
          ball.style.top = (court.clientHeight + 30) + 'px'; ball.style.opacity = '0'; ball.style.transform = 'scale(.6)';
        }, 220);
        // net swish nudge
        var net = ov.querySelector('.cs-net'); if (net) { net.style.transition = 'transform .18s ease'; net.style.transform = 'translateX(-50%) scaleY(1.22)'; setTimeout(function () { net.style.transform = 'translateX(-50%) scaleY(1)'; }, 220); }
        status.innerHTML = ''; status.appendChild(dot()); status.appendChild(document.createTextNode(doneWord + ' ✓')); status.className = 'cs-status ok';
        ov.classList.add('cs-done');
        setTimeout(function () { close(); resolve(true); }, 760);
      }

      function dot() { var d = document.createElement('span'); d.className = 'cs-dot'; return d; }

      function cancel() { if (settled) return; settled = true; close(); var err = new Error('cancelled'); err.cancelled = true; reject(err); }
      function close() { ov.style.animation = 'cshotIn .15s ease reverse'; setTimeout(function () { ov.remove(); }, 140); document.removeEventListener('keydown', onKey); }
      function onKey(ev) { if (ev.key === 'Escape') cancel(); }
      ov.querySelector('.cs-x').addEventListener('click', cancel);
      ov.querySelector('.cs-cancel').addEventListener('click', cancel);
      ov.addEventListener('mousedown', function (ev) { if (ev.target === ov) cancel(); });
      document.addEventListener('keydown', onKey);
      window.addEventListener('resize', function r2() { if (settled) { window.removeEventListener('resize', r2); return; } reset(); });
    });
  }

  function pt(e) { if (e.touches && e.touches[0]) return { x: e.touches[0].clientX, y: e.touches[0].clientY }; if (e.changedTouches && e.changedTouches[0]) return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY }; return { x: e.clientX, y: e.clientY }; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  window.ConfirmShot = {
    upload: function (o) { return run('upload', o); },
    delete: function (o) { return run('delete', o); },
    /* convenience: wrap a plain confirm() style flow */
    gate: function (kind, o) { return run(kind === 'delete' ? 'delete' : 'upload', o); }
  };
})();
