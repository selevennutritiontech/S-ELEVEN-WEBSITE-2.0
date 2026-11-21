/* S-ELEVEN Dealer Portal - app (DEMO). Data comes from DB (db.js) + SEL (data.js). */
(function () {
  'use strict';
  var HOME_URL = (location.protocol === 'file:') ? '../index.html' : '/';
  var LS = 'sel.v2.';

  /* ---------- small helpers ---------- */
  function $(s, el) { return (el || document).querySelector(s); }
  function $$(s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function r2(n) { return Math.round(n * 100) / 100; }
  function inr(n, dp) { n = Number(n) || 0; return '\u20B9' + n.toLocaleString('en-IN', { minimumFractionDigits: dp || 0, maximumFractionDigits: dp || 0 }); }
  function inr2(n) { return inr(n, 2); }
  function fdate(iso) { var d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); }
  function fdt(iso) { var d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); }
  function jget(s, fb) { try { var v = JSON.parse(s); return v === null ? fb : v; } catch (e) { return fb; } }
  var mem = {};
  var store = {
    get: function (k) { try { var v = localStorage.getItem(LS + k); return v === null ? (k in mem ? mem[k] : null) : v; } catch (e) { return k in mem ? mem[k] : null; } },
    set: function (k, v) { try { localStorage.setItem(LS + k, v); } catch (e) {} mem[k] = v; }
  };
  var sess = {
    get: function (k) { try { var v = sessionStorage.getItem(LS + k); return v === null ? (('s' + k) in mem ? mem['s' + k] : null) : v; } catch (e) { return ('s' + k) in mem ? mem['s' + k] : null; } },
    set: function (k, v) { try { sessionStorage.setItem(LS + k, v); } catch (e) {} mem['s' + k] = v; },
    del: function (k) { try { sessionStorage.removeItem(LS + k); } catch (e) {} delete mem['s' + k]; }
  };
  function toast(msg) {
    var t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; $('#toasts').appendChild(t);
    setTimeout(function () { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(function () { t.remove(); }, 300); }, 2400);
  }
  var ICONS = {
    cart: '<circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/>',
    box: '<path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
    tag: '<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/>',
    bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
    out: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
    ext: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    file: '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><path d="M14 2v6h6"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    plus: '<path d="M5 12h14"/><path d="M12 5v14"/>', minus: '<path d="M5 12h14"/>',
    trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
    check: '<path d="M20 6 9 17l-5-5"/>', chev: '<path d="m6 9 6 6 6-6"/>',
    copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
    truck: '<path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/>',
    mic: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v3"/>',
    send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
    thumb: '<path d="M7 10v12"/><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"/>'
  };
  function ic(n) { return '<svg class="i" viewBox="0 0 24 24" aria-hidden="true">' + ICONS[n] + '</svg>'; }

  /* ---------- state ---------- */
  var dealer = null, orderFilter = 'all', searchText = '';
  (function restore() { var c = sess.get('dealer'); if (c) dealer = DB.getDealer(c); if (dealer && dealer.active === false) { sess.set('dealer', ''); dealer = null; } })();
  function cartKey() { return 'cart.' + dealer.code; }
  function loadCart() { return dealer ? jget(store.get(cartKey()), []) : []; }
  function saveCart(c) { store.set(cartKey(), JSON.stringify(c)); }
  function cartCount(c) { return c.reduce(function (n, l) { return n + l.qty; }, 0); }
  function priceOf(pid, vid, mrp) { return DB.priceFor(dealer, pid, vid, mrp); }
  function repriceCart(c) { c.forEach(function (l) { l.price = priceOf(l.pid, l.vid, l.mrp); }); return c; }
  function getCheckout() { return jget(sess.get('checkout.' + dealer.code), {}); }
  function setCheckout(o) { sess.set('checkout.' + dealer.code, JSON.stringify(o)); }
  function gjOf(addr, pin) { return DB.isGujarat(addr, pin, dealer && dealer.gst); }
  var DISPATCH_NOTE = 'Your order will be dispatched within 36 hours of payment. You can change the products while payment is pending, and for 24 hours after paying (you then pay only the difference).';
  function gjNow() { var co = getCheckout(); return gjOf(co.address != null ? co.address : dealer.address, co.pin != null ? co.pin : dealer.pincode); }
  function posText(addr, pin) {
    var p = /^\d{6}$/.test(pin || '') ? pin : DB.pinFrom(addr), st = DB.stateFromPin(p), gj = gjOf(addr, pin);
    return 'Place of supply: ' + (st ? st.name : (gj ? 'Gujarat' : 'enter the 6-digit pincode')) + ' \u2192 ' + (gj ? 'CGST 2.5% + SGST 2.5%' : 'IGST 5%');
  }
  function gstSplitHtml(t) { return (dealer && !dealer.gst ? '<span class="osm">Unregistered profile (no GSTIN). GST is applied by delivery state.</span>' : '') + '<b>Price includes GST</b><span>Taxable value ' + inr2(t.taxable) + '</span><span>' + (t.gujarat ? 'CGST ' + inr2(t.cgst) + ' + SGST ' + inr2(t.sgst) : 'IGST ' + inr2(t.igst)) + '</span>'; }
  function mkLine(pid, vid, flavour, qty) {
    var f = SEL.findProduct(pid), p = f.product, v = null; p.variants.forEach(function (x) { if (x.id === vid) v = x; });
    return { key: pid + '|' + vid + '|' + (flavour || ''), brand: f.brand, pid: pid, product: p.name, vid: vid, variant: v.label, flavour: flavour || '', mrp: v.mrp, price: priceOf(pid, vid, v.mrp), qty: qty };
  }
  function addToCart(line) {
    var cart = loadCart(), found = false;
    cart.forEach(function (l) { if (l.key === line.key) { l.qty = Math.min(999, l.qty + line.qty); found = true; } });
    if (!found) cart.push(line); saveCart(cart);
  }

  /* ---------- coupon (kept in session, re-checked every time) ---------- */
  function currentCoupon(cart) {
    var code = sess.get('coupon.' + dealer.code), pend = sess.get('pending.' + dealer.code);
    var sub = DB.calcTotals(cart, null).subtotal;
    if (pend && cart.length) {
      sess.del('pending.' + dealer.code);
      var r = DB.validateCoupon(pend, cart, sub, dealer.category);
      if (r.coupon) { code = r.coupon.code; sess.set('coupon.' + dealer.code, code); toast('Coupon ' + code + ' applied'); } else toast(r.error);
    }
    if (!code) return null;
    var chk = DB.validateCoupon(code, cart, sub, dealer.category);
    if (!chk.coupon) { sess.del('coupon.' + dealer.code); toast(code + ' removed: ' + chk.error); return null; }
    return chk.coupon;
  }

  /* ===================== layout ===================== */
  function footer() {
    return '<footer><div class="wrap"><span>\u00A9 2026 S-ELEVEN Nutrition Pvt. Ltd. Dealer support: <a href="mailto:info@s-eleven.com">info@s-eleven.com</a> \u00B7 <a href="tel:+919023812338">+91 90238 12338</a></span><a href="' + HOME_URL + '">\u2190 Back to s-eleven.com</a></footer>';
  }
  function shell(active, inner) {
    var n = cartCount(loadCart());
    var tabs = [['home', 'Home'], ['order', 'Generate Order'], ['orders', 'My Orders'], ['preorders', 'Preorders'], ['returns', 'Returns'], ['ledger', 'Ledger'], ['offers', 'Offers'], ['updates', 'Updates']];
    return '<header class="site-header"><div class="wrap hdr">' +
      '<a class="brandlink" href="#/" aria-label="Dealer portal home"><img src="' + SEL.LOGO + '" alt="S-ELEVEN Nutrition"><span class="tag">Dealer Portal</span></a>' +
      '<div class="hdr-right"><span class="chip-user">' + esc(dealer.name) + ' <small>' + esc(dealer.code) + '</small></span>' +
      '<button class="icon-btn bellbtn" type="button" data-act="bell" aria-label="Notifications">' + bellInner() + '</button>' + '<a class="icon-btn" href="#/cart" aria-label="Cart, ' + n + ' items">' + ic('cart') + '<span class="lbl">Cart</span>' + (n ? '<span class="badge">' + n + '</span>' : '') + '</a>' +
      '<button class="icon-btn" type="button" data-act="logout" aria-label="Log out">' + ic('out') + '<span class="lbl">Logout</span></button></div></div></header>' +
      '<nav class="tabs" aria-label="Dealer sections"><div class="wrap">' +
      tabs.map(function (t) { return '<a href="#/' + (t[0] === 'home' ? '' : t[0]) + '"' + (active === t[0] ? ' aria-current="page"' : '') + '>' + t[1] + '</a>'; }).join('') + '</div></nav>' +
      '<main><div class="wrap">' + inner + '</div></main>' + footer();
  }

  /* ===================== views ===================== */
  function viewLogin() {
    var list = SEL.BRANDS.map(function (b) {
      var thumb = '<span class="bthumb" style="background:' + b.panel + '"><img src="' + b.logo + '" alt=""></span>';
      return b.catalogue
        ? '<a class="brow cat" href="' + esc(b.catalogue) + '" target="_blank" rel="noopener noreferrer">' + thumb + '<b>' + esc(b.full) + '</b><span>Catalogue ' + ic('file') + '</span></a>'
        : '<div class="brow">' + thumb + '<b>' + esc(b.full) + '</b><span class="soon">Launching soon</span></div>';
    }).join('');
    return '<header class="site-header"><div class="wrap hdr"><a class="brandlink" href="' + HOME_URL + '" aria-label="Back to S-ELEVEN website"><img src="' + SEL.LOGO + '" alt="S-ELEVEN Nutrition"><span class="tag">Dealer Portal</span></a></div></header>' +
      '<main><div class="wrap"><div class="login-wrap"><section class="card login-card"><h1>Dealer Login</h1><p class="sub">Sign in with your S-ELEVEN dealer code to place and track orders.</p>' +
      '<form id="loginForm" novalidate><div class="field"><label for="dcode">Dealer Code</label><input id="dcode" autocomplete="username" placeholder="e.g. DEMO001" required></div>' +
      '<div class="field"><label for="dpass">Password</label><div class="pw"><input id="dpass" type="password" autocomplete="current-password" required><button type="button" data-act="togglepw">Show</button></div></div>' +
      '<p class="err" id="loginErr" role="alert"></p><button class="btn block" id="loginBtn" type="submit">Login</button></form>' +
      '<div class="demo-hint"><b>Dealer access:</b> your dealer code and password are created by S-ELEVEN (Host &gt; Dealers).</div>' +
      '<p class="help">Forgot your password, or need a dealer code? Contact S-ELEVEN: <a href="mailto:info@s-eleven.com">info@s-eleven.com</a> \u00B7 +91 90238 12338</p></section>' +
      '<aside class="login-side"><h2>Brands you can order</h2><p>One login for every S-ELEVEN brand. Tap a brand to open its catalogue (PDF).</p><div class="blist">' + list + '</div></aside></div></div></main>' + footer();
  }

  function ago(ms) { var sec = Math.floor((Date.now() - ms) / 1000); if (sec < 3600) return Math.max(1, Math.floor(sec / 60)) + 'm'; if (sec < 86400) return Math.floor(sec / 3600) + 'h'; return Math.floor(sec / 86400) + 'd'; }
  function postHtml(p) {
    var liked = p.likes.indexOf(dealer.code) > -1, img = p.image ? '<img class="fimg" src="' + esc(p.image) + '" alt="" loading="lazy">' : '';
    return '<article class="card fpost"><div class="fhead"><span class="avatar"><img src="' + SEL.LOGO + '" alt=""></span><div><b>S-ELEVEN Nutrition</b><small>Official \u00B7 ' + ago(p.at) + ' ago \u00B7 <span class="ftag">' + esc(p.tag) + '</span></small></div></div>' +
      '<h3>' + esc(p.title) + '</h3><p>' + esc(p.text) + '</p>' + img + '<div class="ffoot"><button class="like' + (liked ? ' on' : '') + '" type="button" data-act="like" data-id="' + esc(p.id) + '" aria-pressed="' + liked + '">' + ic('thumb') + ' Like <span>' + p.likes.length + '</span></button>' +
      (p.link ? '<button class="btn sm" type="button" data-act="postlink" data-id="' + esc(p.id) + '">' + esc(p.link.label || 'View') + '</button>' : '') + '</div></article>';
  }
  function offerPostHtml(o) {
    return '<article class="card fpost offerpost"><div class="fhead"><span class="avatar"><img src="' + SEL.LOGO + '" alt=""></span><div><b>S-ELEVEN Nutrition</b><small>Offer update \u00B7 <span class="ftag hot">' + esc(DB.SECTIONS[o.section]) + '</span></small></div></div><h3>' + esc(o.title) + '</h3><p>' + esc(o.text) + '</p>' +
      '<div class="ffoot"><span class="cd" data-exp="' + o.expiresAt + '">' + DB.countdown(o.expiresAt - Date.now()) + '</span><button class="btn sm use" type="button" data-act="usecoupon" data-code="' + esc(o.code) + '">Use ' + esc(o.code) + '</button></div></article>';
  }
  function suggestions() {
    var cnt = {}, out = []; DB.listOrders(dealer.code).forEach(function (o) { o.items.forEach(function (l) { cnt[l.pid] = (cnt[l.pid] || 0) + l.qty; }); });
    Object.keys(cnt).sort(function (a, b) { return cnt[b] - cnt[a]; }).slice(0, 3).forEach(function (id) { out.push({ pid: id, why: 'You ordered this before' }); });
    ['bolt-wp', 'pl-pb', 'ved-sa', 'wm-wp', 'el-ac'].forEach(function (id) { if (out.length < 4 && !out.some(function (x) { return x.pid === id; })) out.push({ pid: id, why: 'Popular with dealers' }); });
    return out.slice(0, 4).map(function (x) { var f = SEL.findProduct(x.pid); return f ? { f: f, why: x.why } : null; }).filter(Boolean);
  }
  function suggestHtml(list) {
    return list.map(function (x) {
      var p = x.f.product, v = p.variants[0], short = p.name.split(' (')[0];
      return '<div class="sug">' + thumbHtml(p.id) + '<div><b>' + esc(short) + '</b><small>' + esc(SEL.brandById(x.f.brand).name) + ' \u00B7 from ' + inr(priceOf(p.id, v.id, v.mrp)) + ' \u00B7 ' + esc(x.why) + '</small></div><button class="btn ghost sm" type="button" data-act="suggest" data-brand="' + x.f.brand + '" data-q="' + esc(short) + '">Order</button></div>';
    }).join('');
  }
  function viewHome() {
    var cart = loadCart(), orders = DB.listOrders(dealer.code), now = Date.now();
    var liveOffers = DB.offersFor(dealer).filter(function (o) { return DB.offerState(o) === 'live'; }).sort(function (a, b) { return a.expiresAt - b.expiresAt; });
    var tiles = [
      ['order', 'cart', 'Generate Order', 'Browse every brand, pick variants and flavours, and build your order.', cartCount(cart) ? cartCount(cart) + ' item(s) in cart' : 'Start a new order'],
      ['orders', 'box', 'My Orders', 'Track orders and download sales orders and invoices.', orders.length + ' order(s)'],
      ['offers', 'tag', 'Offers', 'Live sales, combos and super savings with countdown timers.', liveOffers.length + ' live offer(s)'],
      ['updates', 'bell', 'Updates', 'Launches, price list changes and notices from S-ELEVEN.', UPDATES.length + ' update(s)']
    ];
    var posts = DB.listPosts(), sug = suggestions(), feed = [], i;
    for (i = 0; i < Math.max(posts.length, 2); i++) {
      if (posts[i]) feed.push(postHtml(posts[i]));
      if (i === 0 && liveOffers[0]) feed.push(offerPostHtml(liveOffers[0]));
      if (i === 0) feed.push('<article class="card fpost"><div class="fhead"><span class="avatar sugav">' + ic('cart') + '</span><div><b>Suggested for you</b><small>Based on your orders and what dealers reorder most</small></div></div><div class="suglist">' + suggestHtml(sug.slice(0, 3)) + '</div></article>');
      if (i === 1 && liveOffers[1]) feed.push(offerPostHtml(liveOffers[1]));
    }
    return shell('home', '<h1 class="page-title">Welcome, ' + esc(dealer.name) + '</h1>' +
      '<div class="hello"><span class="pillx">Dealer code: ' + esc(dealer.code) + '</span><span class="pillx">' + esc(dealer.city) + '</span></div>' +
      '<div class="tiles">' + tiles.map(function (t) { return '<a class="card tile" href="#/' + t[0] + '"><span class="ti">' + ic(t[1]) + '</span><h2>' + t[2] + '</h2><p>' + t[3] + '</p><span class="meta">' + esc(t[4]) + '</span></a>'; }).join('') + '</div>' +
      '<div class="feedwrap"><section class="feed" aria-label="Your feed"><h2 class="feedh">Your feed</h2>' + feed.join('') + '</section>' +
      '<aside class="rail"><section class="card railc"><h3>Suggested for you</h3>' + suggestHtml(sug) + '</section><section class="card railc"><h3>Offers ending soon</h3>' + (liveOffers.slice(0, 3).map(function (o) { return '<div class="rrow"><div><b>' + esc(o.title) + '</b><small>' + esc(o.code) + '</small></div><span class="cd" data-exp="' + o.expiresAt + '">' + DB.countdown(o.expiresAt - now) + '</span></div>'; }).join('') || '<p class="osm">No live offers right now.</p>') + '<a class="rm" href="#/offers">See all offers \u2192</a></section>' +
      '<section class="card railc profile2"><h3>Your account</h3><div><small>Contact</small><b>' + esc(dealer.person) + '</b></div><div><small>Phone</small><b>' + esc(dealer.phone) + '</b></div><div><small>GST number</small><b>' + esc(dealer.gst) + '</b></div></section></aside></div>');
  }

  function pimgHtml(p) {
    var m = SEL.imgOf(p.id); if (!m) return '';
    return '<div class="pimg' + (m.bg === '#9b0b10' ? ' tile' : '') + '" style="background:' + m.bg + '"><img src="' + esc(m.src) + '" alt="' + esc(p.name) + '" loading="lazy" onerror="this.style.display=\'none\'"></div>';
  }
  function thumbHtml(pid) {
    var m = SEL.imgOf(pid); if (!m) return '';
    return '<span class="thumb" style="background:' + m.bg + '"><img src="' + esc(m.src) + '" alt="" loading="lazy"></span>';
  }

  /* ---------- stock, preorders and freebies ---------- */
  function refreshStock(card) {
    var vr = $('input[type=radio]:checked', card); if (!vr) return; var fsel0 = $('select', card), st = DB.flavourStock2(card.getAttribute('data-pid'), vr.value, fsel0 ? fsel0.value : ''), line = $('[data-stock]', card), add = $('[data-act="add"]', card), pre = $('[data-act="preorder"]', card);
    var out = st.avail <= 0; if (line) line.innerHTML = out ? '<span class="stk out">Out of stock: preorder and pay later</span>' : (st.avail <= 10 ? '<span class="stk low">Only ' + st.avail + ' left</span>' : '<span class="stk ok">In stock</span>');
    if (add) add.style.display = out ? 'none' : ''; if (pre) pre.style.display = out ? '' : 'none';
  }
  try { new MutationObserver(function () { $$('.pcard:not([data-stk])').forEach(function (c) { c.setAttribute('data-stk', '1'); refreshStock(c); }); }).observe(document.body, { childList: true, subtree: true }); } catch (e) {}
  function getFb() { return jget(sess.get('fb.' + dealer.code), {}); }
  function setFb(o) { sess.set('fb.' + dealer.code, JSON.stringify(o)); }
  function trimFb(sel, o) {
    var out = {}, tot = 0; o.items.forEach(function (f) { var q = Math.min(sel[f.id] || 0, f.maxQty, f.qty); while (q > 0 && tot + q * f.valuation > o.allowance) q--; if (q > 0) { out[f.id] = q; tot += q * f.valuation; } }); return out;
  }
  function fbCardHtml(cart, cp) {
    var o = DB.freebieOptions(dealer.code, cart, cp ? cp.code : null), sel = trimFb(getFb(), o); setFb(sel); var used = 0; Object.keys(sel).forEach(function (k) { var f = o.items.filter(function (x) { return x.id === k; })[0]; if (f) used += f.valuation * sel[k]; });
    var nxt = DB.fslabs().filter(function (x) { return x.min > o.qualifying; })[0];
    var items = o.items.map(function (f) { var q = sel[f.id] || 0; return '<div class="fbrow">' + thumbHtml(f.pid) + '<div style="flex:1;min-width:0"><b>' + esc(f.name) + '</b><small class="osm" style="display:block">' + esc(f.code) + ' \u00B7 ' + esc((SEL.brandById(f.brand) || {}).name || '') + ' \u00B7 valued ' + inr(f.valuation) + ' each \u00B7 ' + f.qty + ' available \u00B7 up to ' + f.maxQty + ' per order</small></div>' +
      '<div class="qty"><button type="button" data-act="fbdec" data-f="' + esc(f.id) + '" aria-label="Fewer">' + ic('minus') + '</button><span class="fbq">' + q + '</span><button type="button" data-act="fbinc" data-f="' + esc(f.id) + '" aria-label="More">' + ic('plus') + '</button></div></div>'; }).join('');
    var why = o.reasons.map(function (r) { return '<li>' + esc(r.product + ' ' + r.variant) + ': ' + esc(r.reason) + '</li>'; }).join('');
    return '<div class="fbcard"><h2>Free items for your order</h2><p class="osm">Your order qualifies for freebies worth up to <b>' + inr(o.allowance) + (o.wallet ? ' (includes ' + inr(o.wallet) + ' from your freebie wallet)' : '') + '</b>' + (used ? ' (you chose ' + inr(used) + ', ' + inr(o.allowance - used) + ' left)' : '') + '. You choose what you want, and they never add to what you pay.' + (nxt ? ' Add ' + inr(nxt.min - o.qualifying) + ' more to reach ' + inr(nxt.max) + '.' : '') + '</p>' + (items || '<p class="osm">' + (o.allowance ? 'No freebies are available for you right now.' : 'Freebies start at an order value of ' + inr((DB.fslabs()[0] || { min: 0 }).min) + '.') + '</p>') + (why ? '<p class="osm" style="margin-top:8px"><b>Not eligible for freebies:</b></p><ul class="osm" style="margin:2px 0 0 18px">' + why + '</ul>' : '') + '</div>';
  }
  function preorderHtml() {
    var l = DB.listPreorders(dealer.code).slice().sort(function (a, b) { return b.createdAt - a.createdAt; }); if (!l.length) return '';
    return '<section class="card panel" style="margin:18px 0"><h2>Your preorders</h2><p class="osm">Nothing is charged until stock is reserved for you and you pay. Shipment happens only after payment.</p>' + l.map(function (p) {
      var pay = p.status.indexOf('pay now') > -1; return '<div class="fbrow"><div style="flex:1;min-width:0"><b>' + esc(p.id) + '</b> \u00B7 ' + esc(p.product.split(' (')[0]) + ' ' + esc(p.variant) + (p.flavour ? ' \u00B7 ' + esc(p.flavour) : '') + ' \u00D7 ' + p.qty + '<small class="osm" style="display:block">Price locked at ' + inr(p.price) + ' \u00B7 ' + esc(p.status) + (pay ? ' \u00B7 pay before ' + fdt(p.payBy) : '') + '</small></div>' + (pay ? '<button class="btn sm" type="button" data-act="paynow" data-id="' + esc(p.orderId) + '">Pay now</button>' : (p.status === 'Waiting for stock' ? '<button class="btn ghost sm" type="button" data-act="precancel" data-id="' + esc(p.id) + '">Cancel</button>' : '')) + '</div>'; }).join('') + '</section>';
  }
  function replLine(o) { var r = o.replacement; if (!r) return ''; return '<div class="repl" style="margin-top:10px;padding:10px 12px;border-radius:12px;background:rgba(89,9,7,.06)"><b>Replacement sent for return ' + esc(r.returnId) + '</b><br>' + r.items.map(function (i) { return esc(i.qty + ' \u00D7 ' + i.name + (i.flavour ? ' (' + i.flavour + ')' : '')); }).join('<br>') + '<br>Replacement value ' + inr2(r.value) + ' \u2212 returned goods ' + inr2(r.returnedValue) + ' = <b>' + (r.dealerPays > 0 ? 'balance to pay ' + inr2(r.dealerPays) : r.credit > 0 ? 'credit to you ' + inr2(r.credit) : 'no balance') + '</b></div>'; }
  function freebieLine(o) { return o.freebies && o.freebies.length ? '<p class="osm" style="margin:10px 0 0"><b>Freebies (no charge, value ' + inr(o.freebieValue || 0) + '):</b> ' + o.freebies.map(function (f) { return esc(f.name) + ' \u00D7 ' + f.qty; }).join(', ') + '</p>' : ''; }

  function openFile(f) { try { var q = String(f.data).split(','), mime = (q[0].match(/:(.*?);/) || [0, 'application/pdf'])[1], bin = atob(q[1]), u = new Uint8Array(bin.length); mime = ({ 'application/pdf': 1, 'image/png': 1, 'image/jpeg': 1 }[mime] ? mime : 'application/octet-stream'); for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); window.open(URL.createObjectURL(new Blob([u], { type: mime })), '_blank'); } catch (e) { toast('Could not open the file.'); } }
  function productCard(p) {
    var vp = p.variants.map(function (v, i) {
      return '<label class="vp"><input type="radio" name="v-' + p.id + '" value="' + v.id + '" data-mrp="' + v.mrp + '" data-price="' + priceOf(p.id, v.id, v.mrp) + '"' + (i === 0 ? ' checked' : '') + '><span>' + esc(v.label) + '</span></label>';
    }).join('');
    var flav = p.flavours.length
      ? '<div class="field"><label for="fl-' + p.id + '">Flavour</label><select id="fl-' + p.id + '">' + p.flavours.map(function (f) { return '<option value="' + esc(f) + '">' + esc(f) + (DB.flavourAvail(p.id, p.variants[0].id, f) === 0 ? ' \u2014 out of stock' : '') + '</option>'; }).join('') + '</select></div>'
      : '<div class="field"><label>Flavour</label><div class="refl">No flavour options for this product</div></div>';
    var v0 = p.variants[0];
    return '<article class="card pcard" data-pid="' + p.id + '">' + pimgHtml(p) + '<span class="pcat">' + esc(p.cat) + '</span><h3>' + esc(p.name) + '</h3>' +
      '<div class="field" style="margin-top:14px"><span class="lab">Pack size</span><div class="vpills" role="radiogroup" aria-label="Pack size">' + vp + '</div></div>' +
      '<div class="prices"><div class="pbox"><small>MRP</small><b data-vmrp>' + inr(v0.mrp) + '</b></div><div class="pbox buy"><small>Your purchase price (incl. GST)</small><b data-vprice>' + inr(priceOf(p.id, v0.id, v0.mrp)) + '</b></div></div><div class="stockline" data-stock></div>' +
      flav + '<div class="addrow"><div class="qty"><button type="button" data-act="qdec" aria-label="Decrease quantity">' + ic('minus') + '</button><input type="number" min="1" max="999" value="1" aria-label="Quantity" data-qty><button type="button" data-act="qinc" aria-label="Increase quantity">' + ic('plus') + '</button></div>' +
      '<button class="btn" type="button" data-act="add">' + ic('cart') + ' Add to cart</button><button class="btn ghost" type="button" data-act="preorder" style="display:none">Preorder (pay later)</button></div></article>';
  }
  function productsHtml(brandId) {
    var q = searchText.trim().toLowerCase();
    var list = SEL.CATALOG[brandId].filter(function (p) { return !q || (p.name + ' ' + p.cat).toLowerCase().indexOf(q) > -1; });
    return list.length ? list.map(productCard).join('') : '<div class="card empty" style="grid-column:1/-1">No products match "' + esc(searchText) + '".</div>';
  }
  function cartBar() {
    var cart = repriceCart(loadCart()), n = cartCount(cart); if (!n) return '';
    return '<div class="cartbar"><div class="wrap"><div><b>' + n + ' item(s) in cart</b><small>Subtotal ' + inr2(DB.calcTotals(cart, null).subtotal) + '</small></div><a class="btn" href="#/cart">View cart</a></div></div>';
  }
  function viewOrder(brandId) {
    var brand = SEL.brandById(brandId) || SEL.BRANDS[0];
    var cards = SEL.BRANDS.map(function (b) {
      return '<a class="bcard" href="#/order/' + b.id + '"' + (b.id === brand.id ? ' aria-current="true"' : '') + '><span class="bthumb" style="background:' + b.panel + '"><img src="' + b.logo + '" alt="' + esc(b.full) + '"></span><b>' + esc(b.name) + '</b><small>' + (b.soon ? 'Launching soon' : SEL.CATALOG[b.id].length + (SEL.CATALOG[b.id].length === 1 ? ' product' : ' products')) + '</small></a>';
    }).join('');
    var btns = (brand.catalogue ? '<a class="btn ghost sm" href="' + esc(brand.catalogue) + '" target="_blank" rel="noopener noreferrer">' + ic('file') + ' Catalogue</a>' : '') +
      (brand.url ? '<a class="btn ghost sm" href="' + esc(brand.url) + '" target="_blank" rel="noopener noreferrer">Website ' + ic('ext') + '</a>' : '');
    var head = '<section class="card bhead"><div class="l"><span class="bthumb" style="background:' + brand.panel + '"><img src="' + brand.logo + '" alt=""></span><div><h2>' + esc(brand.full) + '</h2><p>' + esc(brand.blurb) + '</p></div></div><div class="btns">' + btns + '</div></section>';
    var body = brand.soon
      ? '<section class="card soon-card"><h3>' + esc(brand.name) + ' is launching soon</h3><p>Products and your purchase prices will appear here once the brand goes live.</p></section>'
      : '<div class="tools"><div class="search">' + ic('search') + '<input type="search" id="psearch" placeholder="Search ' + esc(brand.name) + ' products" aria-label="Search products" value="' + esc(searchText) + '"></div><span class="refl">' + SEL.CATALOG[brand.id].length + ' products \u00B7 prices are per pack</span></div><div class="pgrid" id="pgrid">' + productsHtml(brand.id) + '</div>';
    return shell('order', '<h1 class="page-title">Generate Order</h1><p class="page-sub">Pick a brand, choose the pack size, flavour and quantity, then add to cart. Your purchase price is set by S-ELEVEN for your dealer account.</p>' +
      '<div class="bsel" role="navigation" aria-label="Brands">' + cards + '</div>' + head + body + cartBar());
  }

  /* ---------- cart + checkout ---------- */
  var PM = { upi: 'UPI', card: 'Debit / Credit card', netbanking: 'Net banking' };
  function stepsHtml(n) {
    return '<div class="steps" aria-label="Checkout steps">' + ['Cart', 'Payment', 'Confirmation'].map(function (x, i) {
      return '<span class="step ' + (i + 1 === n ? 'on' : (i + 1 < n ? 'done' : '')) + '"><i>' + (i + 1 < n ? '\u2713' : (i + 1)) + '</i>' + x + '</span>';
    }).join('') + '</div>';
  }
  function summaryHtml(t, cp, o) {
    o = o || {};
    var h = '<aside class="card summary"><h2>Order summary</h2><div class="srow"><span>Subtotal (your purchase price)</span><b>' + inr2(t.subtotal) + '</b></div>';
    if (cp) h += '<div class="srow disc"><span>Coupon (' + esc(cp.code) + ')</span><b>\u2212 ' + inr2(t.couponDiscount) + '</b></div>';
    h += (function () { var w = DB.linesWeight(loadCart()); return w > 0 ? '<div class="srow"><span>Estimated shipping weight</span><b>' + w.toFixed(2) + ' kg</b></div>' : ''; })(); h += (t.freight ? '<div class="srow"><span>Freight (logistics)</span><b>' + inr2(t.freight) + '</b></div>' : '') + '<div class="srow total"><span>Total payable</span><b>' + inr2(t.total) + '</b></div><div class="gstbox" id="gstSplit">' + gstSplitHtml(t) + '</div><p class="osm dispnote">' + DISPATCH_NOTE + '</p>';
    if (o.coupon) {
      h += '<div class="coupon"><span class="lab">Coupon code</span>' + (cp
        ? '<div class="applied"><span>' + ic('check') + ' ' + esc(cp.code) + ' applied</span><button type="button" data-act="rmcoupon">Remove</button></div>'
        : '<form id="couponForm" novalidate><input id="couponInput" placeholder="Enter coupon code" aria-label="Coupon code" autocomplete="off"><button class="btn blue sm" type="submit">Apply</button></form><p class="err" id="couponErr" role="alert"></p><p class="note"><a href="#/offers">See live offers</a></p>') + '</div>';
    }
    return h + (o.cta || '') + '<p class="note">' + (o.note || 'Purchase prices include GST. The CGST/SGST or IGST split follows the delivery pincode.') + '</p></aside>';
  }
  function viewCart() {
    var cart = repriceCart(loadCart());
    if (!cart.length) {
      var pend = sess.get('pending.' + dealer.code);
      return shell('cart', '<h1 class="page-title">Your cart</h1>' + stepsHtml(1) + '<section class="card empty" style="margin-top:22px"><p>Your cart is empty.</p>' + (pend ? '<p class="note">Coupon ' + esc(pend) + ' will be applied once you add items.</p>' : '') + '<p style="margin-top:16px"><a class="btn" href="#/order">Start an order</a></p></section>');
    }
    saveCart(cart);
    var cp = currentCoupon(cart), t = DB.calcTotals(cart, cp, gjNow(), DB.freightOpt(dealer));
    var lines = cart.map(function (l) {
      var b = SEL.brandById(l.brand);
      return '<div class="line"><div class="lt">' + thumbHtml(l.pid) + '<div><div class="nm">' + esc(l.product) + '</div><div class="sb">' + esc(b ? b.name : '') + ' \u00B7 ' + esc(l.variant) + (l.flavour ? ' \u00B7 ' + esc(l.flavour) : '') + '</div>' +
        '<div class="ops" style="margin-top:10px"><div class="qty"><button type="button" data-act="cdec" data-key="' + esc(l.key) + '" aria-label="Decrease quantity">' + ic('minus') + '</button><input type="number" min="1" max="999" value="' + l.qty + '" data-cqty data-key="' + esc(l.key) + '" aria-label="Quantity"><button type="button" data-act="cinc" data-key="' + esc(l.key) + '" aria-label="Increase quantity">' + ic('plus') + '</button></div>' +
        '<button class="rm" type="button" data-act="crm" data-key="' + esc(l.key) + '">' + ic('trash') + ' Remove</button></div></div></div>' +
        '<div class="pr">' + inr2(l.price * l.qty) + '<small>' + inr(l.price) + ' \u00D7 ' + l.qty + ' \u00B7 MRP ' + inr(l.mrp) + '</small></div></div>';
    }).join('');
    return shell('cart', '<h1 class="page-title">Your cart</h1>' + stepsHtml(1) + '<div class="clayout"><section class="card items" aria-label="Cart items">' + lines + fbCardHtml(cart, cp) + '</section>' +
      summaryHtml(t, cp, { coupon: true, cta: '<a class="btn block" href="#/checkout" style="margin-top:14px">Proceed to payment</a><p style="margin-top:10px;text-align:center"><a class="rm" href="#/order">\u2190 Continue shopping</a></p>' }) + '</div>');
  }
  function viewCheckout() {
    var cart = repriceCart(loadCart()); if (!cart.length) return viewCart();
    var cp = currentCoupon(cart), co = getCheckout();
    var addr = co.address != null ? co.address : dealer.address, pin = co.pin != null ? co.pin : (dealer.pincode || ''), phone = co.phone != null ? co.phone : dealer.phone, gst = co.gst != null ? co.gst : dealer.gst, pm = co.pm || 'upi';
    var t = DB.calcTotals(cart, cp, gjOf(addr, pin), DB.freightOpt(dealer));
    var pms = [['upi', 'UPI', 'Google Pay, PhonePe, Paytm and more'], ['card', 'Debit / Credit card', 'Visa, Mastercard, RuPay'], ['netbanking', 'Net banking', 'All major banks']];
    return shell('cart', '<h1 class="page-title">Delivery &amp; payment</h1>' + stepsHtml(2) + '<div class="clayout"><div style="display:grid;gap:22px">' +
      '<section class="card pay-sec"><h2>Delivery details</h2><div class="field"><label for="co-addr">Delivery address</label><textarea id="co-addr">' + esc(addr) + '</textarea></div>' +
      '<div class="two"><div class="field"><label for="co-pin">Delivery pincode</label><input id="co-pin" inputmode="numeric" maxlength="6" value="' + esc(pin) + '"></div><div class="field"><label for="co-phone">Contact number</label><input id="co-phone" inputmode="numeric" value="' + esc(phone) + '"></div></div>' +
      '<p class="note" id="posNote" style="margin:-6px 0 14px;font-weight:700;color:var(--blue-700)">' + posText(addr, pin) + '</p>' +
      '<div class="two"><div class="field"><label for="co-gst">GST number (for invoice)</label><input id="co-gst" value="' + esc(gst) + '"></div><div class="field"><label for="co-note">Order note (optional)</label><input id="co-note" placeholder="Any instruction" value="' + esc(co.note || '') + '"></div></div><p class="err" id="coErr" role="alert"></p></section>' +
      '<section class="card pay-sec"><h2>Payment</h2><p>After you tap <b>Place order &amp; pay</b> you will see our <b>QR code and bank details</b> together with the total payable amount of <b>' + inr2(t.total) + '</b>. Pay by any UPI app or bank transfer, then attach your payment screenshot.</p><p class="note">Your order is confirmed and your tax invoice is issued as soon as our Finance team verifies the payment.</p></section></div>' +
      summaryHtml(t, cp, { cta: '<button class="btn block" type="button" data-act="pay" style="margin-top:14px">Place order &amp; pay ' + inr2(t.total) + '</button><p style="margin-top:10px;text-align:center"><a class="rm" href="#/cart">\u2190 Back to cart</a></p>', note: 'Coupon and totals can be changed in the cart.' }) + '</div>');
  }
  function viewDone(id) {
    var o = findOrder(id);
    if (!o) return shell('orders', '<section class="card empty"><p>Order not found.</p><p style="margin-top:14px"><a class="btn" href="#/orders">My Orders</a></p></section>');
    var paid = o.payment.status === 'Paid';
    return shell('orders', '<section class="card done"><div class="tick" style="background:' + (paid ? 'var(--green)' : '#e08a00') + '">' + ic('check') + '</div><h1>' + (paid ? 'Payment received. Order confirmed' : 'Sales order created') + '</h1>' +
      '<p>' + (paid ? 'Thank you, ' + esc(dealer.name) + '. We received <b>' + inr2(o.totals.total) + '</b> (test mode) and issued your tax invoice.' : 'Your sales order is ready. Pay <b>' + inr2(o.totals.total) + '</b> by QR / bank transfer and attach the screenshot to confirm it.' + (o.proofs && o.proofs.length ? ' <b>' + esc(shotNote(o)) + '.</b>' : '') + ' Your tax invoice is issued as soon as payment is received.') + '</p>' +
      '<span class="oid">Order ID: ' + esc(o.id) + '</span>' + (paid && o.invoice ? '<p class="osm">Invoice ' + esc(o.invoice.no) + '</p>' : '') +
      '<p class="osm" style="margin-top:6px">Track it in My Orders once S-ELEVEN dispatches it.</p><div class="acts">' + (paid ? (o.invoiceFile ? '<button class="btn" type="button" data-act="doc" data-id="' + esc(o.id) + '" data-t="inv">View invoice</button>' : '<span class="osm">Your invoice will be shared here once our team uploads it.</span>') : payLinkBtns(o) + '<button class="btn" type="button" data-act="paynow" data-id="' + esc(o.id) + '">Pay now</button>') +
      '<button class="btn ghost" type="button" data-act="doc" data-id="' + esc(o.id) + '" data-t="so">Sales order</button><a class="btn ghost" href="#/orders">My orders</a></div></section>');
  }

  /* ---------- my orders + tracking ---------- */
  /* v31: card / online payment links shared by the Sales or Finance team for this order */
  function payLinkBtns(o) {
    var links = (DB.activePayLinks ? DB.activePayLinks(o) : []);
    if (!links.length) return '';
    return links.map(function (l) {
      var safe = /^https:\/\//i.test(l.url || '') ? l.url : '';
      if (!safe) return '';
      return '<a class="btn blue sm paylink" href="' + esc(safe) + '" target="_blank" rel="noopener noreferrer">' + ic('ext') + ' ' + esc(l.label || 'Pay online') + '</a>';
    }).join('');
  }
  function orderRow(o) {
    var brands = []; o.items.forEach(function (l) { var b = SEL.brandById(l.brand); if (b && brands.indexOf(b.name) < 0) brands.push(b.name); });
    var rows = o.items.map(function (l) {
      return '<tr><td><div style="display:flex;gap:10px;align-items:center">' + thumbHtml(l.pid) + '<div>' + esc(l.product) + '<br><span class="osm">' + esc(l.variant) + (l.flavour ? ' \u00B7 ' + esc(l.flavour) : '') + '</span></div></div></td><td class="r">' + inr(l.mrp) + '</td><td class="r">' + inr(l.price) + '</td><td class="r">' + l.qty + '</td><td class="r">' + inr2(l.price * l.qty) + '</td></tr>';
    }).join('');
    var t = o.totals, paid = o.payment.status === 'Paid', label = paid ? o.status : (o.cancelled ? 'Expired' : 'Awaiting payment'), cls = 'st-' + label.toLowerCase().replace(/[^a-z]+/g, '');
    var by = o.createdBy && o.createdBy.role !== 'dealer' ? '<span class="osm"> \u00B7 Entered by S-ELEVEN team</span>' : '';
    return '<details class="card order" data-oid="' + esc(o.id) + '"><summary><div><div class="oid2">' + esc(o.id) + '</div><div class="osm">' + fdate(o.date) + '</div></div>' +
      '<div class="osm">' + o.items.length + ' item(s) \u00B7 ' + esc(brands.join(', ')) + '</div><div class="oid2">' + inr2(t.total) + '</div>' +
      '<span class="badge2 ' + cls + '">' + esc(label) + '</span><span class="chev">' + ic('chev') + '</span></summary>' +
      '<div class="obody"><table class="otbl"><thead><tr><th>Product</th><th class="r">MRP</th><th class="r">Price</th><th class="r">Qty</th><th class="r">Amount</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      freebieLine(o) + replLine(o) + '<div class="oft"><div class="tot"><span>Subtotal (incl. GST): <b>' + inr2(t.subtotal) + '</b></span>' + (t.couponCode ? '<span>Coupon ' + esc(t.couponCode) + ': <b>\u2212 ' + inr2(t.couponDiscount) + '</b></span>' : '') +
      '<span>Taxable value: <b>' + inr2(t.taxable) + '</b></span><span>' + (t.gujarat ? 'CGST 2.5%: <b>' + inr2(t.cgst) + '</b> \u00B7 SGST 2.5%: <b>' + inr2(t.sgst) + '</b>' : 'IGST 5%: <b>' + inr2(t.igst) + '</b>') + '</span>' +
      '<span>Total: <b>' + inr2(t.total) + '</b> \u00B7 ' + (paid ? 'Paid via ' + esc(o.payment.method) : esc(shotNote(o))) + '</span>' + (o.invoice ? '<span>Invoice <b>' + esc(o.invoice.no) + '</b> \u00B7 ' + fdate(o.invoice.date) + '</span>' : '') + '</div>' +
      '<div class="oacts"><button class="btn sm" type="button" data-act="track" data-id="' + esc(o.id) + '">' + ic('truck') + ' Track order</button>' +
      '<button class="btn blue sm" type="button" data-act="reorder" data-id="' + esc(o.id) + '">' + ic('cart') + ' Reorder</button>' +
      (DB.returnState(o).ok ? '<button class="btn ghost sm" type="button" data-act="retopen" data-id="' + esc(o.id) + '">Return items</button>' : (DB.returnState(o).expired ? '<span class="osm" title="' + esc(DB.returnState(o).why) + '">Return window closed (21 days)</span>' : '')) +
      (DB.editState(o).ok ? '<button class="btn ghost sm" type="button" data-act="oeditd" data-id="' + esc(o.id) + '">Edit order</button>' : '') + (DB.diffPending(o) ? '<button class="btn sm" type="button" data-act="paydiff" data-id="' + esc(o.id) + '">Pay difference ' + inr2(DB.dueOf(o)) + '</button><button class="btn ghost sm" type="button" data-act="diffx" data-id="' + esc(o.id) + '">Cancel change</button><span class="osm">Dispatch is on hold until the difference is paid.</span>' : '') + (o.payment.status === 'Paid' && ['Dispatched', 'Out for delivery', 'Delivered'].indexOf(o.status) < 0 ? '<span class="osm">' + (o.locked ? 'Order locked. ' : '') + 'Dispatched within 36 hours of payment (by ' + new Date(Date.parse(o.payment.paidAt || o.date) + 36 * 36e5).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) + ').</span>' : '') +
      '<button class="btn ghost sm" type="button" data-act="doc" data-id="' + esc(o.id) + '" data-t="so">' + ic('file') + ' Sales order</button>' +
      (paid ? (o.invoiceFile ? '<button class="btn ghost sm" type="button" data-act="doc" data-id="' + esc(o.id) + '" data-t="inv">' + ic('file') + ' Invoice</button>' : '<span class="osm">Invoice will appear here once uploaded</span>') + (o.ewayFile ? '<button class="btn ghost sm" type="button" data-act="doc" data-id="' + esc(o.id) + '" data-t="eway">' + ic('file') + ' E-way bill</button>' : '') : payLinkBtns(o) + '<button class="btn sm" type="button" data-act="paynow" data-id="' + esc(o.id) + '">Pay now</button>') + '</div></div>' +
      '<p class="osm" style="margin-top:10px">Delivery: ' + esc(o.address || '') + by + '</p></div></details>';
  }
  function viewOrders() {
    var all = DB.listOrders(dealer.code), sts = ['all', 'pending'].concat(DB.STATUSES);
    var list = all.filter(function (o) { return orderFilter === 'all' || (orderFilter === 'pending' ? o.payment.status !== 'Paid' : (o.payment.status === 'Paid' && o.status === orderFilter)); });
    return shell('orders', '<h1 class="page-title">My Orders</h1><p class="page-sub">Open an order for its items, then use Track order for the courier details. Each order has a Sales Order, and a Tax Invoice once it is paid.</p>' +
      preorderHtml() + '<div class="filters" role="group" aria-label="Filter by status">' + sts.map(function (x) { return '<button type="button" class="fchip" data-act="filter" data-v="' + x + '" aria-pressed="' + (orderFilter === x) + '">' + (x === 'all' ? 'All' : (x === 'pending' ? 'Awaiting payment' : x)) + '</button>'; }).join('') + '</div>' +
      '<div class="olist">' + (list.length ? list.map(orderRow).join('') : '<div class="card empty">No orders to show yet.</div>') + '</div>');
  }
  function findOrder(id) { var f = null; DB.listOrders(dealer.code).forEach(function (o) { if (o.id === id) f = o; }); return f; }
  function dealerStage(o) {
    var st = DB.stageOf(o), rv = o.revision;
    return '<div class="osp"><div class="osp-bar" aria-hidden="true">' + st.steps.map(function (s) { return '<i class="' + (s.done ? 'on' : (s.cur ? 'now' : '')) + '"></i>'; }).join('') + '</div><div class="osp-now"><b>' + esc(st.label) + '</b>' + (st.sub && st.idx !== 2 && st.idx !== 3 ? '<span>' + esc(st.sub) + '</span>' : '') + '</div><ol class="osp-list">' + st.steps.map(function (s) { return '<li class="' + (s.done ? 'on' : (s.cur ? 'now' : '')) + '"><span class="m">' + (s.done ? '\u2713' : (s.cur ? '\u25CF' : '')) + '</span>' + esc(s.label) + (s.at ? ' <small>' + new Date(s.at).toLocaleDateString('en-IN') + '</small>' : '') + '</li>'; }).join('') + '</ol></div>' +
      (rv && rv.status === 'awaiting' ? '<div class="revbox"><b>Your order revision needs your confirmation</b><p class="osm">New total ' + inr2(rv.totals.total) + '. The extra ' + inr2(rv.credit) + ' you paid will be returned as a credit note in your ledger.</p><div class="acts"><button class="btn sm" type="button" data-act="revconf" data-id="' + esc(o.id) + '">Confirm revision</button><button class="btn ghost sm" type="button" data-act="revcancel" data-id="' + esc(o.id) + '">Decline</button></div></div>' : '') + (rv && rv.status === 'confirmed' ? '<p class="osm">Revised. Credit note ' + esc(rv.cn) + ' of ' + inr2(rv.credit) + ' is in your ledger.</p>' : '');
  }
  function trackHtml(o) { return dealerStage(o) + trackHtml0(o); }
  function trackHtml0(o) {
    var idx = DB.STATUSES.indexOf(o.status), hist = {};
    (o.history || []).forEach(function (h) { hist[h.status] = h.at; });
    var tl = DB.STATUSES.map(function (s, i) {
      var cls = i < idx ? 'ok' : (i === idx ? 'ok now' : '');
      return '<li class="' + cls + '"><b>' + s + '</b>' + (hist[s] ? fdt(hist[s]) : (i > idx ? 'Pending' : '')) + '</li>';
    }).join('');
    var sh = o.shipment, ship;
    if (sh && sh.trackingId) {
      var c = DB.getCourier(sh.partner), name = c ? c.name : (sh.partner || 'Courier'), url = DB.trackUrl(sh.partner, sh.trackingId);
      ship = '<div class="trkmeta">Courier partner: <b>' + esc(name) + '</b></div><div class="trk"><div><div class="trkmeta">Tracking ID</div><b>' + esc(sh.trackingId) + '</b></div><button class="btn ghost sm" type="button" data-act="copytext" data-text="' + esc(sh.trackingId) + '">' + ic('copy') + ' Copy</button></div>' +
        (url ? '<a class="btn block" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">Track on ' + esc(name) + ' ' + ic('ext') + '</a>' : '<p class="note">A direct tracking link for ' + esc(name) + ' is not set up yet. Use the tracking ID on the courier\'s website.</p>') +
        '<p class="note">Updated ' + fdt(sh.updatedAt) + '</p>';
    } else {
      ship = '<div class="trk" style="border-style:solid"><div class="trkmeta"><b>' + (o.payment && o.payment.status !== 'Paid' ? 'Awaiting payment.' : 'Not dispatched yet.') + '</b><br>The courier partner and tracking ID will appear here as soon as our logistics team adds them.</div></div>';
    }
    return '<button class="xbtn" type="button" data-act="closemodal" aria-label="Close">\u00D7</button><h2>Track order</h2><p class="osm">' + esc(o.id) + ' \u00B7 ' + fdate(o.date) + ' \u00B7 ' + inr2(o.totals.total) + '</p><ul class="tl">' + tl + '</ul>' + ship +
      '<p style="margin-top:12px"><button class="rm" type="button" data-act="aiask" data-q="Where is order ' + esc(o.id) + '?">Ask Eleven about this order</button></p>';
  }
  function openModal(html, id, wide) {
    closeModal(id);
    var o = document.createElement('div'); o.className = 'overlay'; o.id = id || 'modal'; o.setAttribute('role', 'dialog'); o.setAttribute('aria-modal', 'true');
    o.innerHTML = '<div class="modal' + (wide ? ' wide' : '') + '">' + html + '</div>';
    o.addEventListener('mousedown', function (e) { if (e.target === o && id !== 'gw') closeModal(id); });
    document.body.appendChild(o);
    var f = $('button,a', $('.modal', o)); if (f) f.focus();
  }
  function closeModal(id) { var m = $('#' + (id || 'modal')); if (m) m.remove(); }

  /* ---------- offers (3 sections, live timers) ---------- */
  function offerBenefit(o) {
    var t = o.offerType || 'flat', bn = o.brand && SEL.brandById(o.brand) ? SEL.brandById(o.brand).name + ' only \u00B7 ' : '', body;
    if (t === 'percent') body = o.percent + '% off' + (o.cap ? ' (up to \u20B9' + Number(o.cap).toLocaleString('en-IN') + ')' : '');
    else if (t === 'bogo') body = 'Buy ' + o.buyQty + ', get ' + o.freeQty + ' free';
    else body = '\u20B9' + Number(o.amount || 0).toLocaleString('en-IN') + ' off';
    return bn + body + (o.min ? ' \u00B7 min \u20B9' + Number(o.min).toLocaleString('en-IN') : '');
  }
  function offerCard(o) {
    var st = DB.offerState(o), ended = st === 'expired';
    var req = (o.requires || []).map(function (r) { var f = SEL.findProduct(r.pid); return '<span class="chipreq">' + r.qty + ' \u00D7 ' + esc(f ? f.product.name : r.pid) + '</span>'; }).join('');
    return '<article class="card offer' + (ended ? ' expired' : '') + '" data-oid="' + esc(o.id) + '"><div class="top"><h3>' + esc(o.title) + '</h3><span class="cd' + (ended ? ' end' : '') + '" data-exp="' + (o.expiresAt || 0) + '">' + (ended ? 'Ended' : DB.countdown(o.expiresAt - Date.now())) + '</span></div>' +
      '<p><span class="chipreq" style="background:#eef0ff;color:#2a2f7a;font-weight:700">' + esc(offerBenefit(o)) + '</span></p>' +
      '<p>' + esc(o.text) + '</p>' + (req ? '<div>' + req + '</div>' : '') +
      '<div class="code"><b>' + esc(o.code) + '</b><button class="rm" type="button" data-act="copytext" data-text="' + esc(o.code) + '">' + ic('copy') + ' Copy</button></div>' +
      '<span class="exp">' + (ended ? 'Ended ' : 'Expires ') + fdt(o.expiresAt) + '</span>' +
      '<div class="acts"><button class="btn sm use" type="button" data-act="usecoupon" data-code="' + esc(o.code) + '"' + (ended ? ' disabled' : '') + '>Use in cart</button></div></article>';
  }
  function viewOffers() {
    var now = Date.now(), all = DB.offersFor(dealer).filter(function (o) {
      var st = DB.offerState(o, now); return st === 'live' || (st === 'expired' && now - o.expiresAt < 3 * 86400000);
    });
    var sec = ['live', 'combo', 'super'], intro = { live: 'Limited-time sales. Grab them before the timer ends.', combo: 'Buy the listed products together and the combo discount applies.', super: 'Bigger orders, bigger savings.' };
    var html = sec.map(function (k) {
      var l = all.filter(function (o) { return o.section === k; }), n = l.filter(function (o) { return DB.offerState(o, now) === 'live'; }).length;
      return '<section class="osec" id="sec-' + k + '"><h2>' + DB.SECTIONS[k] + ' <span class="n">' + n + ' live</span></h2><p>' + intro[k] + '</p><div class="ogrid">' +
        (l.length ? l.map(offerCard).join('') : '<div class="card empty" style="grid-column:1/-1">No offers in this section right now. Check back soon.</div>') + '</div></section>';
    }).join('');
    return shell('offers', '<h1 class="page-title">Offers</h1><p class="page-sub">Copy a code, or tap Use in cart to apply it at checkout. Every offer has its own timer.</p>' +
      '<div class="jump">' + sec.map(function (k) { return '<a href="#/offers" data-act="jump" data-to="sec-' + k + '">' + DB.SECTIONS[k] + '</a>'; }).join('') + '</div>' + html);
  }
  var UPDATES = [
    { tag: 'New launch', isNew: true, date: '2026-10-12', title: 'UENERGY is launching soon', text: 'A new energy brand is joining the S-ELEVEN family. Pre-booking details for dealers will be posted here.' },
    { tag: 'Price list', date: '2026-10-05', title: 'Price list refreshed (sample)', text: 'Your purchase prices are shown live in Generate Order. This is a sample update.' },
    { tag: 'Orders', date: '2026-09-28', title: 'Track every order in My Orders (sample)', text: 'Courier partner and tracking ID appear in Track order once your order is dispatched. This is a sample update.' },
    { tag: 'Notice', date: '2026-09-15', title: 'Keep your delivery address up to date (sample)', text: 'Check the delivery address at checkout before paying. This is a sample update.' }
  ];
  function viewUpdates() {
    return shell('updates', '<h1 class="page-title">Updates</h1><p class="page-sub">News and notices from S-ELEVEN for dealers.</p><div class="ulist">' + UPDATES.map(function (u) {
      return '<article class="card upd"><div class="top"><span class="utag' + (u.isNew ? ' new' : '') + '">' + esc(u.tag) + '</span><time>' + fdate(u.date) + '</time></div><h3>' + esc(u.title) + '</h3><p>' + esc(u.text) + '</p></article>';
    }).join('') + '</div>');
  }


  /* ===================== smart notifications ===================== */
  function nKey() { return 'notif.' + dealer.code; }
  function loadNotifs() { return dealer ? jget(store.get(nKey()), []) : []; }
  function saveNotifs(l) { store.set(nKey(), JSON.stringify(l.slice(0, 40))); }
  function unreadCount() { return loadNotifs().filter(function (n) { return !n.read; }).length; }
  function bellInner() { var u = dealer ? unreadCount() : 0; return ic('bell') + (u ? '<span class="badge">' + u + '</span>' : ''); }
  function addNotif(n) {
    n.id = 'n' + Date.now().toString(36) + Math.floor(Math.random() * 999); n.at = Date.now(); n.read = false;
    var l = loadNotifs(); l.unshift(n); saveNotifs(l); refreshChrome(); toast(n.title);
    if (window.Eleven) Eleven.notify(n);
    try { if ('Notification' in window && Notification.permission === 'granted' && document.hidden) new Notification(n.title, { body: n.text }); } catch (e) {}
  }
  /* compares the dealer's orders/offers/posts with the last snapshot; in the live version the same check runs on data from the server */
  function checkChanges(silent) {
    if (!dealer) return; try { DB.expirePreorders(); } catch (e0) {}
    var orders = DB.listOrders(dealer.code), offers = DB.offersFor(dealer), posts = DB.listPosts(), now = Date.now();
    var raw = store.get('snap.' + dealer.code), snap = raw ? jget(raw, null) : null, first = !snap || silent === true, out = [];
    snap = snap || { orders: {}, offers: {}, posts: {} }; snap.posts = snap.posts || {};
    orders.forEach(function (o) {
      var sh = o.shipment || {}, cur = { s: o.status, p: sh.partner || '', t: sh.trackingId || '', i: o.invoice ? o.invoice.no : '' }, prev = snap.orders[o.id];
      if (!prev && !first && o.createdBy && o.createdBy.role !== 'dealer') out.push({ type: 'order', orderId: o.id, title: o.source === 'PREORDER' ? 'Stock is ready for your preorder: pay to confirm' : 'Sales order ' + o.id + ' created for you', text: (o.source === 'PREORDER' ? 'Stock is reserved for you. Pay before ' + fdt(o.payBy) + '. ' : 'S-ELEVEN team entered this order. ') + 'Total ' + inr2(o.totals.total) + (o.payment.status === 'Paid' ? ' \u00B7 paid' : ' \u00B7 payment pending'), say: 'Our team created a sales order for you, ' + o.id + '.' });
      if (prev && !first) {
        var sc = prev.s !== cur.s, tc = cur.t && (prev.p !== cur.p || prev.t !== cur.t), ic2 = cur.i && !prev.i;
        if (ic2) out.push({ type: 'doc', orderId: o.id, title: 'Invoice ' + cur.i + ' is ready', text: 'Payment received for order ' + o.id + '. Open it from My Orders.', say: 'Payment received. Your invoice for order ' + o.id + ' is ready.' });
        if (sc || tc) {
          var c = DB.getCourier(cur.p), cn = c ? c.name : cur.p;
          out.push({ type: 'order', orderId: o.id, title: sc ? 'Order ' + o.id + ' is now ' + o.status : 'Tracking added for order ' + o.id, text: cur.t ? 'Courier: ' + cn + ' \u00B7 Tracking ID ' + cur.t : 'Status updated by our logistics team.',
            say: 'Update on order ' + o.id + '. It is now ' + o.status + '.' + (cur.t ? ' Courier ' + cn + ', tracking ID ' + cur.t.split('').join(' ') + '.' : '') });
        }
      }
      snap.orders[o.id] = cur;
    });
    offers.forEach(function (of) {
      var st = DB.offerState(of, now), pv = snap.offers[of.id] || {};
      if (!first && st === 'live' && !pv.seen) out.push({ type: 'offer', title: 'New offer: ' + of.title, text: 'Code ' + of.code + ' \u00B7 ends in ' + DB.countdown(of.expiresAt - now), say: 'New offer. ' + of.title + '. Use code ' + of.code + '.' });
      if (!first && st === 'live' && !pv.soon && of.expiresAt - now < 2 * 3600000) { pv.soon = true; out.push({ type: 'offer', title: 'Offer ending soon: ' + of.title, text: 'Code ' + of.code + ' ends in ' + DB.countdown(of.expiresAt - now), say: of.title + ' ends soon. Use code ' + of.code + ' before it expires.' }); }
      if (st === 'live' || st === 'expired') pv.seen = true;
      snap.offers[of.id] = pv;
    });
    posts.forEach(function (p) { if (!first && !snap.posts[p.id]) out.push({ type: 'post', title: 'New from S-ELEVEN: ' + p.title, text: p.text.slice(0, 90), say: 'New post from S-ELEVEN. ' + p.title + '.' }); snap.posts[p.id] = 1; });
    store.set('snap.' + dealer.code, JSON.stringify(snap));
    out.forEach(addNotif);
  }
  setInterval(checkChanges, 4000);
  function openNotifs() {
    var l = loadNotifs();
    var rows = l.length ? l.map(function (n) {
      var btn = n.type === 'order' ? ' <button class="rm" type="button" data-act="track" data-id="' + esc(n.orderId) + '">Track order</button>' : (n.type === 'doc' ? ' <button class="rm" type="button" data-act="doc" data-id="' + esc(n.orderId) + '" data-t="inv">Open invoice</button>' : (n.type === 'post' ? ' <button class="rm" type="button" data-act="gohome">Open feed</button>' : ' <button class="rm" type="button" data-act="gooffers">View offers</button>'));
      return '<div class="nitem ' + n.type + (n.read ? '' : ' unread') + '"><span class="ni">' + ic(n.type === 'order' ? 'truck' : (n.type === 'doc' ? 'file' : 'tag')) + '</span><div><b>' + esc(n.title) + '</b><p>' + esc(n.text) + '</p><time>' + fdt(new Date(n.at).toISOString()) + '</time>' + btn + '</div></div>';
    }).join('') : '<p class="osm" style="padding:14px 0">No notifications yet. You will be told here when an order status or tracking ID changes, when an invoice is ready, and when new offers or posts arrive.</p>';
    var canAsk = ('Notification' in window) && Notification.permission === 'default';
    openModal('<button class="xbtn" type="button" data-act="closemodal" aria-label="Close">\u00D7</button><h2>Notifications</h2><p class="osm">Orders, invoices, offers and posts.</p><div class="nlist">' + rows + '</div>' +
      '<div class="oacts">' + (canAsk ? '<button class="btn ghost sm" type="button" data-act="allowalerts">Turn on desktop alerts</button>' : '') + '<button class="btn blue sm" type="button" data-act="closemodal">Done</button></div>', 'modal', true);
    saveNotifs(l.map(function (n) { n.read = true; return n; })); refreshChrome();
  }

  /* ===================== router ===================== */
  /* ---------- ledger and returns (read-only for the dealer; Finance posts) ---------- */
  var ledF = '', ledT = '';
  function dStat(s) { return { 'Return requested': 'Request received', 'Approved: awaiting goods': 'Approved: please send the goods back', 'Partly received': 'Part of the goods received', 'Inspection pending': 'Goods received: being inspected', 'Accepted': 'Inspected: accepted', 'Partially accepted': 'Inspected: partly accepted', 'Rejected after inspection': 'Inspected: not accepted', 'Credit note issued': 'Credit note issued', 'Rejected': 'Return not approved', 'Closed': 'Closed' }[s] || s; }
  function bal(b) { return inr(Math.abs(b), 2) + (b > 0.004 ? ' Dr' : (b < -0.004 ? ' Cr' : '')); }
  function viewLedger() {
    var all = DB.dlLedger(dealer.code), st = ledF ? new Date(ledF + 'T00:00:00').getTime() : -Infinity, en = ledT ? new Date(ledT + 'T23:59:59').getTime() : Infinity, open = 0, dr = 0, cr = 0;
    all.forEach(function (x) { if (x.at < st) open += x.debit - x.credit; }); var run = open;
    var rows = all.filter(function (x) { return x.at >= st && x.at <= en; }).map(function (x) { run += x.debit - x.credit; dr += x.debit; cr += x.credit; return '<tr><td>' + new Date(x.at).toLocaleDateString('en-IN') + '</td><td>' + esc(x.type) + (x.noteNo ? '<br><span class="osm">' + esc(x.noteNo) + '</span>' : '') + '</td><td>' + esc(x.orderId || '') + '</td><td>' + esc(x.desc) + '</td><td class="r">' + (x.debit ? inr(x.debit, 2) : '') + '</td><td class="r">' + (x.credit ? inr(x.credit, 2) : '') + '</td><td class="r"><b>' + bal(run) + '</b></td></tr>'; }).join('');
    return shell('ledger', '<h1 class="page-title">My Ledger</h1><p class="page-sub">Your account statement with S-ELEVEN. Entries are posted by our Finance team and cannot be changed here.</p><section class="card" style="padding:16px"><div class="rowbtns"><label class="osm" for="led-f">From</label><input class="sel" id="led-f" type="date" value="' + esc(ledF) + '"><label class="osm" for="led-t">to</label><input class="sel" id="led-t" type="date" value="' + esc(ledT) + '"><button class="btn ghost sm" type="button" data-act="ledcsv">Download CSV</button></div><p class="osm" style="margin-top:8px"><b>How to read it:</b> Debit is an amount you owe S-ELEVEN (invoices, debit notes). Credit is an amount received or credited (payments, credit notes, returns). Balance = debits \u2212 credits. <b>Dr</b> means you owe us, <b>Cr</b> means we owe you.</p></section>' +
      '<div class="kpis" style="margin-top:14px"><div class="card kpi"><small>Opening balance</small><b>' + bal(open) + '</b></div><div class="card kpi"><small>Debits</small><b>' + inr(dr, 2) + '</b></div><div class="card kpi"><small>Credits</small><b>' + inr(cr, 2) + '</b></div><div class="card kpi"><small>Closing balance</small><b>' + bal(run) + '</b></div></div>' +
      '<section class="card" style="padding:16px;margin-top:14px"><div class="tblwrap"><table class="tbl"><thead><tr><th>Date</th><th>Type</th><th>Order</th><th>Description</th><th class="r">Debit</th><th class="r">Credit</th><th class="r">Balance</th></tr></thead><tbody>' + (rows || '<tr><td colspan="7" class="osm">No entries in this period.</td></tr>') + '</tbody></table></div></section>');
  }
  function viewReturns() {
    var l = DB.listReturns(dealer.code), cards = l.map(function (r) {
      var steps = r.history.map(function (h) { return '<li>' + esc(dStat(h.s)) + ' <span class="osm">' + new Date(h.at).toLocaleDateString('en-IN') + '</span></li>'; }).join('');
      var lines = r.lines.map(function (x) { return '<tr><td>' + esc(x.name) + '</td><td class="r">' + x.qty + '</td><td class="r">' + x.recv + '</td><td class="r">' + x.acc + '</td><td class="r">' + (x.recv ? x.recv - x.acc : 0) + '</td></tr>'; }).join('');
      return '<section class="card" style="padding:16px;margin-top:12px"><div class="rowbtns" style="justify-content:space-between"><h3>' + esc(r.id) + ' <span class="osm">for order ' + esc(r.orderId) + '</span></h3><span class="tag live">' + esc(dStat(r.status)) + '</span></div><p class="osm">Requested ' + new Date(r.at).toLocaleDateString('en-IN') + ' \u00B7 ' + esc(r.reason) + '</p><div class="tblwrap"><table class="tbl"><thead><tr><th>Product</th><th class="r">Requested</th><th class="r">Received</th><th class="r">Accepted</th><th class="r">Not accepted</th></tr></thead><tbody>' + lines + '</tbody></table></div>' +
        (r.creditNote ? '<p style="margin-top:8px">Credit note <b>' + esc(r.creditNote) + '</b> for ' + inr(r.creditAmt, 2) + (r.refund ? ' \u00B7 refund: <b>' + (r.refund === 'Refunded' ? 'paid' : 'pending') + '</b>' : '') + '</p>' : (['Accepted', 'Partially accepted'].indexOf(r.status) > -1 ? '<p style="margin-top:8px">Credit note: <b>being prepared</b></p>' : '')) + '<ul class="osm" style="margin:8px 0 0 18px">' + steps + '</ul></section>';
    }).join('') || '<section class="card empty"><p>You have no returns. To return goods open My Orders and choose Return items on a delivered order.</p></section>';
    return shell('returns', '<h1 class="page-title">My Returns</h1><p class="page-sub">Track each return: approval, receipt at our warehouse, inspection, credit note and refund.</p>' + cards);
  }
  function editModalD(o) {
    var es = DB.editState(o); if (!es.ok) { toast(es.why); return; } var skus = []; SEL.BRANDS.forEach(function (b) { (SEL.CATALOG[b.id] || []).forEach(function (p) { p.variants.forEach(function (v) { skus.push('<option value="' + esc(p.id + '|' + v.id + '|' + ((p.flavours && p.flavours[0]) || '')) + '">' + esc(b.name + ' ' + p.name.split(' (')[0] + ' ' + v.label) + '</option>'); }); }); });
    var rows = o.items.map(function (l) { return '<tr><td>' + esc(l.product) + ' <span class="osm">' + esc(l.variant) + '</span></td><td class="r">' + inr2(l.price) + '</td><td class="r"><input class="sel eq" data-spec="' + esc(l.pid + '|' + l.vid + '|' + (l.flavour || '')) + '" type="number" min="0" value="' + l.qty + '" style="width:5rem" aria-label="Quantity"></td></tr>'; }).join('');
    openModal('<h2>Edit order ' + esc(o.id) + '</h2><p class="osm">' + esc(es.note) + (es.mode === 'pending' ? ' Set a quantity to 0 to remove a product.' : ' Once the difference is paid the order is locked.') + '</p><div class="tblwrap"><table class="tbl"><thead><tr><th>Product</th><th class="r">Price (incl. GST)</th><th class="r">Quantity</th></tr></thead><tbody>' + rows + '</tbody></table></div><div class="rowbtns" style="margin-top:8px"><select class="sel" id="eadd" style="max-width:18rem"><option value="">Add a product\u2026</option>' + skus.join('') + '</select><input class="sel" id="eaddq" type="number" min="1" value="1" style="width:5rem" aria-label="Quantity to add"></div><p class="err" id="eerr" role="alert"></p><div class="rowbtns" style="margin-top:8px"><button class="btn" type="button" data-act="esave" data-id="' + esc(o.id) + '">Save changes</button><button class="btn ghost" type="button" data-act="closemodal">Cancel</button></div>');
  }
  /* v31: compress photos in the browser (mobile cameras produce very large files) before they are sent */
  function shrinkImages(files, maxN, cb) {
    files = [].slice.call(files || []).slice(0, maxN || 8); var out = [], left = files.length; if (!left) return cb([]);
    files.forEach(function (f, idx) {
      if (!/^image\//.test(f.type || '')) { out[idx] = null; if (!--left) cb(out.filter(Boolean)); return; }
      var rd = new FileReader();
      rd.onload = function () {
        var img = new Image();
        img.onload = function () {
          try {
            var max = 1280, w = img.width, h = img.height, sc = Math.min(1, max / Math.max(w, h));
            var cw = Math.max(1, Math.round(w * sc)), ch = Math.max(1, Math.round(h * sc));
            var cv = document.createElement('canvas'); cv.width = cw; cv.height = ch; cv.getContext('2d').drawImage(img, 0, 0, cw, ch);
            out[idx] = cv.toDataURL('image/jpeg', 0.82);
          } catch (e) { out[idx] = /^data:image\//.test(rd.result) ? rd.result : null; }
          if (!--left) cb(out.filter(Boolean));
        };
        img.onerror = function () { out[idx] = null; if (!--left) cb(out.filter(Boolean)); };
        img.src = rd.result;
      };
      rd.onerror = function () { out[idx] = null; if (!--left) cb(out.filter(Boolean)); };
      rd.readAsDataURL(f);
    });
  }
  function returnModal(o) {
    var rows = o.items.map(function (i) { var sk = SEL.sku(i.pid, i.vid); return '<tr><td>' + esc(i.product) + ' <span class="osm">' + esc(i.variant) + '</span></td><td class="r">' + i.qty + '</td><td class="r"><input class="sel rq" data-sku="' + esc(sk) + '" type="number" min="0" max="' + i.qty + '" value="0" style="width:5rem" aria-label="Quantity to return"></td></tr>'; }).join('');
    openModal('<h2>Return items</h2><p class="osm">Order ' + esc(o.id) + '. Choose the quantity to return. Finance reviews every request.</p><div class="tblwrap"><table class="tbl"><thead><tr><th>Product</th><th class="r">Ordered</th><th class="r">Return</th></tr></thead><tbody>' + rows + '</tbody></table></div><div class="field"><label for="rt-why">Reason for the return</label><input id="rt-why" placeholder="e.g. damaged in transit / wrong item"></div><div class="field"><label for="rt-imgs">Photos of the goods (at least 3, for verification)</label><input id="rt-imgs" type="file" accept="image/*" multiple capture="environment"><div id="rt-imgc" class="osm" style="margin-top:4px">No photos selected yet — add at least 3.</div></div><p class="err" id="rt-err" role="alert"></p><div class="rowbtns"><button class="btn" type="button" data-act="retsend" data-id="' + esc(o.id) + '">Send return request</button><button class="btn ghost" type="button" data-act="closemodal">Cancel</button></div>');
  }
  function csvDown(name, rows) { var s = rows.map(function (r) { return r.map(function (c) { c = String(c == null ? '' : c); if (/^[=+@\t\r]/.test(c) || (/^-/.test(c) && isNaN(Number(c)))) c = "'" + c; return /[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c; }).join(','); }).join('\r\n'), a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([s], { type: 'text/csv' })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); }
  document.addEventListener('change', function (e) { var t = e.target; if (t.id === 'led-f') { ledF = t.value; render(true); } else if (t.id === 'led-t') { ledT = t.value; render(true); } else if (t.id === 'rt-imgs') { var c = document.getElementById('rt-imgc'); if (c) { var n = (t.files || []).length; c.textContent = n ? (n + ' photo' + (n === 1 ? '' : 's') + ' selected' + (n < 3 ? ' — add at least ' + (3 - n) + ' more' : ' ✔')) : 'No photos selected yet — add at least 3.'; c.style.color = n >= 3 ? '#1a8f4a' : ''; } } });

  /* ---------- v11: preorders with several products, editable (dealer) ---------- */
  var pbd = { lines: [], edit: '', pid: '', vid: '', fl: '', q: 1 };
  function pbdHtml() {
    var pr = '<option value="">Choose a product</option>' + SEL.BRANDS.filter(function (b) { return SEL.CATALOG[b.id].length; }).map(function (b) { return '<optgroup label="' + esc(b.name) + '">' + SEL.CATALOG[b.id].map(function (p) { return '<option value="' + esc(p.id) + '"' + (p.id === pbd.pid ? ' selected' : '') + '>' + esc(p.name.split(' (')[0]) + '</option>'; }).join('') + '</optgroup>'; }).join('');
    var f = pbd.pid ? SEL.findProduct(pbd.pid) : null, vs = f ? f.product.variants : [], vid = pbd.vid || (vs[0] && vs[0].id) || '', fm = DB.flavourMap();
    var vsel = vs.length ? '<select id="pbd-v">' + vs.map(function (v) { return '<option value="' + v.id + '"' + (v.id === vid ? ' selected' : '') + '>' + esc(v.label) + '</option>'; }).join('') + '</select>' : '<select id="pbd-v" disabled><option>Pack size</option></select>';
    var fls = f ? (f.product.flavours || []) : [], fsel = fls.length ? '<select id="pbd-f">' + fls.map(function (x) { var s = DB.flavourStatus(pbd.pid, vid, x, fm); return '<option value="' + esc(x) + '"' + (x === pbd.fl ? ' selected' : '') + '>' + esc(x + ' \u2014 ' + s.text) + '</option>'; }).join('') + '</select>' : '<select id="pbd-f" disabled><option>' + (f ? 'No flavours' : 'Flavour') + '</option></select>';
    var lines = pbd.lines.map(function (x, i) { return '<div class="line"><div class="lt"><div><div class="nm">' + esc(x.product.split(' (')[0]) + '</div><div class="sb">' + esc(x.variant + (x.flavour ? ' \u00B7 ' + x.flavour : '')) + '</div></div></div><input class="sel pbd-q" data-i="' + i + '" type="number" min="1" value="' + x.qty + '" style="width:5rem" aria-label="Quantity"><button class="btn ghost sm" type="button" data-act="pbddel" data-i="' + i + '" aria-label="Remove">\u2715</button></div>'; }).join('');
    return '<section class="card panel" style="margin:14px 0"><h2>' + (pbd.edit ? 'Edit preorder ' + esc(pbd.edit) : 'Create a preorder') + '</h2><p class="osm">Add as many products as you like. Nothing is charged now. You can change a preorder until stock is reserved for it; then you have 2 hours to pay, and we ship only after payment (within 36 hours).</p><div class="fgrid"><div class="field"><label for="pbd-p">Product</label><select id="pbd-p">' + pr + '</select></div><div class="field"><label for="pbd-v">Pack size</label>' + vsel + '</div><div class="field"><label for="pbd-f">Flavour</label>' + fsel + '</div><div class="field"><label for="pbd-q">Quantity</label><input id="pbd-q" type="number" min="1" value="' + pbd.q + '"></div></div><button class="btn ghost sm" type="button" data-act="pbdadd">Add to preorder</button>' + lines + '<p class="err" id="pbd-err" role="alert"></p><div class="acts"><button class="btn" type="button" data-act="pbdsave">' + (pbd.edit ? 'Save changes' : 'Create preorder') + '</button>' + (pbd.edit ? '<button class="btn ghost" type="button" data-act="pbdstop">Stop editing</button>' : '') + '</div></section>';
  }
  function viewPreorders() {
    var l = DB.listPreorders(dealer.code).slice().sort(function (a, b) { return b.createdAt - a.createdAt; });
    var cards = l.map(function (p) { var wait = p.status === 'Waiting for stock', pay = p.status.indexOf('pay now') > -1; return '<section class="card" style="padding:16px;margin-top:12px"><div class="rowbtns" style="justify-content:space-between"><h3>' + esc(p.id) + '</h3><span class="tag live">' + esc(p.status) + '</span></div><p class="osm">' + new Date(p.createdAt).toLocaleDateString('en-IN') + ' \u00B7 value ' + inr2(p.value) + ' (prices are locked)</p>' + p.items.map(function (x) { return '<div>' + esc(x.product.split(' (')[0]) + ' <span class="osm">' + esc(x.variant) + (x.flavour ? ' \u00B7 ' + esc(x.flavour) : '') + '</span> \u00D7 ' + x.qty + '</div>'; }).join('') + '<ul class="osm" style="margin:8px 0 0 18px">' + p.history.map(function (h) { return '<li>' + esc(h.s) + ' <span class="osm">' + new Date(h.at).toLocaleDateString('en-IN') + '</span></li>'; }).join('') + '</ul><div class="acts" style="margin-top:8px">' + (wait ? '<button class="btn ghost sm" type="button" data-act="pbdedit" data-id="' + esc(p.id) + '">Edit</button><button class="btn ghost sm" type="button" data-act="precancel" data-id="' + esc(p.id) + '">Cancel</button>' : '') + (pay ? '<a class="btn sm" href="#/orders">Pay now</a>' : '') + '</div></section>'; }).join('') || '<section class="card empty"><p>You have no preorders yet.</p></section>';
    return shell('preorders', '<h1 class="page-title">My Preorders</h1><p class="page-sub">Preorder products that are out of stock, several at a time. Edit a preorder any time until stock is reserved for you.</p>' + pbdHtml() + cards);
  }
  document.addEventListener('change', function (e) { var t = e.target; if (!t.id && !(t.classList && t.classList.contains('pbd-q'))) return; if (t.id === 'pbd-p') { pbd.pid = t.value; pbd.vid = ''; pbd.fl = ''; render(true); } else if (t.id === 'pbd-v') { pbd.vid = t.value; render(true); } else if (t.id === 'pbd-f') pbd.fl = t.value; else if (t.classList && t.classList.contains('pbd-q')) pbd.lines[+t.getAttribute('data-i')].qty = Math.max(1, parseInt(t.value, 10) || 1); });

  function route() { var p = (location.hash || '#/').replace(/^#\/?/, '').split('/'); return { name: p[0] || 'home', arg: p[1] || '' }; }
  function go(path) { var t = '#/' + path; if (location.hash === t) render(true); else location.hash = t; }
  function render(keepScroll) {
    DB.applyBrands(); var app = $('#app'), y = window.scrollY;
    if (dealer) { var fresh = DB.getDealer(dealer.code); if (fresh) dealer = fresh; }
    if (!dealer) { app.innerHTML = viewLogin(); document.body.classList.remove('hascart'); return; }
    var r = route(), html;
    switch (r.name) {
      case 'order': html = viewOrder(r.arg); break;
      case 'orders': html = viewOrders(); break;
      case 'ledger': html = viewLedger(); break;
      case 'preorders': html = viewPreorders(); break;
      case 'returns': html = viewReturns(); break;
      case 'offers': html = viewOffers(); break;
      case 'updates': html = viewUpdates(); break;
      case 'cart': html = viewCart(); break;
      case 'checkout': html = viewCheckout(); break;
      case 'done': html = viewDone(r.arg); break;
      default: html = viewHome();
    }
    /* keep any order dropdown the dealer has open from collapsing when a background refresh re-renders */
    var openOrders = [].slice.call(app.querySelectorAll('details.order[open]')).map(function (d) { return d.getAttribute('data-oid'); });
    app.innerHTML = html;
    if (openOrders.length) openOrders.forEach(function (oid) { var d = oid && app.querySelector('details.order[data-oid="' + (window.CSS && CSS.escape ? CSS.escape(oid) : oid) + '"]'); if (d) d.open = true; });
    document.body.classList.toggle('hascart', !!$('.cartbar'));
    document.title = (r.name === 'home' ? 'Dealer Portal' : r.name.charAt(0).toUpperCase() + r.name.slice(1)) + ' | S-ELEVEN Nutrition';
    window.scrollTo(0, keepScroll === true ? y : 0);
    tick();
  }
  function refreshChrome() {
    var bb = $('.bellbtn'); if (bb) bb.innerHTML = bellInner();
    var cart = repriceCart(loadCart()), n = cartCount(cart);
    var a = $('.hdr-right a.icon-btn'); if (a) { a.innerHTML = ic('cart') + '<span class="lbl">Cart</span>' + (n ? '<span class="badge">' + n + '</span>' : ''); a.setAttribute('aria-label', 'Cart, ' + n + ' items'); }
    var old = $('.cartbar'); if (old) old.remove();
    if (n && route().name === 'order') { var d = document.createElement('div'); d.className = 'cartbar'; d.innerHTML = cartBar().replace(/^<div class="cartbar">|<\/div>$/g, ''); $('#app').appendChild(d); }
    document.body.classList.toggle('hascart', !!$('.cartbar'));
  }
  /* countdown timers: one interval updates every timer on screen */
  function tick() {
    $$('.cd[data-exp]').forEach(function (el) {
      var exp = +el.getAttribute('data-exp'), ms = exp - Date.now();
      el.textContent = DB.countdown(ms);
      el.classList.toggle('urgent', ms > 0 && ms < 12 * 3600000);
      if (ms <= 0) { el.classList.add('end'); var card = el.closest('.offer'); if (card) { card.classList.add('expired'); var u = $('.use', card); if (u) u.disabled = true; } }
    });
  }
  setInterval(tick, 1000);

  /* ---------- sales order -> gateway -> tax invoice ---------- */
  var gwOrder = null, gwFrom = '';
  /* v32: pay by scanning the S-ELEVEN QR / bank transfer, then attach the payment screenshot. Finance confirms it. */
  var PAYTO = { name: 'S11 Nutrition Pvt. Ltd.', bank: 'IDFC FIRST Bank', upi: 'selev@idfcbank', account: '', ifsc: '', branch: '' };
  function shotNote(o) {
    var ps = (o.proofs || []); if (ps.some(function (x) { return x.status === 'Awaiting verification'; })) return 'Screenshot received · Finance is confirming';
    var last = ps[ps.length - 1]; if (last && last.status === 'Rejected') return 'Screenshot not accepted: ' + (last.reason || 'please upload again'); return 'Payment pending';
  }
  function openGateway(orderId) {
    var o = findOrder(orderId); if (!o) return; gwOrder = orderId; var due = DB.dueOf(o);
    var rows = [['Account name', PAYTO.name], ['Bank', PAYTO.bank], ['Account number', PAYTO.account], ['IFSC', PAYTO.ifsc], ['Branch', PAYTO.branch], ['UPI ID', PAYTO.upi]].filter(function (r) { return r[1]; }).map(function (r) { return '<div class="srow"><span>' + r[0] + '</span><b>' + esc(r[1]) + '</b></div>'; }).join('');
    var last = (o.proofs || []).slice(-1)[0], rej = last && last.status === 'Rejected' ? '<p class="err" role="alert">Your last screenshot was not accepted: ' + esc(last.reason || '') + '. Please pay and upload a clear screenshot.</p>' : '';
    openModal('<h2>Pay ' + esc(o.id) + '</h2><div class="amt">' + inr2(due) + '</div><p class="osm" style="text-align:center">Total payable amount</p>' + rej +
      '<div style="display:flex;flex-wrap:wrap;gap:18px;margin-top:12px;align-items:flex-start">' +
      '<div style="flex:1 1 220px;text-align:center"><img src="img/pay-qr.png" alt="S-ELEVEN payment QR code, UPI ID ' + esc(PAYTO.upi) + '" style="width:100%;max-width:240px;border:1px solid var(--line,#d8dee9);border-radius:10px"><div style="margin-top:6px"><button class="btn ghost sm" type="button" data-act="copyupi">Copy UPI ID</button></div></div>' +
      '<div style="flex:1 1 240px;min-width:0"><h3 style="margin:0 0 6px">Bank details</h3>' + rows + '<div class="field" style="margin-top:14px"><label for="gwfile">Attach payment screenshot</label><input id="gwfile" type="file" accept="image/*"></div>' +
      '<div class="field"><label for="gwref">UTR / transaction ID (optional)</label><input id="gwref" autocomplete="off" placeholder="e.g. 4126XXXXXXXX"></div><p class="err" id="gwerr" role="alert"></p></div></div>' +
      '<p class="osm" style="margin-top:10px">Pay the exact amount above by scanning the QR with any UPI app or by bank transfer, then attach the screenshot. Your order is confirmed once our Finance team verifies the payment.</p>' +
      '<div class="acts"><button class="btn" type="button" data-act="payshot">Submit screenshot for verification</button><button class="rm" type="button" data-act="closegw" style="justify-content:center">Close</button></div>', 'gw');
  }
  function gwClose() { closeModal('gw'); if (gwFrom === 'checkout' && gwOrder) go('done/' + gwOrder); }
  function placeSalesOrder() {
    var cart = repriceCart(loadCart()), cp = currentCoupon(cart), co = getCheckout(), now = new Date().toISOString(), gj = gjOf(co.address, co.pin);
    var order = { id: DB.newOrderId(), date: now, status: 'Placed', payment: { method: PM[co.pm || 'upi'], status: 'Pending', txn: '' }, items: cart, totals: DB.calcTotals(cart, cp, gj, DB.freightOpt(dealer)),
      address: co.address, pin: co.pin, phone: co.phone, gst: co.gst, note: co.note, shipment: null, history: [{ status: 'Placed', at: now }],
      buyer: { name: dealer.name, gst: co.gst, address: dealer.address, pin: dealer.pincode, phone: dealer.phone }, ship: { address: co.address, pin: co.pin, phone: co.phone }, createdBy: { code: dealer.code, name: dealer.name, role: 'dealer' } };
    var fo = DB.freebieOptions(dealer.code, cart, cp ? cp.code : null), fsel = trimFb(getFb(), fo), fpicks = Object.keys(fsel).map(function (k) { return { fid: k, qty: fsel[k] }; });
    if (fpicks.length) { var fv = DB.validateFreebies(dealer.code, cart, cp ? cp.code : null, fpicks); if (fv.ok) { order.freebies = fv.list; order.freebieValue = fv.used; } } sess.del('fb.' + dealer.code);
    DB.addOrder(dealer.code, order); saveCart([]); sess.del('coupon.' + dealer.code); setCheckout({}); checkChanges(true); return order;
  }

  /* ===================== events ===================== */
  function copyText(t) {
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(t).then(function () { toast('Copied: ' + t); }, function () { toast(t); });
    else toast(t);
  }
  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-act]'); if (!el) return;
    var act = el.getAttribute('data-act'), key = el.getAttribute('data-key'), cart;
    switch (act) {
      case 'togglepw': var pw = $('#dpass'); pw.type = pw.type === 'password' ? 'text' : 'password'; el.textContent = pw.type === 'password' ? 'Show' : 'Hide'; break;
      case 'logout': sess.del('dealer'); dealer = null; if (window.Eleven) Eleven.reset(); if (location.hash === '#/' || location.hash === '') render(); else location.hash = '#/'; break;
      case 'qdec': case 'qinc': var inp = $('[data-qty]', el.closest('.addrow')), v = parseInt(inp.value, 10) || 1; inp.value = Math.max(1, Math.min(999, v + (act === 'qinc' ? 1 : -1))); break;
      case 'preorder':
        var pc = el.closest('.pcard'), ppid = pc.getAttribute('data-pid'), pvr = $('input[type=radio]:checked', pc), pfl = $('select', pc), pq = parseInt($('[data-qty]', pc).value, 10) || 1, pr0 = DB.addPreorder(dealer.code, { pid: ppid, vid: pvr.value, flavour: pfl ? pfl.value : '', qty: pq, by: dealer.code });
        if (pr0.error) { toast(pr0.error); break; } openModal('<h2>Preorder placed</h2><p><b>' + esc(pr0.preorder.id) + '</b>: ' + pq + ' \u00D7 ' + esc(pr0.preorder.product.split(' (')[0]) + ' ' + esc(pr0.preorder.variant) + '</p><p class="osm" style="margin-top:8px">Nothing to pay now. When stock arrives we reserve it for you (oldest preorder first), tell you here, and you have 2 hours to pay. Your price is locked at ' + inr(pr0.preorder.price) + ' per unit. We ship only after payment.</p><div class="acts"><a class="btn" href="#/orders">See my preorders</a><button class="btn ghost" type="button" data-act="closemodal">Close</button></div>', 'modal', true); break;
      case 'precancel': DB.cancelPreorder(el.getAttribute('data-id')); render(true); break;
      case 'fbinc': case 'fbdec':
        var cart9 = repriceCart(loadCart()), cp9 = currentCoupon(cart9), o9 = DB.freebieOptions(dealer.code, cart9, cp9 ? cp9.code : null), sel9 = trimFb(getFb(), o9), fid = el.getAttribute('data-f'), f9 = o9.items.filter(function (x) { return x.id === fid; })[0]; if (!f9) break;
        var nq = (sel9[fid] || 0) + (act === 'fbinc' ? 1 : -1); if (nq < 0) break; if (nq > f9.maxQty || nq > f9.qty) { toast('You can take up to ' + Math.min(f9.maxQty, f9.qty) + ' of this freebie'); break; }
        var tot9 = 0; Object.keys(sel9).forEach(function (k) { var ff = o9.items.filter(function (x) { return x.id === k; })[0]; if (ff && k !== fid) tot9 += ff.valuation * sel9[k]; }); if (tot9 + nq * f9.valuation > o9.allowance) { toast('That is above your freebie allowance of ' + inr(o9.allowance) + (o9.wallet ? ' (includes ' + inr(o9.wallet) + ' from your freebie wallet)' : '')); break; }
        sel9[fid] = nq; if (!nq) delete sel9[fid]; setFb(sel9); render(true); break;
      case 'add':
        var card = el.closest('.pcard'), pid = card.getAttribute('data-pid'), vr = $('input[type=radio]:checked', card), fl = $('select', card), q = parseInt($('[data-qty]', card).value, 10) || 1;
        var have = 0, av0 = DB.flavourStock2(pid, vr.value, fl ? fl.value : '').avail; loadCart().forEach(function (l0) { if (l0.pid === pid && l0.vid === vr.value && (l0.flavour || '') === (fl ? fl.value : '')) have += l0.qty; });
        if (have + q > av0) { toast(av0 <= 0 ? 'Out of stock. You can preorder this pack.' : 'Only ' + av0 + ' in stock' + (have ? ' (you already have ' + have + ' in your cart)' : '') + '. Preorder the rest.'); break; }
        addToCart(mkLine(pid, vr.value, fl ? fl.value : '', q)); refreshChrome(); toast('Added ' + q + ' \u00D7 ' + SEL.findProduct(pid).product.name + ' to cart'); break;
      case 'cinc': case 'cdec': cart = loadCart(); cart.forEach(function (l) { if (l.key === key) l.qty = Math.max(1, Math.min(999, l.qty + (act === 'cinc' ? 1 : -1))); }); saveCart(cart); render(true); break;
      case 'crm': saveCart(loadCart().filter(function (l) { return l.key !== key; })); render(true); break;
      case 'rmcoupon': sess.del('coupon.' + dealer.code); render(true); break;
      case 'pay':
        var ad = $('#co-addr').value.trim(), pn = $('#co-pin').value.replace(/\D/g, ''), ph = $('#co-phone').value.replace(/\D/g, ''), er = $('#coErr'), pe = $('input[name=pm]:checked');
        setCheckout({ address: ad, pin: pn, phone: $('#co-phone').value.trim(), gst: $('#co-gst').value.trim(), note: $('#co-note').value.trim(), pm: pe ? pe.value : 'upi' });
        if (ad.length < 10) { er.textContent = 'Please enter the full delivery address.'; $('#co-addr').focus(); break; }
        if (pn.length !== 6) { er.textContent = 'Please enter the 6-digit delivery pincode.'; $('#co-pin').focus(); break; }
        if (ph.length < 10) { er.textContent = 'Please enter a valid 10-digit contact number.'; $('#co-phone').focus(); break; }
        er.textContent = ''; var gone0 = DB.inactiveLines(repriceCart(loadCart())); if (gone0.length) { er.textContent = gone0[0].product.split(' (')[0] + ' is no longer available. Please remove it from your cart.'; return; } var short0 = repriceCart(loadCart()).filter(function (l) { return DB.stock(SEL.sku(l.pid, l.vid)).avail < l.qty; }); if (short0.length) { er.textContent = 'Not enough stock for ' + short0[0].product + ' ' + short0[0].variant + '. Please reduce the quantity in your cart, or preorder it.'; break; } var so = placeSalesOrder(); gwFrom = 'checkout'; toast('Sales order ' + so.id + ' created'); openGateway(so.id); break;
      case 'paynow': gwFrom = 'orders'; openGateway(el.getAttribute('data-id')); break;
      case 'doc': var dd = findOrder(el.getAttribute('data-id')), dty = el.getAttribute('data-t'); if (!dd) break; if (dty === 'inv' || dty === 'eway') { var ff = dty === 'inv' ? dd.invoiceFile : dd.ewayFile; if (ff) openFile(ff); else toast('Not uploaded yet.'); } else Docs.open(dd, dty); break;
      case 'closegw': gwClose(); break;
      case 'closemodal': closeModal(); break;
      case 'copyupi': copyText(PAYTO.upi); break;
      case 'payshot':
        var gf = $('#gwfile'), ge = $('#gwerr'); if (!gf || !gf.files || !gf.files.length) { ge.textContent = 'Please attach your payment screenshot first.'; break; } ge.textContent = ''; el.disabled = true;
        shrinkImages(gf.files, 1, function (imgs) {
          if (!imgs.length) { el.disabled = false; ge.textContent = 'Please attach an image (PNG or JPEG) of your payment.'; return; }
          var rs = DB.submitPayShot(dealer.code, gwOrder, { data: imgs[0], size: Math.round(imgs[0].length * 0.75), name: 'payment-screenshot.jpg', ref: ($('#gwref') || {}).value }, dealer.code);
          if (rs.error) { el.disabled = false; ge.textContent = rs.error; return; }
          var m = $('#gw .modal'); if (m) m.innerHTML = '<div class="tick" style="background:var(--green)">' + ic('check') + '</div><h2>Screenshot received</h2><p style="margin-top:8px">Thank you. Our Finance team will confirm your payment shortly. Your order is confirmed and your tax invoice is issued as soon as it is verified.</p><div class="acts"><button class="btn" type="button" data-act="closegw">OK</button></div>';
          checkChanges(true);
        }); break;
      case 'like': var ct = DB.toggleLike(el.getAttribute('data-id'), dealer.code); render(true); break;
      case 'postlink':
        var pst = DB.listPosts().filter(function (x) { return x.id === el.getAttribute('data-id'); })[0];
        if (pst && pst.link) { if (pst.link.type === 'order') window.PortalApp.search(pst.link.brand, ''); else go(pst.link.to || ''); } break;
      case 'suggest': window.PortalApp.search(el.getAttribute('data-brand'), el.getAttribute('data-q')); break;
      case 'oeditd': var eo = findOrder(el.getAttribute('data-id')); if (eo) editModalD(eo); break;
      case 'esave': var sp = [].slice.call(document.querySelectorAll('.eq')).map(function (i) { var p = i.getAttribute('data-spec').split('|'); return { pid: p[0], vid: p[1], flavour: p[2], qty: i.value }; }), ad = document.getElementById('eadd').value; if (ad) { var pp = ad.split('|'); sp.push({ pid: pp[0], vid: pp[1], flavour: pp[2], qty: document.getElementById('eaddq').value }); } var er = DB.editOrder(dealer.code, el.getAttribute('data-id'), sp, dealer.code, 'dealer'); if (er.error) { document.getElementById('eerr').textContent = er.error; break; } closeModal(); toast(er.mode === 'paid' ? 'Difference of ' + inr2(er.diff) + ' to pay. Dispatch waits until it is paid.' : 'Order updated.'); render(true); break;
      case 'paydiff': var pdo = findOrder(el.getAttribute('data-id')); if (pdo && window.confirm('Demo payment: pay the difference of ' + inr2(DB.dueOf(pdo)) + ' now?')) { var rq = DB.rzpCreate(dealer.code, pdo.id, 'LINK', dealer.code); if (rq.error) { toast(rq.error); break; } DB.rzpPaid(dealer.code, pdo.id, rq.rzp.id, dealer.code); toast('Difference paid. Your order is updated and locked.'); render(true); } break;
      case 'diffx': var cd = DB.cancelDiff(dealer.code, el.getAttribute('data-id'), dealer.code); toast(cd.error || 'The change was cancelled.'); render(true); break;
      case 'revconf': var rc = DB.confirmRevision(dealer.code, el.getAttribute('data-id'), dealer.code, 'dealer'); toast(rc.error || 'Revision confirmed. Credit note ' + rc.cn + ' added to your ledger.'); closeModal && closeModal(); render(true); break;
      case 'revcancel': var rx = DB.cancelRevision(dealer.code, el.getAttribute('data-id'), dealer.code); toast(rx.error || 'Revision declined'); closeModal && closeModal(); render(true); break;
      case 'pbdadd': if (!pbd.pid) { $('#pbd-err').textContent = 'Choose a product.'; break; } var pf0 = SEL.findProduct(pbd.pid), pv0 = pf0.product.variants.filter(function (v) { return v.id === (pbd.vid || pf0.product.variants[0].id); })[0], pfl0 = (pf0.product.flavours || []).length ? (pbd.fl || pf0.product.flavours[0]) : '', pq0 = parseInt($('#pbd-q').value, 10) || 1, pex = pbd.lines.filter(function (x) { return x.pid === pbd.pid && x.vid === pv0.id && x.flavour === pfl0; })[0]; if (pex) pex.qty += pq0; else pbd.lines.push({ pid: pbd.pid, vid: pv0.id, flavour: pfl0, qty: pq0, product: pf0.product.name, variant: pv0.label }); render(true); break;
      case 'pbddel': pbd.lines.splice(+el.getAttribute('data-i'), 1); render(true); break;
      case 'pbdsave': document.querySelectorAll('.pbd-q').forEach(function (i) { if (pbd.lines[+i.getAttribute('data-i')]) pbd.lines[+i.getAttribute('data-i')].qty = Math.max(1, parseInt(i.value, 10) || 1); }); var pr1 = pbd.edit ? DB.editPreorder(pbd.edit, pbd.lines, dealer.code) : DB.createPreorder(dealer.code, pbd.lines, dealer.code); if (pr1.error) { $('#pbd-err').textContent = pr1.error; break; } toast(pbd.edit ? 'Preorder updated' : 'Preorder ' + pr1.preorder.id + ' created'); pbd = { lines: [], edit: '', pid: '', vid: '', fl: '', q: 1 }; render(true); break;
      case 'pbdedit': var pe = DB.listPreorders(dealer.code).filter(function (x) { return x.id === el.getAttribute('data-id'); })[0]; if (pe) { pbd = { lines: pe.items.map(function (x) { return { pid: x.pid, vid: x.vid, flavour: x.flavour, qty: x.qty, product: x.product, variant: x.variant }; }), edit: pe.id, pid: '', vid: '', fl: '', q: 1 }; render(true); window.scrollTo(0, 0); } break;
      case 'pbdstop': pbd = { lines: [], edit: '', pid: '', vid: '', fl: '', q: 1 }; render(true); break;
      case 'retopen': var ro = findOrder(el.getAttribute('data-id')); if (ro) returnModal(ro); break;
      case 'retsend': {
        var lines = [].slice.call(document.querySelectorAll('.rq')).map(function (i) { return { sku: i.getAttribute('data-sku'), qty: parseInt(i.value, 10) || 0 }; }).filter(function (x) { return x.qty > 0; });
        var rid = el.getAttribute('data-id'), why = (document.getElementById('rt-why') || {}).value, errEl = document.getElementById('rt-err');
        var files = (document.getElementById('rt-imgs') || {}).files || [];
        if (!lines.length) { errEl.textContent = 'Choose at least one product and quantity.'; break; }
        if (files.length < 3) { errEl.textContent = 'Please attach at least 3 photos of the goods for verification.'; break; }
        errEl.textContent = ''; var btn = el; btn.disabled = true; btn.textContent = 'Uploading photos…';
        shrinkImages(files, 8, function (imgs) {
          if (imgs.length < 3) { errEl.textContent = 'Could not read 3 valid photos. Please choose clear image files and try again.'; btn.disabled = false; btn.textContent = 'Send return request'; return; }
          var rr = DB.requestReturn(dealer.code, rid, lines, why, dealer.code, 'dealer', imgs);
          if (rr.error) { errEl.textContent = rr.error; btn.disabled = false; btn.textContent = 'Send return request'; return; }
          closeModal(); toast('Return request ' + rr.ret.id + ' sent'); location.hash = '#/returns';
        });
        break;
      }
      case 'ledcsv': var run = 0; csvDown('my-ledger.csv', [['Date', 'Type', 'Order', 'Description', 'Debit', 'Credit', 'Balance (Dr positive)']].concat(DB.dlLedger(dealer.code).map(function (x) { run += x.debit - x.credit; return [x.date, x.type, x.orderId, x.desc, x.debit, x.credit, run.toFixed(2)]; }))); break;
      case 'closemodal': closeModal(); break;
      case 'filter': orderFilter = el.getAttribute('data-v'); render(true); break;
      case 'track': var o = findOrder(el.getAttribute('data-id')); if (o) openModal(trackHtml(o), 'modal', true); break;
      case 'reorder': var oo = findOrder(el.getAttribute('data-id')); if (oo) { oo.items.forEach(function (l) { addToCart(mkLine(l.pid, l.vid, l.flavour, l.qty)); }); toast('Items added to your cart'); go('cart'); } break;
      case 'copytext': copyText(el.getAttribute('data-text')); break;
      case 'usecoupon': sess.set('pending.' + dealer.code, el.getAttribute('data-code')); go('cart'); break;
      case 'jump': e.preventDefault(); var t = document.getElementById(el.getAttribute('data-to')); if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' }); break;
      case 'bell': openNotifs(); break;
      case 'gohome': closeModal(); go(''); break;
      case 'gooffers': closeModal(); go('offers'); break;
      case 'allowalerts': try { Notification.requestPermission().then(function (p) { toast(p === 'granted' ? 'Desktop alerts on' : 'Alerts not allowed'); closeModal(); }); } catch (e2) {} break;
      case 'aiask': closeModal(); if (window.Eleven) Eleven.ask(el.getAttribute('data-q')); break;
    }
  });
  document.addEventListener('submit', function (e) {
    var f = e.target;
    if (f.id === 'loginForm') {
      e.preventDefault();
      var btn = $('#loginBtn'), err = $('#loginErr'), code = $('#dcode').value, pw = $('#dpass').value; err.textContent = '';
      if (!code.trim() || !pw) { err.textContent = 'Enter your dealer code and password.'; return; }
      btn.disabled = true; btn.textContent = 'Signing in\u2026';
      setTimeout(function () {
        var d = DB.verifyDealer(code, pw), ls = d ? 'ok' : DB.dealerLoginStatus(code, pw);
        if (!d) { err.textContent = ls === 'inactive' ? 'This account is deactivated. Please contact S-ELEVEN Nutrition to have it activated.' : ((window.SelServer && SelServer.loginMessage && SelServer.loginMessage()) || 'Invalid dealer code or password.'); btn.disabled = false; btn.textContent = 'Login'; $('#dpass').focus(); return; }
        dealer = d; sess.set('dealer', d.code); checkChanges();
        if (location.hash === '#/' || location.hash === '') render(); else location.hash = '#/';
      }, 400);
    }
    if (f.id === 'couponForm') {
      e.preventDefault();
      var cart = repriceCart(loadCart()), r = DB.validateCoupon($('#couponInput').value, cart, DB.calcTotals(cart, null).subtotal, dealer.category);
      if (r.coupon) { sess.set('coupon.' + dealer.code, r.coupon.code); toast('Coupon ' + r.coupon.code + ' applied'); render(true); } else $('#couponErr').textContent = r.error;
    }
  });
  document.addEventListener('change', function (e) {
    var t = e.target;
    if (t.matches('.pcard input[type=radio]')) {
      var c = t.closest('.pcard'); $('[data-vmrp]', c).textContent = inr(+t.getAttribute('data-mrp')); $('[data-vprice]', c).textContent = inr(+t.getAttribute('data-price')); refreshStock(c);
    }
    if (t.matches('.pcard select')) {
      var pc = t.closest('.pcard'), im = SEL.imgOf(pc.getAttribute('data-pid')), pimg = $('.pimg img', pc);
      if (im && im.flavours && im.flavours[t.value] && pimg) pimg.src = im.flavours[t.value]; refreshStock(pc);
    }
    if (t.matches('[data-qty]')) t.value = Math.max(1, Math.min(999, parseInt(t.value, 10) || 1));
    if (t.matches('[data-cqty]')) {
      var key = t.getAttribute('data-key'), q = Math.max(1, Math.min(999, parseInt(t.value, 10) || 1)), cart = loadCart();
      cart.forEach(function (l) { if (l.key === key) l.qty = q; }); saveCart(cart); render(true);
    }
  });
  document.addEventListener('input', function (e) {
    if (e.target.id === 'co-pin' || e.target.id === 'co-addr') {
      var pa = $('#co-addr').value, pp = $('#co-pin').value.replace(/\D/g, ''), cart2 = repriceCart(loadCart()), cp2 = currentCoupon(cart2);
      $('#posNote').textContent = posText(pa, pp); $('#gstSplit').innerHTML = gstSplitHtml(DB.calcTotals(cart2, cp2, gjOf(pa, pp), DB.freightOpt(dealer)));
    }
    if (e.target.id === 'psearch') { searchText = e.target.value; var g = $('#pgrid'); if (g) g.innerHTML = productsHtml(route().arg || SEL.BRANDS[0].id); }
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { closeModal(); } });
  var keepSearch = false;
  window.addEventListener('hashchange', function () { if (!keepSearch) searchText = ''; keepSearch = false; render(false); });
  /* the admin console changes data in another tab: refresh quietly */
  var storeTimer = null;
  window.addEventListener('storage', function (e) {
    if (dealer && e.key && e.key.indexOf('sel.v2.') === 0) checkChanges();
    if (!dealer || !e.key || e.key.indexOf('sel.v2.') !== 0 || $('#gw')) return;
    var r = route().name; if (r === 'checkout') return;
    clearTimeout(storeTimer); storeTimer = setTimeout(function () { if (!$('#modal')) render(true); }, 400);
  });

  /* ---------- shared with the assistant ---------- */
  window.PortalApp = {
    go: go, getDealer: function () { return dealer; }, getCart: function () { return repriceCart(loadCart()); },
    totals: function (c) { return DB.calcTotals(c, null); }, track: function (id) { var o = findOrder(id); if (o) openModal(trackHtml(o), 'modal', true); },
    search: function (brand, text) { searchText = text || ''; if (location.hash === '#/order/' + brand) render(true); else { keepSearch = true; location.hash = '#/order/' + brand; } },
    addLine: function (pid, vid, flavour, qty) { addToCart(mkLine(pid, vid, flavour, qty)); refreshChrome(); if (route().name === 'cart') render(true); },
    cartInfo: function () { var cart = repriceCart(loadCart()), cp = currentCoupon(cart); return { cart: cart, coupon: cp, totals: DB.calcTotals(cart, cp, gjNow(), DB.freightOpt(dealer)), count: cartCount(cart) }; },
    applyCoupon: function (code) {
      var cart = repriceCart(loadCart()), r = DB.validateCoupon(code, cart, DB.calcTotals(cart, null).subtotal, dealer.category);
      if (r.coupon) { sess.set('coupon.' + dealer.code, r.coupon.code); refreshChrome(); if (['cart', 'checkout'].indexOf(route().name) > -1) render(true); } return r;
    },
    priceOf: function (pid, vid, mrp) { return dealer ? priceOf(pid, vid, mrp) : mrp; },
    reorderLast: function () { var l = DB.listOrders(dealer.code)[0]; if (!l) return null; l.items.forEach(function (x) { addToCart(mkLine(x.pid, x.vid, x.flavour, x.qty)); }); refreshChrome(); return l; },
    notifs: function () { return loadNotifs(); }, unread: unreadCount, openNotifs: openNotifs,
    markRead: function () { saveNotifs(loadNotifs().map(function (n) { n.read = true; return n; })); refreshChrome(); },
    getOrder: findOrder, openDoc: function (id, t) { var o = findOrder(id); if (o) Docs.open(o, t); return !!o; },
    setQty: function (pid, vid, flavour, qty) { var key = pid + '|' + vid + '|' + (flavour || ''), c = loadCart(), hit = false; c = c.filter(function (l) { if (l.key !== key) return true; hit = true; if (qty > 0) { l.qty = Math.min(999, qty); return true; } return false; }); saveCart(c); refreshChrome(); if (route().name === 'cart') render(true); return hit; },
    clearCart: function () { saveCart([]); refreshChrome(); if (route().name === 'cart') render(true); },
    removeCoupon: function () { sess.del('coupon.' + dealer.code); refreshChrome(); if (['cart', 'checkout'].indexOf(route().name) > -1) render(true); },
    route: function () { return route().name; },
    inr: inr, inr2: inr2, fdt: fdt, fdate: fdate, ic: ic, esc: esc, toast: toast, copy: copyText
  };
  if (dealer) checkChanges();
  render();
  setInterval(function () { try { if (dealer && window.WhatsNew) WhatsNew.maybeShow({ kind: 'dealer', code: dealer.code }); } catch (e) {} }, 1500);   /* after an update: what changed for this dealer (once) */
})();
