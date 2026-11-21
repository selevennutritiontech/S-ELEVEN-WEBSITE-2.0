/* "Eleven" action agent for the employee console.
   Layer 1: TOOLS: small validated functions over the existing data layer (DB). Every tool re-checks identity and permission; nothing here runs free-form code or queries.
   Layer 2: matching: typo-tolerant search over the REAL catalogue, brands, flavours, dealers and pages (a correction is never assumed: ambiguous or weak matches are put to the user).
   Layer 3: conversation: slot-filling workflow (preorder), confirmation before any record is created, idempotent execution, audit log. */
(function () {
  'use strict';
  var SK = 'sel.v2.agentstate.', LOGK = 'sel.v2.agentlog', IDEM = 'sel.v2.agentidem';
  function staff() { try { var s = JSON.parse(sessionStorage.getItem('sel.v2.staff') || 'null'); return s && s.tfa ? s : null; } catch (e) { return null; } }
  function jget(k, d) { try { return JSON.parse(localStorage.getItem(k) || 'null') || d; } catch (e) { return d; } }
  function jset(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function inr(n) { return '\u20B9' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 }); }
  /* ---------- text matching ---------- */
  var STOP = 'a an the of for to in on at is are me my please pls kindly can you could would want need like create generate make place add new open go show take navigate tab page section screen order orders preorder preorders pre employee dealer customer account code id number no with and or'.split(' ');
  function norm(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim(); }
  function compact(s) { return norm(s).replace(/\s/g, ''); }
  function dl(a, b) { var m = a.length, n = b.length, d = [], i, j; for (i = 0; i <= m; i++) { d[i] = [i]; } for (j = 0; j <= n; j++) d[0][j] = j; for (i = 1; i <= m; i++) for (j = 1; j <= n; j++) { var c = a[i - 1] === b[j - 1] ? 0 : 1; d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c); if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1); } return d[m][n]; }
  function phon(s) { s = compact(s); return s.replace(/ph/g, 'f').replace(/ck/g, 'k').replace(/c(?=[eiy])/g, 's').replace(/c/g, 'k').replace(/q/g, 'k').replace(/z/g, 's').replace(/x/g, 'ks').replace(/(.)\1+/g, '$1').replace(/(?!^)[aeiouy]/g, ''); }
  function sim(a, b) { a = compact(a); b = compact(b); if (!a || !b) return 0; if (a === b) return 1; return 1 - dl(a, b) / Math.max(a.length, b.length); }
  function tokSim(t, c) {
    if (t === c) return 1; if (/\d/.test(t) || /\d/.test(c)) return 0;                         /* numbers and sizes must match exactly: a typo may never change a strength or pack size */
    if (t.length >= 3 && c.indexOf(t) === 0) return 0.93; var s = sim(t, c); if (t.length > 3 && phon(t) === phon(c)) s = Math.max(s, 0.88); return s;
  }
  /* how well does the query describe this text (0..1)? token-wise, typo tolerant, and also for run-together words such as "massgainer" */
  function score(query, text) {
    var q = norm(query).split(' ').filter(function (t) { return t && STOP.indexOf(t) < 0; }), c = norm(text).split(' ').filter(Boolean); if (!q.length || !c.length) return 0;
    var cq = q.join(''), ct = c.join(''), best = 0; if (cq.length >= 4 && ct.indexOf(cq) > -1) best = 0.95; if (cq.length >= 5) { var s2 = sim(cq, ct); if (s2 > best) best = s2; }
    var tot = 0; q.forEach(function (t) { var b = 0; c.forEach(function (x) { var v = tokSim(t, x); if (v > b) b = v; }); tot += b; }); var avg = tot / q.length; if (q.length > c.length + 1) avg *= 0.85; return Math.max(best, avg);
  }
  /* ---------- permissions and routes ---------- */
  var ROUTES = [
    ['overview', 'Overview', 'overview dashboard home host dashboard company overview'], ['mydash', 'My dashboard', 'my dashboard dashboard home'], ['team', 'Team', 'team employees staff departments'], ['dealers', 'Dealers', 'dealers dealer tab distributors retailers'],
    ['inventory', 'Inventory', 'inventory stock stocks warehouse stock'], ['posts', 'Posts', 'posts updates announcements news'], ['logistics', 'Logistics orders', 'logistics dispatch shipping courier'], ['warehouse', 'Warehouse orders', 'warehouse packing pack orders'],
    ['finance', 'Finance', 'finance accounts accounting money'], ['hr', 'HR', 'hr human resources leave payroll'], ['analytics', 'Analytics', 'analytics reports performance charts graphs'], ['orders', 'Orders', 'orders pending orders sales orders payments orders and payments so'],
    ['returns', 'Returns', 'returns return orders rto returned'], ['rtoan', 'RTO analysis', 'rto analysis returns gst analysis'], ['ledgers', 'Dealer ledgers', 'ledger ledgers dealer ledger statements'], ['incentives', 'Sales incentives', 'incentives incentive commission'],
    ['preorders', 'Preorders', 'preorders pre orders'], ['samples', 'Samples', 'samples sample orders'], ['offers', 'Offers', 'offers coupons discounts'], ['freebies', 'Freebies', 'freebies free gifts'], ['create', 'Create order', 'create order new order generate order'], ['mywork', 'My attendance', 'my attendance attendance leave my work'],
    ['crm', 'CRM', 'crm leads lead customers prospects'], ['visits', 'Visits', 'visits visit my visits field visits'], ['feed', 'Updates', 'updates feed news launches'], ['saleshub', 'Sales by zone', 'sales zones zone north south east west'], ['fieldteam', 'Field sales', 'field sales consultants juniors'], ['security', 'Security', 'security authenticator google authenticator two factor 2fa'], ['sheets', 'Sheets', 'sheet sheets spreadsheet spreadsheets google sheet google sheets'], ['whatsapp', 'WhatsApp', 'whatsapp whats app wa chat message dealers employees'], ['branding', 'Branding', 'branding designs'], ['it', 'IT', 'it tech'], ['team/sales', 'Sales department', 'sales department sales team']
  ];
  function portal() { return window.SelPortal; }
  function allowedKeys() { var p = portal(); return p ? p.allowed() : []; }
  /* ---------- audit ---------- */
  function audit(action, args, result) { var s = staff(), l = jget(LOGK, []); l.push({ user: s ? s.code : '?', role: s ? s.role : '', action: action, args: args, result: result, at: new Date().toISOString() }); if (l.length > 300) l.shift(); jset(LOGK, l); try { if (s && /create|denied/.test(action) && window.DB) DB.notifyAction(s.code, 'AI assistant: ' + action, JSON.stringify(args).slice(0, 120) + ' -> ' + result, 'ai'); } catch (e) {} }
  /* ====================== TOOLS ====================== */
  var Tools = {
    navigate_to_page: function (q) {
      var s = staff(); if (!s) return { error: 'Please sign in first.' }; var ok = allowedKeys(), cands = [];
      ROUTES.forEach(function (r) { var sc = Math.max(score(q, r[1]), score(q, r[2])); if (norm(q) === norm(r[1])) sc = 1; if (sc >= 0.72) cands.push({ key: r[0], label: r[1], score: sc, allowed: ok.indexOf(r[0]) > -1 || ok.indexOf(r[0].split('/')[0]) > -1 && r[0].indexOf('/') > -1 }); });
      cands.sort(function (a, b) { return b.score - a.score; }); if (!cands.length) return { none: true };
      var qn = norm(q), exact = cands.filter(function (c) { return norm(c.label) === qn; }); if (exact.length === 1) { if (exact[0].allowed) { audit('navigate', { q: q }, exact[0].key); return { ok: true, key: exact[0].key, label: exact[0].label }; } audit('navigate_denied', { q: q }, exact[0].key); return { denied: exact[0].label }; }
      var top = cands.filter(function (c) { return c.score >= cands[0].score - 0.06; }), allow = top.filter(function (c) { return c.allowed; });
      if (allow.length === 1) { audit('navigate', { q: q }, allow[0].key); return { ok: true, key: allow[0].key, label: allow[0].label }; }
      if (allow.length > 1) { var uniq = {}; allow = allow.filter(function (c) { return uniq[c.label] ? false : (uniq[c.label] = 1); }); return { choose: allow.slice(0, 5) }; }
      audit('navigate_denied', { q: q }, top[0].key); return { denied: top[0].label };
    },
    search_products: function (q) {
      var out = []; SEL.BRANDS.forEach(function (b) { (SEL.CATALOG[b.id] || []).forEach(function (p) { var base = Math.max(score(q, p.name), score(q, p.cat), score(q, p.name + ' ' + p.cat)), bq = score(q, b.name) >= 0.8 ? 0.05 : 0; if (base >= 0.62) out.push({ brand: b, p: p, score: Math.min(1, base + bq) }); }); });
      return out.sort(function (a, b) { return b.score - a.score; });
    },
    search_brands: function (q, within) { var l = (within || SEL.BRANDS).map(function (b) { var x = b.brand || b; return { brand: x, score: score(q, x.name) }; }).filter(function (x) { return x.score >= 0.72; }); return l.sort(function (a, b) { return b.score - a.score; }); },
    get_product_variants: function (pid) { var f = SEL.findProduct(pid); if (!f) return []; var fm = DB.flavourMap(); return f.product.variants.map(function (v) { var tot = 0, fls = f.product.flavours && f.product.flavours.length ? f.product.flavours : ['']; fls.forEach(function (x) { tot += DB.flavourAvail(pid, v.id, x, fm); }); return { id: v.id, label: v.label, mrp: v.mrp, avail: tot }; }); },
    search_flavours: function (pid, q) { var f = SEL.findProduct(pid); if (!f) return []; return (f.product.flavours || []).map(function (x) { return { name: x, score: score(q, x) }; }).filter(function (x) { return x.score >= 0.6; }).sort(function (a, b) { return b.score - a.score; }); },
    get_dealer_or_employee: function (id) {
      var s = staff(), key = String(id || '').trim().toUpperCase(), d = DB.getDealer(key), e = DB.getEmployee(key), r = { dealer: null, employee: null };
      if (d) r.dealer = { code: d.code, name: d.name, city: d.city, salesEmp: d.salesEmp || '', permitted: !!s && (s.role === 'admin' || (s.role === 'employee' && d.salesEmp === s.code)) };
      if (e && s && s.dept !== 'fieldsales') r.employee = { id: e.id, name: e.name, dept: e.dept }; return r;
    },
    find_dealers_by_name: function (q) { var s = staff(); return DB.listDealers().map(function (d) { return { code: d.code, name: d.name, score: Math.max(score(q, d.name), score(q, d.code)), permitted: !!s && (s.role === 'admin' || (s.role === 'employee' && d.salesEmp === s.code)) }; }).filter(function (x) { return x.score >= 0.72; }).sort(function (a, b) { return b.score - a.score; }); },
    get_order_details: function (q) {
      var s = staff(); if (!s) return { error: 'Please sign in first.' }; var id = String(q).trim().toUpperCase(), all = DB.allOrders().filter(function (o) { return s.role === 'admin' || s.role === 'finance' ? true : s.role === 'employee' ? (o.attr && o.attr.emp === s.code) : (s.role === 'logistics' || s.role === 'warehouse') ? (o.payment.status === 'Paid' && o.confirmed) : false; });
      var hit = all.filter(function (o) { return o.id.toUpperCase() === id; }); if (!hit.length) hit = all.filter(function (o) { return o.id.toUpperCase().indexOf(id) > -1; }); if (!hit.length) { var anyone = DB.allOrders().some(function (o) { return o.id.toUpperCase().indexOf(id) > -1; }); return anyone ? { denied: true } : { none: true }; }
      return hit.length === 1 ? { ok: true, order: hit[0] } : { choose: hit.slice(0, 6) };
    },
    get_pending_orders: function () { var s = staff(); var all = DB.allOrders(); return { unpaid: all.filter(function (o) { return o.payment.status !== 'Paid' && !o.cancelled; }).length }; },
    /* checks everything a preorder needs and returns the exact record the backend would create, without creating it */
    prepare_preorder: function (st) {
      var s = staff(); if (!s) return { error: 'Please sign in first.' }; if (['admin', 'employee'].indexOf(s.role) < 0) return { error: 'Your role cannot create preorders.' };
      var d = DB.getDealer(st.dealer); if (!d) return { error: 'Dealer ' + st.dealer + ' was not found.' }; if (s.role === 'employee' && d.salesEmp !== s.code) return { error: 'Dealer ' + d.code + ' is not assigned to you, so you cannot create a preorder for them.' };
      var f = SEL.findProduct(st.pid); if (!f) return { error: 'That product is no longer available.' }; if (!DB.isActiveProduct(st.pid)) return { error: 'That product is not available right now.' }; var v = f.product.variants.filter(function (x) { return x.id === st.vid; })[0]; if (!v) return { error: 'That pack size is not available.' };
      var fls = f.product.flavours || []; if (fls.length && fls.indexOf(st.flavour) < 0) return { error: 'That flavour is not available for this product.' }; var q = parseInt(st.qty, 10); if (!(q > 0) || q > 99999) return { error: 'Quantity must be a whole number from 1 to 99,999.' };
      var avail = DB.flavourAvail(st.pid, st.vid, st.flavour || ''), price = DB.priceFor(d, st.pid, st.vid, v.mrp);
      return { ok: true, dealer: d, product: f.product, brand: f.brand, brandName: (SEL.brandById(f.brand) || {}).name || String(f.brand), variant: v, flavour: st.flavour || '', qty: q, price: price, total: Math.round(price * q * 100) / 100, avail: avail, inStock: avail >= q };
    },
    /* the ONLY place a record is created: re-validates identity, permission, stock and price, then uses the existing backend service. Safe to call twice. */
    create_preorder_after_confirmation: function (st, key) {
      var done = jget(IDEM, {}); if (done[key]) return { ok: true, id: done[key], duplicate: true };
      var p = Tools.prepare_preorder(st); if (p.error) { audit('create_preorder_denied', st, p.error); return p; } if (p.inStock) { audit('create_preorder_blocked', st, 'in stock'); return { error: 'This item is in stock now, so it is no longer a preorder. Please place a normal order.' }; }
      var r = DB.createPreorder(p.dealer.code, [{ pid: st.pid, vid: st.vid, flavour: st.flavour || '', qty: p.qty }], staff().code); if (r.error) { audit('create_preorder_failed', st, r.error); return { error: r.error }; }
      done[key] = r.preorder.id; jset(IDEM, done); audit('create_preorder', { dealer: p.dealer.code, pid: st.pid, vid: st.vid, flavour: st.flavour, qty: p.qty }, r.preorder.id); return { ok: true, id: r.preorder.id, value: r.preorder.value };
    }
  };
  /* ====================== CONVERSATION ====================== */
  function loadSt() { var s = staff(); if (!s) return null; try { return JSON.parse(sessionStorage.getItem(SK + s.code) || 'null'); } catch (e) { return null; } }
  function saveSt(st) { var s = staff(); if (!s) return; try { if (st) sessionStorage.setItem(SK + s.code, JSON.stringify(st)); else sessionStorage.removeItem(SK + s.code); } catch (e) {} }
  function opts(list, fmt) { return list.map(function (x, i) { return { label: fmt(x, i), value: String(i + 1) }; }); }
  function stockWord(a) { return a <= 0 ? 'out of stock' : (a <= 10 ? 'low stock (' + a + ')' : 'in stock (' + a + ')'); }
  function reply(text, extra) { var r = { text: text, handled: true }; if (extra) for (var k in extra) r[k] = extra[k]; return r; }
  function pickIndex(raw, n) { var m = /^\s*(?:option\s*|number\s*|no\.?\s*|#)?(\d{1,2})\s*$/i.exec(raw); if (m && +m[1] >= 1 && +m[1] <= n) return +m[1] - 1; return -1; }
  function summary(st) {
    var p = Tools.prepare_preorder(st); if (p.error) return { err: p.error };
    var lines = ['Please check this preorder:', 'Dealer: ' + p.dealer.name + ' (' + p.dealer.code + ')', 'Brand: ' + p.brandName, 'Product: ' + p.product.name.split(' (')[0], 'Pack: ' + p.variant.label, p.flavour ? 'Flavour: ' + p.flavour : 'Flavour: none for this product', 'Quantity: ' + p.qty + ' unit(s)', 'Price: ' + inr(p.price) + ' each (GST included, from the dealer\'s price list), ' + inr(p.total) + ' in total', 'Type: preorder. Nothing is charged now; when stock arrives it is reserved and the dealer is asked to pay.', 'Created by: ' + staff().name];
    return { p: p, text: lines.join('\n') };
  }
  function confirmReply(st) {
    var sm = summary(st); if (sm.err) { st.awaiting = 'dealer'; saveSt(st); return reply(sm.err + ' What would you like to change?', { choices: [{ label: 'Change dealer', value: 'change dealer' }, { label: 'Cancel', value: 'cancel' }] }); }
    if (sm.p.inStock) { st.awaiting = 'qty'; saveSt(st); return reply(sm.p.product.name.split(' (')[0] + (sm.p.flavour ? ' (' + sm.p.flavour + ')' : '') + ' ' + sm.p.variant.label + ' has ' + sm.p.avail + ' in stock, which covers ' + sm.p.qty + '. A preorder is only for items that are short, so I have not created one. You can place a normal order instead, or try a larger quantity or another flavour or pack.', { choices: [{ label: 'Open Create order', value: 'open create order' }, { label: 'Change quantity', value: 'change quantity' }, { label: 'Change flavour', value: 'change flavour' }, { label: 'Cancel', value: 'cancel' }] }); }
    st.awaiting = 'confirm'; st.summaryAt = Date.now(); saveSt(st);
    return reply(sm.text + (sm.p.avail > 0 ? '\nNote: ' + sm.p.avail + ' unit(s) are in stock now; the rest will be waiting for stock.' : ''), { choices: [{ label: 'Confirm and create', value: 'confirm' }, { label: 'Change something', value: 'change' }, { label: 'Cancel', value: 'cancel' }], summary: true });
  }
  /* decides what to ask next; never asks again for something already known */
  function next(st) {
    if (!st.dealer) { st.awaiting = 'dealer'; saveSt(st); return reply('Which dealer is this preorder for? Please give the dealer code (for example DEMO001) or the dealer name.'); }
    if (!st.pid) {
      if (!st.query) { st.awaiting = 'product'; saveSt(st); return reply('Which product would you like to preorder? For example "mass gainer" or "whey protein".'); }
      var found = Tools.search_products(st.query);
      if (!found.length) { st.awaiting = 'product'; st.query = ''; saveSt(st); var bs = Tools.search_brands(st.query || ''); return reply('I could not find a product matching that in the catalogue, and I do not want to guess. Please try another name, for example "mass gainer", "whey protein" or "creatine".'); }
      var brands = {}; found.forEach(function (x) { brands[x.brand.id] = x.brand; });
      if (!st.brand && Object.keys(brands).length > 1) { st.awaiting = 'brand'; st.brandChoices = Object.keys(brands); saveSt(st); return reply('I found "' + (found[0].p.cat || st.query) + '" products from ' + Object.keys(brands).length + ' brands. Which brand would you like?', { choices: Object.keys(brands).map(function (k, i) { return { label: brands[k].name + ' (' + found.filter(function (x) { return x.brand.id === k; }).map(function (x) { return x.p.name.split(' (')[0]; }).join(', ') + ')', value: String(i + 1) }; }) }); }
      var inBrand = found.filter(function (x) { return !st.brand || x.brand.id === st.brand; });
      if (!inBrand.length) { st.brand = ''; saveSt(st); return next(st); }
      var top = inBrand.filter(function (x) { return x.score >= inBrand[0].score - 0.05; });
      if (top.length > 1 && top[0].score < 0.97) { st.awaiting = 'productpick'; st.prodChoices = top.map(function (x) { return x.p.id; }); saveSt(st); return reply('Several products match. Which one do you mean?', { choices: top.map(function (x, i) { return { label: x.brand.name + ': ' + x.p.name.split(' (')[0], value: String(i + 1) }; }) }); }
      st.pid = top[0].p.id; st.brand = top[0].brand.id; saveSt(st);
    }
    var f = SEL.findProduct(st.pid);
    if (!st.vid) { var vs = f.product.variants; if (vs.length === 1) st.vid = vs[0].id; else { var vl = Tools.get_product_variants(st.pid); st.awaiting = 'variant'; saveSt(st); return reply('Which pack size of ' + f.product.name.split(' (')[0] + '?', { choices: vl.map(function (v, i) { return { label: v.label + ' (' + stockWord(v.avail) + ')', value: String(i + 1) }; }) }); } }
    var fls = f.product.flavours || [];
    if (fls.length && !st.flavour) { st.awaiting = 'flavour'; st.flChoices = fls; saveSt(st); var fm = DB.flavourMap(); return reply('Which flavour?', { choices: fls.map(function (x, i) { return { label: x + ' (' + stockWord(DB.flavourAvail(st.pid, st.vid, x, fm)) + ')', value: String(i + 1) }; }) }); }
    if (!st.qty) { st.awaiting = 'qty'; saveSt(st); return reply('How many units?'); }
    return confirmReply(st);
  }
  function parseDealer(raw, st) {
    var m = /\b([A-Za-z]{2,}\d+)\b/.exec(raw), said = /employee/i.test(raw) ? 'employee' : '';
    if (m) {
      var r = Tools.get_dealer_or_employee(m[1]);
      if (r.dealer && r.employee) return { ask: m[1].toUpperCase() + ' matches both a dealer (' + r.dealer.name + ') and an employee (' + r.employee.name + '). Which one is this preorder for?', choices: [{ label: 'Dealer: ' + r.dealer.name, value: 'dealer ' + r.dealer.code }, { label: 'Employee ' + r.employee.name + ' (I will ask for the dealer)', value: 'employee ' + r.employee.id }] };
      if (r.dealer) { if (!r.dealer.permitted) return { deny: 'Dealer ' + r.dealer.code + ' (' + r.dealer.name + ') is not assigned to you, so I cannot create a preorder for them.' }; return { dealer: r.dealer.code, note: said === 'employee' ? m[1].toUpperCase() + ' is a dealer account (' + r.dealer.name + '), not an employee. I will use it as the dealer. ' : '' }; }
      if (r.employee) return { ask: m[1].toUpperCase() + ' is an employee (' + r.employee.name + '), not a dealer, and a preorder needs a dealer. Which dealer should it be for? Give the dealer code or name.' };
      return { ask: 'I could not find any dealer or employee with the code ' + m[1].toUpperCase() + '. Please check the code, or give the dealer name.' };
    }
    var q = raw.replace(/\b(for|dealer|employee|customer|the)\b/gi, ' ').trim(); if (q.length >= 3) { var c = Tools.find_dealers_by_name(q); if (c.length === 1 || (c.length > 1 && c[0].score - c[1].score > 0.12)) return c[0].permitted ? { dealer: c[0].code } : { deny: c[0].name + ' is not assigned to you.' }; if (c.length > 1) return { ask: 'Several dealers match. Which one?', choices: c.slice(0, 5).map(function (x) { return { label: x.name + ' (' + x.code + ')', value: 'dealer ' + x.code }; }) }; }
    return null;
  }
  var QTY_RE = /(\d{1,5})\s*(?:units?|pcs|pieces|nos|packs?|tubs?|boxes|x)?\b/i;
  function applyEdit(raw, st) {
    var t = norm(raw), changed = null, m;
    if ((m = /(?:change|set|make)\s*(?:the\s*)?(?:quantity|qty)?\s*(?:to|as|it)?\s*(\d{1,5})\b/.exec(t)) && /(quantity|qty|make it|change it)/.test(t) || (m = /^(?:make it|change it to|set it to)\s*(\d{1,5})$/.exec(t))) { st.qty = parseInt(m[1], 10); changed = 'quantity'; }
    else if (/change\s*(?:the\s*)?quantity|change qty/.test(t)) { st.qty = 0; st.awaiting = 'qty'; saveSt(st); return reply('Sure. How many units?'); }
    else if ((m = /(?:change|set)\s*(?:the\s*)?flavou?r\s*(?:to|as)\s*(.+)$/.exec(t))) { st.flavour = ''; saveSt(st); return answerFlavour(m[1], st); }
    else if (/change\s*(?:the\s*)?flavou?r/.test(t)) { st.flavour = ''; saveSt(st); return next(st); }
    else if (/change\s*(?:the\s*)?(?:pack|size|variant)/.test(t)) { st.vid = ''; st.flavour = ''; saveSt(st); return next(st); }
    else if (/change\s*(?:the\s*)?(?:product|item)/.test(t)) { st.pid = ''; st.vid = ''; st.flavour = ''; st.brand = ''; st.query = ''; st.qty = st.qty; saveSt(st); return next(st); }
    else if (/change\s*(?:the\s*)?brand/.test(t)) { st.pid = ''; st.vid = ''; st.flavour = ''; st.brand = ''; saveSt(st); return next(st); }
    else if (/change\s*(?:the\s*)?dealer/.test(t)) { st.dealer = ''; saveSt(st); return next(st); }
    else if (/^change(?: something| details)?$|^edit$/.test(t)) { return reply('What would you like to change?', { choices: [{ label: 'Dealer', value: 'change dealer' }, { label: 'Brand', value: 'change brand' }, { label: 'Product', value: 'change product' }, { label: 'Pack size', value: 'change pack' }, { label: 'Flavour', value: 'change flavour' }, { label: 'Quantity', value: 'change quantity' }] }); }
    if (changed) { saveSt(st); return confirmReply(st); } return null;
  }
  function answerFlavour(raw, st) {
    var m = Tools.search_flavours(st.pid, raw); if (!m.length) { var all = SEL.findProduct(st.pid).product.flavours; return reply('I could not find a flavour like "' + raw + '" for this product. The flavours are: ' + all.join(', ') + '.', { choices: all.map(function (x, i) { return { label: x, value: String(i + 1) }; }) }); }
    var top = m.filter(function (x) { return x.score >= m[0].score - 0.05; });
    if (top.length > 1 && m[0].score < 0.97) { st.awaiting = 'flavour'; st.flChoices = top.map(function (x) { return x.name; }); saveSt(st); return reply('"' + raw + '" could mean more than one flavour. Which one?', { choices: top.map(function (x, i) { return { label: x.name, value: String(i + 1) }; }) }); }
    st.flavour = top[0].name; st.awaiting = ''; saveSt(st); var note = norm(raw) !== norm(top[0].name) ? 'Matched "' + raw + '" to flavour "' + top[0].name + '". ' : ''; var r = next(st); r.text = note + r.text; return r;
  }
  function handleSlot(raw, st) {
    var a = st.awaiting, t = norm(raw), idx, r;
    if (a === 'dealer') { if (/^(dealer|employee)\s+\S+$/i.test(raw.trim())) { var w = raw.trim().split(/\s+/); if (/^employee/i.test(w[0])) return reply('Understood. Which dealer should the preorder be for? Give the dealer code or name.'); raw = w[1]; } var pd = parseDealer(raw, st); if (!pd) return reply('I could not recognise a dealer from that. Please give the dealer code (for example DEMO001) or the dealer name.'); if (pd.deny) { audit('preorder_denied', { dealer: raw }, pd.deny); return reply(pd.deny + ' Please give another dealer, or say cancel.'); } if (pd.ask) return reply(pd.ask, { choices: pd.choices }); st.dealer = pd.dealer; st.awaiting = ''; saveSt(st); r = next(st); if (pd.note) r.text = pd.note + r.text; return r; }
    if (a === 'product') { st.query = raw; st.pid = ''; st.brand = ''; st.awaiting = ''; saveSt(st); var found = Tools.search_products(raw); if (found.length && norm(found[0].p.name) !== norm(raw) && !found.some(function (x) { return norm(x.p.name + ' ' + x.p.cat).indexOf(norm(raw)) > -1; })) { r = next(st); r.text = 'Closest match for "' + raw + '": ' + found[0].p.name.split(' (')[0] + ' (' + found[0].brand.name + '). ' + r.text; return r; } return next(st); }
    if (a === 'brand') { idx = pickIndex(raw, st.brandChoices.length); var ids = st.brandChoices; if (idx < 0) { var bm = Tools.search_brands(raw, SEL.BRANDS.filter(function (b) { return ids.indexOf(b.id) > -1; })); if (bm.length && (bm.length === 1 || bm[0].score - bm[1].score > 0.1)) idx = ids.indexOf(bm[0].brand.id); else if (bm.length > 1) return reply('That could be more than one brand. Please pick one.', { choices: bm.map(function (x) { return { label: x.brand.name, value: String(ids.indexOf(x.brand.id) + 1) }; }) }); }
      if (idx < 0) { var names = ids.map(function (k) { return SEL.brandById(k).name; }); var anyBrand = Tools.search_brands(raw); return reply((anyBrand.length ? anyBrand[0].brand.name + ' does not have this product in the catalogue. ' : 'I could not find a brand called "' + raw + '" in your catalogue, so I will not guess. ') + 'Brands with this product: ' + names.join(', ') + '. Which one?', { choices: ids.map(function (k, i) { return { label: SEL.brandById(k).name, value: String(i + 1) }; }) }); }
      st.brand = ids[idx]; st.awaiting = ''; saveSt(st); return next(st); }
    if (a === 'productpick') { idx = pickIndex(raw, st.prodChoices.length); if (idx < 0) { var pm = st.prodChoices.map(function (id, i) { return { i: i, s: score(raw, SEL.findProduct(id).product.name) }; }).sort(function (x, y) { return y.s - x.s; }); if (pm[0].s >= 0.75 && (pm.length < 2 || pm[0].s - pm[1].s > 0.1)) idx = pm[0].i; } if (idx < 0) return reply('Please pick one of the products shown (or type its number).'); st.pid = st.prodChoices[idx]; st.awaiting = ''; saveSt(st); return next(st); }
    if (a === 'variant') { var vs = SEL.findProduct(st.pid).product.variants; idx = pickIndex(raw, vs.length); if (idx < 0) { var vm = vs.map(function (v, i) { return { i: i, s: norm(raw).replace(/\s/g, '') === norm(v.label).replace(/\s/g, '') ? 1 : (score(raw, v.label) >= 0.9 ? 0.9 : 0) }; }).filter(function (x) { return x.s > 0; }).sort(function (x, y) { return y.s - x.s; }); if (vm.length === 1 || (vm.length > 1 && vm[0].s > vm[1].s)) idx = vm[0].i; } if (idx < 0) return reply('I could not match that pack size (sizes must match exactly). Please choose one:', { choices: vs.map(function (v, i) { return { label: v.label, value: String(i + 1) }; }) }); st.vid = vs[idx].id; st.awaiting = ''; saveSt(st); return next(st); }
    if (a === 'flavour') { idx = pickIndex(raw, st.flChoices.length); if (idx >= 0) { st.flavour = st.flChoices[idx]; st.awaiting = ''; saveSt(st); return next(st); } var pf = SEL.findProduct(st.pid).product.flavours; st.flChoices = pf; saveSt(st); return answerFlavour(raw, st); }
    if (a === 'qty') { var qm = /^\s*(\d{1,5})\s*(?:units?|pcs|pieces|nos|packs?|tubs?|boxes)?\s*$/i.exec(raw) || QTY_RE.exec(raw); if (!qm || !(parseInt(qm[1], 10) > 0)) return reply('Please tell me how many units, as a number (for example 10).'); st.qty = parseInt(qm[1], 10); st.awaiting = ''; saveSt(st); return next(st); }
    return null;
  }
  function startPreorder(raw) {
    var st = { task: 'preorder', id: 'ag' + Date.now().toString(36), dealer: '', query: '', pid: '', brand: '', vid: '', flavour: '', qty: 0, awaiting: '' }, s = staff();
    if (['admin', 'employee'].indexOf(s.role) < 0) { audit('preorder_denied', {}, 'role ' + s.role); return reply('Your role (' + s.role + ') cannot create preorders. Sales employees and the Host can.'); }
    var dm = /\b([A-Za-z]{2,}\d+)\b/.exec(raw), note = ''; if (dm) { var pd = parseDealer(raw, st); if (pd) { if (pd.deny) { audit('preorder_denied', { dealer: dm[1] }, pd.deny); return reply(pd.deny); } if (pd.ask) { st.awaiting = 'dealer'; saveSt(st); st.query = productText(raw, dm[1]); saveSt(st); return reply(pd.ask, { choices: pd.choices }); } st.dealer = pd.dealer; note = pd.note || ''; } }
    var rest = productText(raw, dm ? dm[1] : ''); var bmatch = Tools.search_brands(rest.replace(/\b(mass|whey|gainer|protein|creatine)\b/gi, ' ')); st.query = rest; saveSt(st); var r = next(st); if (note) r.text = note + r.text; return r;
  }
  function productText(raw, code) { return raw.replace(new RegExp(code || '@@@', 'i'), ' ').replace(/\b(please|pls|can you|could you|i want to|i would like to|generate|create|make|place|start|new|a|an|the|pre-?order|pre order|preorder|of|for|employee|dealer|customer|account|code|id)\b/gi, ' ').replace(/\s+/g, ' ').trim(); }
  function doConfirm(st) {
    if (st.awaiting !== 'confirm') return reply('There is nothing waiting for confirmation.');
    var key = st.id + ':' + [st.dealer, st.pid, st.vid, st.flavour, st.qty].join('|'), r = Tools.create_preorder_after_confirmation(st, key);
    if (r.error) { st.awaiting = ''; saveSt(st); return reply('I did not create the preorder: ' + r.error + ' Nothing was saved.', { choices: [{ label: 'Change something', value: 'change' }, { label: 'Cancel', value: 'cancel' }] }); }
    saveSt(null); return reply((r.duplicate ? 'That preorder was already created: ' : 'Done. Preorder created: ') + r.id + '. It is waiting for stock; when stock arrives it is reserved for the dealer to pay.', { actions: [{ label: 'Open Preorders', hash: '#/preorders' }] });
  }
  /* ====================== entry point ====================== */
  var NAV_RE = /^(?:please\s+)?(?:can you\s+)?(?:open|go to|goto|take me to|navigate to|switch to|visit|show me|show|go back to|back to|bring up|launch)\s+(.+)$/i;
  /* ====================== SHEETS AND WHATSAPP ====================== */
  var DEPT_WORDS = { sales: 'sales', logistics: 'logistics', warehouse: 'warehouse', finance: 'finance', branding: 'branding', it: 'it', hr: 'hr', company: 'host', host: 'host', admin: 'host' };
  function sheetIntent(raw) {
    /* "open finance sheet payments" and "open the payments sheet of finance" mean the same as "open finance payments sheet" */
    if (!/\bsheets?\s*$/i.test(raw)) raw = raw.replace(/^(.*?)\s+(?:google\s+)?sheets?\s+of\s+(.+?)\s*$/i, '$1 $2 sheet').replace(/^(.*?)\s+(?:google\s+)?sheets?\s+(.+?)\s*$/i, '$1 $2 sheet');
    var m = /^(?:please\s+)?(?:can you\s+)?(?:open|show(?:\s+me)?|go to|take me to|view|bring up)\s+(?:the\s+)?(.+?)\s+(?:google\s+)?sheets?\s*$/i.exec(raw); if (!m || !window.Sheets) return null; var s = staff(), words = norm(m[1]); if (!s || !words || words === 'google') return null;
    var books; try { books = Sheets.visibleBooks({ code: s.code, role: s.role, dept: s.dept }); } catch (e) { return null; } var pick = null, rest = words, tab = null;
    if (/^my\b/.test(words)) { pick = books.filter(function (b) { return b.id === 'user:' + s.code; })[0]; rest = words.replace(/^my\s*/, ''); }
    else { for (var k in DEPT_WORDS) { if (new RegExp('\\b' + k + '\\b').test(words)) { var id = 'dept:' + DEPT_WORDS[k]; pick = books.filter(function (b) { return b.id === id; })[0]; rest = words.replace(new RegExp('\\b' + k + '\\b'), '').trim(); if (!pick) { audit('sheet_denied', { q: raw }, id); return reply('You do not have access to the ' + k + ' sheets. I can open your own sheets or your department\u2019s sheets.'); } break; } } }
    if (!pick) { var best = null; books.forEach(function (b) { if (b.id !== 'user:' + s.code && b.id !== 'dept:' + (s.dept || s.role)) return; b.tabs.forEach(function (t) { var sc = score(words, t.name); if (sc >= 0.72 && (!best || sc > best.sc)) best = { b: b, t: t, sc: sc }; }); }); if (!best) return null; pick = best.b; tab = best.t; }
    else if (rest) { pick.tabs.forEach(function (t) { var sc = score(rest, t.name); if (sc >= 0.72 && (!tab || sc > tab.sc)) tab = Object.assign({}, t, { sc: sc }); }); }
    audit('open_sheet', { q: raw }, pick.id + (tab ? '/' + tab.name : '')); return reply('Opening ' + pick.title + (tab ? ' \u203A ' + tab.name : '') + '.', { go: '#/sheets/' + encodeURIComponent(pick.id) + (tab ? '/' + tab.id : '') });
  }
  var WA_TOPICS = [['payment', /\b(pay|payment|due|dues|pending|overdue|outstanding|reminder|balance|utr)\b/], ['order', /\b(order|dispatch|dispatched|shipped|shipping|track|tracking|status|delivery|delivered|update)\b/], ['offers', /\b(offer|offers|discount|scheme|deal|deals|coupon|sale)\b/], ['thanks', /\b(thank|thanks|thankyou|appreciate)\b/], ['welcome', /\b(welcome|onboard|onboarding|introduce)\b/], ['delay', /\b(delay|delayed|late|sorry|apolog)\w*/], ['task', /\b(task|work|deadline|follow ?up)\b/], ['meeting', /\b(meeting|call|catch ?up|discuss)\b/]];
  function firstName(n) { return String(n || '').trim().split(/\s+/)[0] || 'there'; }
  function pending(code) { try { return DB.listOrders(code).filter(function (o) { return !o.cancelled && !o.hist && o.payment && o.payment.status !== 'Paid'; }); } catch (e) { return []; } }
  function waCompose(topic, who, isDealer, me, custom) {
    var hi = 'Hello ' + firstName(isDealer ? (who.person || who.name) : who.name) + ', this is ' + me + ' from S-ELEVEN Nutrition. ', sign = '\n\nThank you.\n' + me + ', S-ELEVEN Nutrition', body = '';
    if (topic === 'payment' && isDealer) { var p = pending(who.code), tot = 0; p.forEach(function (o) { tot += DB.dueOf(o); }); body = p.length ? 'A gentle reminder: a payment of ' + inr(tot) + ' is pending for ' + (p.length > 1 ? 'orders ' : 'order ') + p.map(function (o) { return o.id; }).join(', ') + '. Please pay and share the payment screenshot with the UTR number on this chat so we can confirm and dispatch your order.' : 'Thank you for your payments. There is no pending amount on your account today.'; }
    else if (topic === 'order' && isDealer) { var os = []; try { os = DB.listOrders(who.code).filter(function (o) { return !o.cancelled && !o.hist; }); } catch (e) {} var o = os[0]; if (!o) body = 'We could not find a recent order on your account. Please tell me the order number and I will check it.'; else { var st = DB.stageOf(o), sh = o.shipment || {}, cr = sh.partner ? DB.getCourier(sh.partner) : null; body = 'Update on your order ' + o.id + ': ' + st.label + '.' + (sh.trackingId ? ' Courier: ' + (cr ? cr.name : sh.partner) + ', tracking ID ' + sh.trackingId + (cr && cr.url ? '. Track it here: ' + cr.url.replace('{id}', encodeURIComponent(sh.trackingId)) : '.') : ' We will share the tracking details as soon as it is dispatched.'); } }
    else if (topic === 'offers' && isDealer) { var of = []; try { of = (DB.listOffers ? DB.listOffers() : []).filter(function (x) { return x.section === 'live' || x.section === 'combo'; }).slice(0, 3); } catch (e) {} body = of.length ? 'New offers are live for you: ' + of.map(function (x) { return x.title + (x.code ? ' (code ' + x.code + ')' : ''); }).join('; ') + '. Please log in to the dealer portal to use them.' : 'New offers are live on the S-ELEVEN dealer portal. Please log in to see them.'; }
    else if (topic === 'thanks') body = 'Thank you for your support and for your business. We truly appreciate it.';
    else if (topic === 'welcome') body = isDealer ? 'Welcome to the S-ELEVEN family. Your dealer portal login is ready: you can place orders, see offers and track every order there. Please message me for any help.' : 'Welcome to the S-ELEVEN team. Please message me if you need any help getting started.';
    else if (topic === 'delay') body = 'We are sorry for the delay' + (isDealer ? ' with your order' : '') + '. We are on it and will update you shortly.';
    else if (topic === 'task') body = 'A gentle reminder about the pending task. Please update me once it is done.';
    else if (topic === 'meeting') body = 'Can we speak for 5 minutes today about the pending work? Please tell me a time that suits you.';
    else body = custom ? custom.replace(/^(?:about|regarding|saying|that|on)\s+/i, '').replace(/^./, function (c) { return c.toUpperCase(); }) + (/[.!?]$/.test(custom) ? '' : '.') : 'I hope you are doing well. Please message me when you are free.';
    return hi + body + sign;
  }
  function waIntent(raw) {
    var s = staff(); if (!s) return null; var t = norm(raw), key = 'sel.v2.wadraft.' + s.code, last = null; try { last = JSON.parse(sessionStorage.getItem(key) || 'null'); } catch (e) {}
    if (/^(?:please\s+)?(?:open|send)\s+(?:the\s+)?(?:whats ?app\s+)?draft(?:\s+in\s+whats ?app)?$/.test(t)) { if (!last) return reply('There is no draft yet. Ask me, for example: draft a WhatsApp payment reminder for DEMO001.'); var ok = window.SelWA && SelWA.open(last.phone, last.text); audit('whatsapp_open_draft', { to: last.name }, ok ? 'opened' : 'blocked'); return reply(ok ? 'I opened your WhatsApp tab with the message to ' + last.name + '. Check it and press send there. I never send messages myself.' : 'Your browser blocked the WhatsApp tab. Allow pop-ups for this page and try again.'); }
    if (/^(?:please\s+)?copy\s+(?:the\s+)?(?:whats ?app\s+)?draft$/.test(t)) { if (!last) return reply('There is no draft yet.'); try { navigator.clipboard.writeText(last.text); } catch (e) {} return reply('Copied. Paste it in your WhatsApp tab.'); }
    if (/^(?:make|keep)\s+(?:the\s+)?(?:whats ?app\s+)?draft\s+(?:a bit\s+)?(?:shorter|short|brief)$/.test(t)) { if (!last) return reply('There is no draft yet.'); var sh = last.text.split('\n\n'), short = (sh[0].split('. ').slice(0, 3).join('. ') + (sh[0].indexOf('. ') > -1 ? '.' : '')).replace(/\.\.$/, '.'); last.text = short; try { sessionStorage.setItem(key, JSON.stringify(last)); } catch (e) {} return reply('Shorter draft for ' + last.name + ':\n\n' + short, { choices: [{ label: 'Open in WhatsApp', value: 'open the whatsapp draft' }, { label: 'Copy the draft', value: 'copy the whatsapp draft' }] }); }
    var wants = (/\b(draft|write|compose|generate|prepare|create|make|type)\b/i.test(raw) && /\b(whats ?app|wa)\b/i.test(raw)) || (/\bwhats ?app\b.*\b(message|msg|draft|reminder)\b/i.test(raw) && /\b(to|for)\b/i.test(raw)); if (!wants) return null;
    var after = (/\b(?:to|for)\s+(.+)$/i.exec(raw) || [])[1] || ''; var topic = ''; WA_TOPICS.forEach(function (x) { if (!topic && x[1].test(raw.toLowerCase())) topic = x[0]; });
    var custom = (/\b(?:about|regarding|saying|that says|that)\s+(.+)$/i.exec(raw) || [])[1] || ''; var who = after.replace(/\b(?:about|regarding|saying|that says|that|on)\b.*$/i, '').replace(/\b(payment|reminder|pending|dues?|offers?|order|update|status|thank(?:s| you)|welcome|delay|task|meeting|message|draft|whats ?app|please)\b/gi, ' ').replace(/\s+/g, ' ').trim();
    var dealers = []; try { dealers = DB.listDealers(); } catch (e) {} var emps = []; try { emps = DB.listEmployees(); } catch (e) {} if (s.dept === 'fieldsales') emps = [];   /* a consultant messages dealers only */ var best = null, code = (/\b[A-Za-z]{2,}\d{2,}\b/.exec(who) || [])[0];
    if (!who) return reply('Who is the message for? Name a dealer or an employee, for example: draft a WhatsApp payment reminder for DEMO001.');
    dealers.forEach(function (d) { var sc = Math.max(score(who, d.name), score(who, d.code), d.person ? score(who, d.person) : 0, code && d.code.toLowerCase() === code.toLowerCase() ? 1 : 0); if (sc >= 0.6 && (!best || sc > best.sc)) best = { sc: sc, d: d, dealer: true }; });
    emps.forEach(function (e) { var sc = Math.max(score(who, e.name), score(who, e.id)); if (sc >= 0.6 && (!best || sc > best.sc)) best = { sc: sc, d: e, dealer: false }; });
    if (!best) return reply('I could not find \u201C' + who + '\u201D among your dealers or employees. Please give the dealer code or the full name.');
    if (best.dealer && s.role === 'warehouse') { audit('whatsapp_denied', { to: who }, 'warehouse cannot message dealers'); return reply('The Warehouse can message employees only, not dealers. I can draft a message for an employee instead.'); }
    if (best.dealer && s.role === 'employee' && best.d.salesEmp !== s.code) { audit('whatsapp_denied', { to: who }, 'not your dealer'); return reply(best.d.name + ' is not one of your dealers, so I cannot draft a message for them.'); }
    if (!best.dealer && (topic === 'payment' || topic === 'order' || topic === 'offers')) topic = /\b(meeting|call|catch ?up|discuss)\b/i.test(raw) ? 'meeting' : 'task';   /* those topics only make sense for dealers */
    var me = s.name || s.code, text = waCompose(topic, best.d, best.dealer, me, custom), phone = best.dealer ? best.d.phone : best.d.mobile, name = best.d.name;
    try { sessionStorage.setItem(key, JSON.stringify({ phone: phone, text: text, name: name })); } catch (e) {} audit('whatsapp_draft', { to: name, topic: topic || 'custom' }, 'drafted');
    return reply('Here is a WhatsApp draft for ' + name + (phone ? ' (' + phone + ')' : ' (no phone number saved)') + ':\n\n' + text + '\n\nI never send it for you: open it in WhatsApp, check it, and press send.', { choices: [{ label: 'Open in WhatsApp', value: 'open the whatsapp draft' }, { label: 'Copy the draft', value: 'copy the whatsapp draft' }, { label: 'Make it shorter', value: 'make the whatsapp draft shorter' }] });
  }

  function handle(raw) {
    var s = staff(); if (!s) return null; raw = String(raw || '').trim(); if (!raw) return null; var t = norm(raw), st = loadSt();
    if (/^(cancel|stop|abort|never ?mind|forget it|discard|start over)\b/.test(t) && st) { audit('preorder_cancelled', st, 'cancelled by user'); saveSt(null); return reply('Cancelled. Nothing was created.'); }
    var wantsPre = /pre[\s-]?order/i.test(raw) && /(creat|generat|make|place|start|new|add|want|need|book|raise|do)/i.test(raw) || /^pre[\s-]?order\b/i.test(raw);
    var nav = NAV_RE.exec(raw), isOrderQ = /\border\b.*\b(?:details?|number|no\.?|#)|\border\s+#?[A-Za-z]{2,}[-\s]?\d+/i.test(raw);
    if (st) {
      if (wantsPre) { saveSt(null); st = null; }
      else if (/^(yes|y|confirm|confirmed|go ahead|create it|create|do it|proceed|yes confirm|confirm and create)$/i.test(t)) return doConfirm(st);
      else if (/^(no|n)$/.test(t) && st.awaiting === 'confirm') { return reply('Okay. What would you like to change?', { choices: [{ label: 'Dealer', value: 'change dealer' }, { label: 'Product', value: 'change product' }, { label: 'Pack size', value: 'change pack' }, { label: 'Flavour', value: 'change flavour' }, { label: 'Quantity', value: 'change quantity' }, { label: 'Cancel', value: 'cancel' }] }); }
      else {
        var ed = applyEdit(raw, st); if (ed) return ed;
        var inSlot = st.awaiting && handleSlot.length ? true : false;
        if (nav && st.awaiting && !/^\d+$/.test(t)) { var probe = Tools.navigate_to_page(nav[1]); if (probe.ok || probe.denied || probe.choose) { saveSt(null); var pre = reply('I have set the preorder aside. '); var nr = navigate(nav[1], raw); nr.text = pre.text + nr.text; return nr; } }
        if (st.awaiting === 'confirm') return reply('Please choose Confirm and create, Change something, or Cancel.', { choices: [{ label: 'Confirm and create', value: 'confirm' }, { label: 'Change something', value: 'change' }, { label: 'Cancel', value: 'cancel' }] });
        var hs = handleSlot(raw, st); if (hs) return hs;
      }
    }
    var whereM = /^(?:please\s+)?(?:can you\s+)?(?:tell me\s+)?(?:where(?:'s| is| can i find| do i find| can i see| are)|how (?:do|can) i (?:find|open|get to|reach|go to)|guide me to|point (?:me )?to|show me where)\s+(?:the\s+)?(.+?)\s*\??$/i.exec(raw);
    if (whereM && !/order\s+(?:no|number|#)?\s*[A-Za-z]{2,}[-\s]?\d/i.test(whereM[1])) { var wr = Tools.navigate_to_page(whereM[1].replace(/\b(tab|page|section|screen|menu)\b/gi, ' ').trim() || whereM[1]); if (wr.ok) return reply('Here is ' + wr.label + ' in your menu. I am flying over to it.', { guide: { sel: '.vnav .tabs a[href="#/' + wr.key + '"], .hnav a[href="#/' + wr.key + '"]', text: wr.label + ' is here. Click it to open.' } }); if (wr.denied) { audit('navigate_denied', { q: whereM[1] }, wr.denied); return reply('You do not have access to ' + wr.denied + ', so it is not in your menu.'); } if (wr.choose) return reply('Which one do you mean?', { choices: wr.choose.map(function (c) { return { label: c.label, value: 'where is ' + c.label }; }) }); }
    if (/\b(give me a tour|take a tour|a tour of|show me around|walk me through|help me navigate|guide me around|tour)\b/i.test(t) && t.split(' ').length <= 8) return reply('Sure. I will fly through your menu and explain each section. Press Next to move on, or End tour to stop.', { tour: true });
    var shI = sheetIntent(raw); if (shI) return shI; var waI = waIntent(raw); if (waI) return waI;
    if (wantsPre) return startPreorder(raw);
    if (isOrderQ) { var oq = (/(?:order(?:\s*(?:details?|number|no\.?|#))*\s*(?:for|of)?\s*#?\s*)([A-Za-z0-9][A-Za-z0-9\-]*)\s*$/i.exec(raw) || [])[1]; if (oq) return orderDetails(oq); }
    if (nav) { var soft = /^(?:please\s+)?(?:can you\s+)?show(?:\s+me)?\s/i.test(raw); var nr0 = navigate(nav[1], raw, soft); if (nr0 === null) return null; return nr0; }
    if (/^(?:go\s+)?back(?:\s+to)?\s*(?:the\s*)?(.*)$/i.test(raw)) { var bt = /^(?:go\s+)?back(?:\s+to)?\s*(?:the\s*)?(.*)$/i.exec(raw)[1]; if (bt) return navigate(bt, raw); }
    var bare = Tools.navigate_to_page(raw); if (norm(raw).split(' ').length <= 3 && (bare.ok || bare.denied) && !/\?/.test(raw)) return navigate(raw, raw);
    return null;
  }
  function navigate(target, raw, soft) {
    var r = Tools.navigate_to_page(target.replace(/\b(tab|page|section|screen|menu|please|pls|the)\b/gi, ' ').trim() || target);
    if (r.none && soft) return null;
    if (r.none) return reply('I could not find a page called "' + target + '". I can open: ' + allowedLabels().join(', ') + '.');
    if (r.denied) return reply('You do not have access to ' + r.denied + ', so I cannot open it. Please ask the Host if you need access.');
    if (r.choose) return reply('Which one do you mean?', { choices: r.choose.map(function (c) { return { label: c.label, value: 'open ' + c.label }; }) });
    return reply('Opening ' + r.label + '.', { go: '#/' + r.key });
  }
  function allowedLabels() { var ok = allowedKeys(); return ROUTES.filter(function (r) { return ok.indexOf(r[0]) > -1; }).map(function (r) { return r[1]; }).slice(0, 12); }
  function orderDetails(q) {
    var r = Tools.get_order_details(q); if (r.error) return reply(r.error); if (r.denied) { audit('order_denied', { q: q }, 'not permitted'); return reply('I found an order like that, but you are not allowed to see it, so I cannot open it.'); } if (r.none) return reply('I could not find an order matching "' + q + '" that you can access. Please check the number.');
    if (r.choose) return reply('Several orders match "' + q + '". Which one?', { choices: r.choose.map(function (o) { return { label: o.id + ' (' + o.dealerName + ', ' + inr(o.totals.total) + ')', value: 'order details ' + o.id }; }) });
    return reply('Opening order ' + r.order.id + ' for ' + r.order.dealerName + ': ' + inr(r.order.totals.total) + ', ' + r.order.status + '.', { openOrder: { code: r.order.dealerCode, id: r.order.id } });
  }
  window.SelAgent = { handle: handle, tools: Tools, score: score, reset: function () { saveSt(null); }, log: function () { return jget(LOGK, []); } };
})();
