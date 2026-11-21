/* Eleven, the live bot. It floats and waves, looks toward your cursor, and flies to things on the screen to point them out
   (the menu, the alert bell, a button) with a short explanation. It can also give a tour of the menu. */
(function () {
  'use strict';
  var reduce = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches), ring = null, bubble = null, timer = null, lastAsk = 0, lastNav = 0, busy = false;
  var DESC = {
    overview: 'Your company at a glance: what needs attention, live activity and totals.', mydash: 'Your dashboard: today\u2019s work, targets and what to do next.', team: 'Your team: employees by department, their work and attendance.',
    dealers: 'Dealers: create dealers, set their prices, zone, category and freight.', inventory: 'Inventory: stock by flavour and pack, batches and expiry, and purchase bills.', posts: 'Posts: announcements and banners that dealers see.',
    logistics: 'Logistics: invoices, e-way bills, courier and tracking, and marking orders delivered.', warehouse: 'Warehouse: packing checklists and marking packed orders dispatched.', finance: 'Finance: payments, proofs, ledgers, credit notes and returns.',
    hr: 'HR: attendance, leave, salary, salary slips and allowances.', analytics: 'Analytics: charts and a performance report.', orders: 'Orders: pending orders, payments, edits and pushing orders to Logistics.',
    create: 'Create order: place an order for a dealer, with freight and freebies.', ledgers: 'Dealer ledgers: statements and balances.', offers: 'Offers: coupons, combos and sales.', freebies: 'Freebies: free items for qualifying orders.',
    preorders: 'Preorders: reserve items that are out of stock.', samples: 'Samples: sample orders and their packing.', mywork: 'My attendance: your calendar, salary slips and allowances.',
    returns: 'Returns: return requests, inward checks and credit notes.', rtoan: 'RTO analysis: returned goods and the GST on them.', incentives: 'Sales incentives: earnings against targets.', branding: 'Branding: design tasks and files.', it: 'IT: technical tasks.'
  };
  function fab() { return document.querySelector('.ai-fab'); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function trn(f) { var t = String(getComputedStyle(f).translate || '').split(' ').map(parseFloat); return { x: isNaN(t[0]) ? 0 : t[0], y: isNaN(t[1]) ? 0 : t[1] }; }
  function home(f) { var r = f.getBoundingClientRect(), t = trn(f); return { left: r.left - t.x, top: r.top - t.y, w: r.width, h: r.height }; }
  function visible(el) { var r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; }
  function label(a) { var n = a.querySelector && a.querySelector('.nl'); return (n || a).textContent.trim(); }
  function clear() { if (ring) { ring.remove(); ring = null; } if (bubble) { bubble.remove(); bubble = null; } clearTimeout(timer); }
  function goHome() { var f = fab(); clear(); if (f) { f.style.translate = ''; f.classList.remove('flying'); } busy = false; }
  function showBubble(text, o, br, side) {
    if (bubble) bubble.remove(); bubble = document.createElement('div'); bubble.className = 'bot-say'; bubble.setAttribute('role', 'status'); bubble.setAttribute('aria-live', 'polite');
    bubble.innerHTML = '<b>Eleven' + (o && o.step ? ' \u00B7 ' + esc(o.step) : '') + '</b><span>' + esc(text) + '</span>'; if (o && o.buttons) { var d = document.createElement('div'); d.className = 'bb'; o.buttons.forEach(function (b) { var x = document.createElement('button'); x.type = 'button'; x.textContent = b.label; if (b.ghost) x.className = 'ghost'; x.addEventListener('click', function (e) { e.stopPropagation(); b.fn(); }); d.appendChild(x); }); bubble.appendChild(d); }
    document.body.appendChild(bubble); var bw = bubble.offsetWidth, bh = bubble.offsetHeight, left, top;
    if (side === 'r') { left = br.right + 10; top = br.top + 8; } else { left = br.left - bw - 10; top = br.top + 8; }
    if (left + bw > innerWidth - 8) { left = Math.max(8, br.left - bw - 10); } if (left < 8) { left = Math.min(innerWidth - bw - 8, br.right + 10); if (left < 8) left = 8; if (br.top - bh - 8 > 70) { top = br.top - bh - 8; left = Math.max(8, Math.min(innerWidth - bw - 8, br.left)); } else { top = br.bottom + 8; } }
    top = Math.max(70, Math.min(innerHeight - bh - 8, top)); bubble.style.left = left + 'px'; bubble.style.top = top + 'px';
  }
  function fly(f, el, text, o) {
    var r = el.getBoundingClientRect(), h = home(f), bw = h.w, bh = h.h, bx, by, side;
    if (el.closest('.vnav') || r.left < bw + 24) { bx = r.right + 14; by = r.top + r.height / 2 - bh / 2; side = 'r'; } else if (r.width > innerWidth * 0.55) { bx = r.left + 24; by = r.bottom + 8; side = 'r'; } else { bx = r.left - bw - 10; by = r.top + r.height / 2 - bh / 2; side = 'l'; }
    bx = Math.max(6, Math.min(innerWidth - bw - 6, bx)); by = Math.max(70, Math.min(innerHeight - bh - 6, by));
    f.classList.add('flying'); f.style.translate = (bx - h.left) + 'px ' + (by - h.top) + 'px';
    ring = document.createElement('div'); ring.className = 'bot-ring'; ring.style.left = (r.left - 5) + 'px'; ring.style.top = (r.top - 5) + 'px'; ring.style.width = (r.width + 10) + 'px'; ring.style.height = (r.height + 10) + 'px'; document.body.appendChild(ring);
    setTimeout(function () { if (!busy) return; showBubble(text, o, f.getBoundingClientRect(), side); }, reduce ? 0 : 950);
    if (!o || o.hold !== 0) timer = setTimeout(goHome, ((o && o.hold) || 4800) + 950);
  }
  /* fly to an element (a selector or an element) and explain it */
  function guide(target, text, o) {
    var f = fab(); clear(); if (!f) return false; var el = typeof target === 'string' ? document.querySelector(target) : target; o = o || {};
    if (!el || !visible(el)) { var tg = document.querySelector('.vtoggle'); if (el && tg && visible(tg)) { text = (text ? text + ' ' : '') + 'Open the menu first.'; el = tg; } else { busy = true; showBubble(text || '', o, f.getBoundingClientRect(), 'l'); timer = setTimeout(goHome, 4500); return false; } }
    busy = true; var nav = el.closest && el.closest('.vnav'), go = function () { if (busy) fly(f, el, text, o); };
    if (nav && !reduce && nav.scrollHeight > nav.clientHeight + 4) { nav.style.scrollBehavior = 'smooth'; nav.scrollTo({ top: Math.max(0, el.offsetTop - nav.clientHeight / 2 + el.offsetHeight / 2), behavior: 'smooth' }); setTimeout(go, 560); }
    else { var r0 = el.getBoundingClientRect(); if (r0.top < 70 || r0.bottom > innerHeight - 10) { try { el.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' }); } catch (e) {} setTimeout(go, 460); } else go(); }
    return true;
  }
  function sayHome(text, o) { var f = fab(); if (!f) return; clear(); busy = true; showBubble(text, o || {}, f.getBoundingClientRect(), 'l'); timer = setTimeout(goHome, 6500); }
  function runTour(steps, done) {
    var i = 0; function end() { goHome(); if (done) done(); } function show() { if (i >= steps.length) { end(); return; } var s = steps[i], last = i === steps.length - 1; guide(s.el, s.text, { hold: 0, step: (i + 1) + ' of ' + steps.length, buttons: [{ label: last ? 'Finish' : 'Next', fn: function () { i++; show(); } }, { label: 'End tour', ghost: true, fn: end }] }); } show();
  }
  function describe(a) { var k = String(a.getAttribute('href') || '').replace('#/', ''); return label(a) + ': ' + (DESC[k] || 'Open this section.'); }
  function tourMenu() {
    var nav = document.querySelector('.vnav'), opened = false; if (nav && nav.getBoundingClientRect().right <= 2) { nav.classList.add('open'); var sc = document.querySelector('.vscrim'); if (sc) sc.classList.add('open'); opened = true; }
    setTimeout(function () { var links = [].slice.call(document.querySelectorAll('.vnav .tabs a, nav.tabs a')).filter(visible); if (!links.length) { sayHome('I could not find the menu on this screen.'); return; } runTour(links.map(function (a) { return { el: a, text: describe(a) }; }), function () { if (opened && nav) { nav.classList.remove('open'); var s2 = document.querySelector('.vscrim'); if (s2) s2.classList.remove('open'); } }); }, opened ? 450 : 0);
  }
  function wave() { var f = fab(); if (!f || busy) return; f.classList.remove('waving'); void f.offsetWidth; f.classList.add('waving'); setTimeout(function () { f.classList.remove('waving'); }, 1700); }
  function hop() { var f = fab(); if (!f || busy) return; f.classList.remove('hop'); void f.offsetWidth; f.classList.add('hop'); setTimeout(function () { f.classList.remove('hop'); }, 900); }
  /* it looks toward your cursor */
  var mx = 0, my = 0, pend = false;
  document.addEventListener('mousemove', function (e) {
    mx = e.clientX; my = e.clientY; if (pend || reduce) return; pend = true;
    requestAnimationFrame(function () { pend = false; var f = fab(); if (!f || busy) return; var o = f.querySelector('.orb'); if (!o) return; var r = f.getBoundingClientRect(), dx = mx - (r.left + r.width / 2), dy = my - (r.top + r.height / 2), d = Math.max(1, Math.hypot(dx, dy)), k = Math.min(1, d / 480); o.style.setProperty('--gx', (dx / d * 6 * k).toFixed(1) + 'px'); o.style.setProperty('--gy', (dy / d * 4 * k).toFixed(1) + 'px'); o.style.setProperty('--gr', (Math.max(-1, Math.min(1, dx / 650)) * 10).toFixed(1) + 'deg'); });
  }, { passive: true });
  setInterval(function () { if (document.hidden || busy || reduce) return; if (Math.random() < 0.6) wave(); else hop(); }, 15000);
  /* when you ask the assistant to open something, the bot shows you where it is in the menu */
  document.addEventListener('click', function (e) { if (e.target.closest && e.target.closest('.tabs a')) lastNav = Date.now(); if (e.target.closest && e.target.closest('.ai-fab')) { if (busy) goHome(); } }, true);
  function watch() { ['sbody', 'aiBody'].forEach(function (id) { var n = document.getElementById(id); if (n && !n._botw) { n._botw = 1; new MutationObserver(function () { lastAsk = Date.now(); }).observe(n, { childList: true }); } }); }
  setInterval(watch, 1500);
  window.addEventListener('hashchange', function () {
    if (Date.now() - lastAsk > 5000 || Date.now() - lastNav < 700) return;
    setTimeout(function () { var h = location.hash.split('?')[0], a = document.querySelector('.vnav .tabs a[href="' + h + '"], nav.tabs a[href="' + h + '"]'); if (a) guide(a, 'Here is ' + label(a) + '.', { hold: 3200 }); }, 700);
  });
  window.SelBot = { guide: guide, tour: tourMenu, say: sayHome, wave: wave, hop: hop, home: goHome, describe: describe };
})();
