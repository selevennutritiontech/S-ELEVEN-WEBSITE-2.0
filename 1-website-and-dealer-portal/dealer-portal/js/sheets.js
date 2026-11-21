/* S-ELEVEN Sheets.
   - A spreadsheet that lives inside the portal: one workbook per department and one personal workbook per user (the Host sees all of them).
   - Orders and payments are written into the right sheets automatically (new order, payment received, push, invoice, warehouse, tracking, delivered).
   - Formulas (SUM, AVERAGE, IF, SUMIF, VLOOKUP ...), add/delete rows and columns, sort, find, undo/redo, copy/paste, CSV import and export.
   - Google Sheets: paste a Google Sheets link and it is shown inside the portal (no new tab). If a Google Apps Script web app is connected (Host > Sheets > Connect), every automatic row is also sent to real Google Sheets.
   Everything here works offline; the Google parts need internet. */
(function () {
  'use strict';
  var KEY = 'sel.v2.sheets', CFGK = 'sel.v2.sheetscfg', QK = 'sel.v2.sheetsq', cache = null, ST = { sel: { r: 1, c: 0, r2: 1, c2: 0 }, undo: {}, redo: {}, find: '', editing: false, clip: null };
  var DEPT = { host: 'Company (Host)', sales: 'Sales', logistics: 'Logistics', warehouse: 'Warehouse', finance: 'Finance', branding: 'Branding', it: 'IT', hr: 'HR', fieldsales: 'Field Sales' };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function jget(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function jset(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  var curKey = KEY; function load() { var k = kk(); if (!cache || curKey !== k) { curKey = k; cache = jget(k, null) || { v: 1, books: {}, links: [] }; } return cache; }
  function save() { jset(kk(), cache); }
  function uid(p) { return p + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36); }
  function tod() { return new Date().toISOString().slice(0, 10); }
  function fdt(iso) { if (!iso) return ''; var d = new Date(iso); return isNaN(d) ? '' : d.toISOString().slice(0, 10) + ' ' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }
  function r2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
  var scfg = null;   /* secure mode: the Google settings come from the server and never include the secret */
  function SV() { return !!(window.SEL_SERVER && window.SelServer && window.SelServer.me && window.SelServer.me.kind === 'staff'); }
  function cfg() { if (SV()) { if (!scfg) { var r = window.SelServer.xhr('GET', '/api/sheets/config'); scfg = (r.status === 200 && r.json) ? r.json : { connected: false, glinks: {} }; } var g = {}; Object.keys(scfg.glinks || {}).forEach(function (d) { g[d] = { id: 'server', url: scfg.glinks[d].url, by: scfg.glinks[d].by, at: scfg.glinks[d].at }; }); var stt = scfg.status || {}; return { url: scfg.connected ? '(connected)' : '', secret: '', owner: scfg.owner || '', glinks: g, last: stt.lastOkAt || 0, err: stt.lastError || '', srvQueued: scfg.queued || 0 }; } return jget(CFGK, { url: '', secret: '' }); }
  function qk() { return QK + (SV() ? '.' + window.SelServer.me.code : ''); }
  function kk() { return KEY + (SV() ? '.' + window.SelServer.me.code : ''); }

  /* ------------------------------------------------------------------ formulas ------------------------------------------------------------------ */
  function colName(i) { var s = ''; i++; while (i > 0) { var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
  function colIndex(s) { var n = 0; for (var i = 0; i < s.length; i++) n = n * 26 + (s.charCodeAt(i) - 64); return n - 1; }
  function ERR(e) { return { e: e }; } function isErr(v) { return v && typeof v === 'object' && v.e; }
  function num(v) { if (isErr(v)) return v; if (v === '' || v == null) return 0; if (typeof v === 'boolean') return v ? 1 : 0; var n = Number(String(v).replace(/,/g, '')); return isNaN(n) ? ERR('#VALUE!') : n; }
  function isNumStr(s) { return s !== '' && s != null && !isNaN(Number(String(s).replace(/,/g, ''))) && /^[\s\-+.\d,eE]+$/.test(String(s)); }
  function tokenize(src) {
    var t = [], i = 0, m, re;
    while (i < src.length) {
      var ch = src[i]; if (/\s/.test(ch)) { i++; continue; }
      if (ch === '"') { var j = i + 1, s = ''; while (j < src.length && src[j] !== '"') s += src[j++]; t.push({ t: 's', v: s }); i = j + 1; continue; }
      re = /^\$?[A-Za-z]{1,3}\$?\d+(:\$?[A-Za-z]{1,3}\$?\d+)?/; m = re.exec(src.slice(i)); if (m && !/^[A-Za-z(]/.test(src.slice(i + m[0].length, i + m[0].length + 1) || '1')) { t.push({ t: 'ref', v: m[0].replace(/\$/g, '').toUpperCase() }); i += m[0].length; continue; }
      re = /^\d+(\.\d+)?([eE][+-]?\d+)?/; m = re.exec(src.slice(i)); if (m) { t.push({ t: 'n', v: parseFloat(m[0]) }); i += m[0].length; continue; }
      re = /^[A-Za-z_][A-Za-z0-9_.]*/; m = re.exec(src.slice(i)); if (m) { var up = m[0].toUpperCase(); if (src[i + m[0].length] === '(') { t.push({ t: 'fn', v: up }); i += m[0].length + 1; } else if (up === 'TRUE' || up === 'FALSE') { t.push({ t: 'b', v: up === 'TRUE' }); i += m[0].length; } else return null; continue; }
      m = /^(<>|<=|>=|[-+*\/^&=<>(),%])/.exec(src.slice(i)); if (m) { t.push({ t: 'op', v: m[0] }); i += m[0].length; continue; } return null;
    }
    return t;
  }
  function parse(tokens) {
    var p = 0; function peek() { return tokens[p]; } function nx() { return tokens[p++]; }
    function isOp(v) { var k = peek(); return k && k.t === 'op' && k.v === v; }
    function cmp() { var l = cat(); while (peek() && peek().t === 'op' && ['=', '<>', '<', '>', '<=', '>='].indexOf(peek().v) > -1) { var o = nx().v; l = { k: 'bin', o: o, l: l, r: cat() }; } return l; }
    function cat() { var l = add(); while (isOp('&')) { nx(); l = { k: 'bin', o: '&', l: l, r: add() }; } return l; }
    function add() { var l = mul(); while (isOp('+') || isOp('-')) { var o = nx().v; l = { k: 'bin', o: o, l: l, r: mul() }; } return l; }
    function mul() { var l = pow(); while (isOp('*') || isOp('/')) { var o = nx().v; l = { k: 'bin', o: o, l: l, r: pow() }; } return l; }
    function pow() { var l = un(); while (isOp('^')) { nx(); l = { k: 'bin', o: '^', l: l, r: un() }; } return l; }
    function un() { if (isOp('-')) { nx(); return { k: 'neg', x: un() }; } if (isOp('+')) { nx(); return un(); } return post(); }
    function post() { var x = prim(); while (isOp('%')) { nx(); x = { k: 'bin', o: '/', l: x, r: { k: 'n', v: 100 } }; } return x; }
    function prim() {
      var k = nx(); if (!k) throw 0;
      if (k.t === 'n') return { k: 'n', v: k.v }; if (k.t === 's') return { k: 's', v: k.v }; if (k.t === 'b') return { k: 'b', v: k.v }; if (k.t === 'ref') return { k: 'ref', v: k.v };
      if (k.t === 'fn') { var a = []; if (!isOp(')')) { a.push(cmp()); while (isOp(',')) { nx(); a.push(cmp()); } } if (!isOp(')')) throw 0; nx(); return { k: 'fn', n: k.v, a: a }; }
      if (k.t === 'op' && k.v === '(') { var e = cmp(); if (!isOp(')')) throw 0; nx(); return e; } throw 0;
    }
    var tree = cmp(); if (p < tokens.length) throw 0; return tree;
  }
  function matchCrit(v, crit) {
    var c = String(crit), m = /^(<>|<=|>=|=|<|>)?(.*)$/.exec(c), op = m[1] || '=', want = m[2], a = isNumStr(v) && isNumStr(want) ? Number(v) : String(v).toLowerCase(), b = isNumStr(want) ? Number(want) : want.toLowerCase();
    if (op === '=') return a === b; if (op === '<>') return a !== b; if (op === '<') return a < b; if (op === '>') return a > b; if (op === '<=') return a <= b; return a >= b;
  }
  /* evaluate a whole tab; returns function value(r,c) */
  function evaluator(tab) {
    var memo = {}, busy = {}, cells = tab.cells;
    function raw(r, c) { var row = cells[r]; var v = row ? row[c] : ''; return v == null ? '' : v; }
    function val(r, c) {
      var k = r + ',' + c; if (k in memo) return memo[k]; if (busy[k]) return ERR('#CIRC!'); var s = String(raw(r, c));
      if (s.charAt(0) !== '=' || (tab.auto && r > 0 && c < (tab.nAuto || (HEAD[tab.auto] || []).length))) { memo[k] = isNumStr(s) ? Number(String(s).replace(/,/g, '')) : s; return memo[k]; }
      busy[k] = 1; var out; try { var tk = tokenize(s.slice(1)); if (!tk) out = ERR('#NAME?'); else out = ev(parse(tk)); } catch (e) { out = ERR('#ERROR!'); } delete busy[k]; if (out && out.range) out = out.range[0] !== undefined ? out.range[0] : ''; memo[k] = out; return out;
    }
    function refVal(ref) {
      var m = /^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/.exec(ref); if (!m) return ERR('#REF!'); var c1 = colIndex(m[1]), r1 = parseInt(m[2], 10) - 1; if (!m[3]) return val(r1, c1);
      var c2 = colIndex(m[3]), r2_ = parseInt(m[4], 10) - 1, out = []; for (var r = Math.min(r1, r2_); r <= Math.max(r1, r2_); r++) for (var c = Math.min(c1, c2); c <= Math.max(c1, c2); c++) out.push(val(r, c)); return { range: out, w: Math.abs(c2 - c1) + 1, h: Math.abs(r2_ - r1) + 1 };
    }
    function flat(args) { var o = []; args.forEach(function (a) { if (a && a.range) a.range.forEach(function (x) { o.push(x); }); else o.push(a); }); return o; }
    function nums(args) { var o = []; flat(args).forEach(function (x) { if (isErr(x)) o.push(x); else if (typeof x === 'number') o.push(x); else if (typeof x === 'boolean') o.push(x ? 1 : 0); }); return o; }
    function firstErr(a) { for (var i = 0; i < a.length; i++) if (isErr(a[i])) return a[i]; return null; }
    function truthy(v) { return typeof v === 'boolean' ? v : (typeof v === 'number' ? v !== 0 : (String(v).toUpperCase() === 'TRUE')); }
    var F = {
      SUM: function (a) { var n = nums(a), e = firstErr(n); return e || n.reduce(function (x, y) { return x + y; }, 0); },
      AVERAGE: function (a) { var n = nums(a), e = firstErr(n); if (e) return e; return n.length ? n.reduce(function (x, y) { return x + y; }, 0) / n.length : ERR('#DIV/0!'); },
      MIN: function (a) { var n = nums(a), e = firstErr(n); return e || (n.length ? Math.min.apply(null, n) : 0); }, MAX: function (a) { var n = nums(a), e = firstErr(n); return e || (n.length ? Math.max.apply(null, n) : 0); },
      COUNT: function (a) { return nums(a).filter(function (x) { return !isErr(x); }).length; }, COUNTA: function (a) { return flat(a).filter(function (x) { return x !== '' && x != null; }).length; },
      ROUND: function (a) { var n = num(a[0]); if (isErr(n)) return n; var d = a.length > 1 ? num(a[1]) : 0, f = Math.pow(10, d); return Math.round(n * f) / f; }, ABS: function (a) { var n = num(a[0]); return isErr(n) ? n : Math.abs(n); },
      IF: function (a) { return truthy(a[0]) ? (a.length > 1 ? a[1] : true) : (a.length > 2 ? a[2] : false); }, IFERROR: function (a) { return isErr(a[0]) ? a[1] : a[0]; },
      AND: function (a) { return flat(a).every(truthy); }, OR: function (a) { return flat(a).some(truthy); }, NOT: function (a) { return !truthy(a[0]); },
      CONCAT: function (a) { return flat(a).map(function (x) { return isErr(x) ? '' : String(x); }).join(''); }, UPPER: function (a) { return String(a[0]).toUpperCase(); }, LOWER: function (a) { return String(a[0]).toLowerCase(); }, LEN: function (a) { return String(a[0]).length; }, TRIM: function (a) { return String(a[0]).trim(); },
      LEFT: function (a) { return String(a[0]).slice(0, a.length > 1 ? num(a[1]) : 1); }, RIGHT: function (a) { var s = String(a[0]), n = a.length > 1 ? num(a[1]) : 1; return n ? s.slice(-n) : ''; },
      TODAY: function () { return tod(); }, NOW: function () { return fdt(new Date().toISOString()); },
      COUNTIF: function (a) { var r = a[0] && a[0].range ? a[0].range : [a[0]]; return r.filter(function (x) { return matchCrit(x, a[1]); }).length; },
      SUMIF: function (a) { var r = a[0].range || [a[0]], s = (a[2] && a[2].range) || r, t = 0; r.forEach(function (x, i) { if (matchCrit(x, a[1])) { var n = typeof s[i] === 'number' ? s[i] : 0; t += n; } }); return t; },
      VLOOKUP: function (a) { var rg = a[1]; if (!rg || !rg.range) return ERR('#REF!'); var idx = num(a[2]); for (var i = 0; i < rg.h; i++) { if (String(rg.range[i * rg.w]).toLowerCase() === String(a[0]).toLowerCase()) return idx >= 1 && idx <= rg.w ? rg.range[i * rg.w + idx - 1] : ERR('#REF!'); } return ERR('#N/A'); }
    };
    function ev(n) {
      switch (n.k) {
        case 'n': case 's': case 'b': return n.v; case 'ref': return refVal(n.v);
        case 'neg': { var x = ev(n.x); x = num(x); return isErr(x) ? x : -x; }
        case 'bin': {
          var l = ev(n.l), r = ev(n.r); if (l && l.range) l = l.range[0]; if (r && r.range) r = r.range[0]; if (isErr(l)) return l; if (isErr(r)) return r;
          if (n.o === '&') return String(l == null ? '' : l) + String(r == null ? '' : r);
          if (['=', '<>', '<', '>', '<=', '>='].indexOf(n.o) > -1) { var a = typeof l === 'number' && typeof r === 'number' ? [l, r] : [String(l).toLowerCase(), String(r).toLowerCase()]; return n.o === '=' ? a[0] === a[1] : n.o === '<>' ? a[0] !== a[1] : n.o === '<' ? a[0] < a[1] : n.o === '>' ? a[0] > a[1] : n.o === '<=' ? a[0] <= a[1] : a[0] >= a[1]; }
          var p = num(l), q = num(r); if (isErr(p)) return p; if (isErr(q)) return q; if (n.o === '+') return p + q; if (n.o === '-') return p - q; if (n.o === '*') return p * q; if (n.o === '/') return q === 0 ? ERR('#DIV/0!') : p / q; if (n.o === '^') return Math.pow(p, q); return ERR('#ERROR!');
        }
        case 'fn': { var f = F[n.n]; if (!f) return ERR('#NAME?'); var args = n.a.map(ev); if (n.n !== 'IFERROR' && n.n !== 'IF') { var e = firstErr(args.filter(function (x) { return !(x && x.range); })); if (e && ['COUNT', 'COUNTA', 'COUNTIF', 'SUMIF'].indexOf(n.n) < 0) return e; } return f(args); }
      } return ERR('#ERROR!');
    }
    return val;
  }
  function fmtVal(v, f) {
    if (isErr(v)) return v.e; if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'; if (v == null) return '';
    if (typeof v === 'number') { if (f === 'inr') return '\u20B9' + v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); if (f === 'num') return v.toLocaleString('en-IN', { maximumFractionDigits: 2 }); return String(Math.round(v * 1e9) / 1e9); }
    return String(v);
  }

  /* ------------------------------------------------------------------ workbooks ------------------------------------------------------------------ */
  var HEAD = {
    orders: ['Order ID', 'Date', 'Dealer', 'Dealer code', 'Created by', 'Sales employee', 'Items', 'Qty', 'Weight (kg)', 'Subtotal', 'Freight', 'GST', 'Total', 'Payment', 'Stage', 'Invoice no', 'Dispatch from', 'Courier', 'Tracking ID'],
    payments: ['Payment ID', 'Date', 'Order ID', 'Dealer', 'Method', 'Reference / UTR', 'Amount', 'Status', 'Verified by', 'Verified on', 'Gateway / receipt ID'],
    invoices: ['Order ID', 'Dealer', 'Invoice no', 'Invoice date', 'Uploaded by', 'E-way bill no', 'Pushed to Warehouse', 'Pushed by'],
    shipments: ['Order ID', 'Dealer', 'Weight (kg)', 'Dispatch from', 'Rate per kg', 'Logistics cost', 'Courier', 'Tracking ID', 'Status', 'Dispatched on', 'Delivered on', 'Tracking link'],
    tracker: ['Order ID', 'Date', 'Dealer', 'Total', 'Payment', 'Stage', 'Next pending step', 'Waiting on', '1 Payment confirmed', '2 Pushed to Logistics/Finance', '3 Invoice uploaded', '4 E-way bill', '5 Verified and pushed to Warehouse', '6 Packed', '7 Dispatched by the Warehouse', '8 Tracking added', '9 Delivered'],
    topack: ['Order ID', 'Date', 'Dealer', 'Items', 'Qty', 'Weight (kg)', 'Invoice no', 'Packing note', 'Stage'],
    packed: ['Order ID', 'Dealer', 'Qty', 'Weight (kg)', 'Stage', 'Packed on', 'Courier', 'Tracking ID'],
    activity: ['Time', 'User', 'Department', 'Action', 'Reference', 'Details']
  };
  var MONEY = { orders: [9, 10, 11, 12], payments: [6], shipments: [5], tracker: [3] };
  var TABS = {
    host: [['Order tracker', 'tracker'], ['All orders', 'orders'], ['Payments', 'payments'], ['Invoices', 'invoices'], ['Shipments', 'shipments'], ['Activity', 'activity']], sales: [['Orders', 'orders'], ['Payments', 'payments']], fieldsales: [['Orders', 'orders'], ['Payments', 'payments']], finance: [['Orders', 'orders'], ['Payments', 'payments'], ['Invoices', 'invoices']],
    logistics: [['Orders to ship', 'orders'], ['Shipments', 'shipments']], warehouse: [['To pack', 'topack'], ['Packed and dispatched', 'packed']]
  };
  function newTab(name, auto) {
    var t = { id: uid('t'), name: name, auto: auto || null, nAuto: auto ? HEAD[auto].length : 0, cells: [], fmt: {}, bold: {}, widths: {} };
    if (auto) { t.cells = [HEAD[auto].slice()]; (MONEY[auto] || []).forEach(function (c) { t.fmt[c] = 'inr'; }); } else { for (var r = 0; r < 30; r++) { var row = []; for (var c = 0; c < 10; c++) row.push(''); t.cells.push(row); } }
    return t;
  }
  function bookId(kind, owner) { return kind + ':' + owner; }
  function ensureBook(kind, owner) {
    var S = load(), id = bookId(kind, owner), b = S.books[id]; if (b) return b;
    b = S.books[id] = { id: id, kind: kind, owner: owner, title: kind === 'user' ? 'My sheets: ' + owner : (DEPT[owner] || owner) + ' sheets', tabs: [] };
    if (kind === 'user') { var em = null; try { em = DB.getEmployee(owner); } catch (e) {} if (em && em.dept === 'sales') b.tabs.push(newTab('My orders', 'orders')); b.tabs.push(newTab('My activity', 'activity')); } else (TABS[owner] || []).forEach(function (x) { b.tabs.push(newTab(x[0], x[1])); });
    b.tabs.push(newTab('Sheet1', null)); save(); return b;
  }
  /* what a person may open: their own workbook, their department's, and (Host) everything */
  function visibleBooks(u) {
    var out = [], S = load(); out.push(ensureBook('user', u.code)); var d = u.dept || (u.role === 'admin' ? 'host' : u.role); if ((u.role !== 'admin' || d !== 'host') && d !== 'fieldsales') out.push(ensureBook('dept', d));   /* a field consultant sees only their own sheets, never a department's */
    if (u.role === 'admin') { ['host'].concat(Object.keys(DEPT).filter(function (x) { return x !== 'host'; })).forEach(function (x) { ensureBook('dept', x); }); try { DB.listEmployees().forEach(function (e) { ensureBook('user', e.id); }); } catch (e) {} out = Object.keys(S.books).map(function (k) { return S.books[k]; }).sort(function (a, b) { return (a.kind === b.kind ? 0 : a.kind === 'dept' ? -1 : 1) || (a.id < b.id ? -1 : 1); }); out = out.filter(function (b, i, arr) { return arr.indexOf(b) === i; }); out.sort(function (a, b) { return (a.id === 'user:' + u.code ? -1 : 0) - (b.id === 'user:' + u.code ? -1 : 0); }); }
    return out;
  }
  function canEdit(u, b) { return u.role === 'admin' || (b.kind === 'user' && b.owner === u.code) || (b.kind === 'dept' && (u.dept === b.owner || (u.role === b.owner))); }
  function canOpen(u, b) { return visibleBooks(u).some(function (x) { return x.id === b.id; }); }

  /* ------------------------------------------------------------------ automatic rows ------------------------------------------------------------------ */
  function allOrdersRaw() { var out = []; try { DB.listDealers().forEach(function (d) { (DB.listOrders(d.code) || []).forEach(function (o) { o.dealerCode = o.dealerCode || d.code; o.dealerName = o.dealerName || d.name; out.push(o); }); }); } catch (e) {} return out; }
  function rowsFor(src, dept, o) {
    var vis = function (r) { try { return DB.visibleTo(r, o); } catch (e) { return true; } }, rows = [], st = '', idx = 0, qty = 0, w = 0;
    try { idx = DB.stageIdx(o); st = DB.stageOf(o).label; w = DB.orderWeight(o); } catch (e) {} (o.items || []).forEach(function (l) { qty += l.qty || 0; });
    var sh = o.shipment || {}, df = o.dispatchFrom, cr = ''; try { var c = sh.partner ? DB.getCourier(sh.partner) : null; cr = c ? c.name : (sh.partner || ''); } catch (e) {}
    var base = [o.id, (o.date || '').slice(0, 10), o.dealerName || '', o.dealerCode || '', (o.createdBy && o.createdBy.name) || '', (o.attr && o.attr.name) || (o.attr && o.attr.emp) || '', (o.items || []).length, qty, w, r2(o.totals && o.totals.subtotal), r2(o.totals && o.totals.freight), r2(o.totals && o.totals.gst), r2(o.totals && o.totals.total), o.payment ? (o.payment.status === 'Paid' ? 'Paid' : (o.proofs && o.proofs.length ? 'Proof to verify' : 'Pending')) : '', st, o.invoice ? o.invoice.no : '', df ? df.name : '', cr, sh.trackingId || ''];
    var fieldOrd = false; try { var fe = o.attr && o.attr.emp ? DB.getEmployee(o.attr.emp) : null; fieldOrd = !!(fe && fe.dept === 'fieldsales'); } catch (e) {}   /* the Field Sales sheet holds the orders of field consultants (their own and their dealers') */
    if (src === 'orders') { if (dept === 'fieldsales' ? fieldOrd : (dept === 'host' || dept === 'sales' || vis(dept))) rows.push(base); }
    else if (src === 'payments') {
      if (!(dept === 'fieldsales' ? fieldOrd : (dept === 'host' || dept === 'sales' || vis(dept)))) return rows; var any = false;
      (o.proofs || []).forEach(function (p) { any = true; rows.push([p.id, p.date || (p.at || '').slice(0, 10), o.id, o.dealerName || '', p.method || '', p.ref || '', r2(p.amount), p.status || '', p.verifiedBy || '', (p.verifiedAt || '').slice(0, 10), p.receipt || '']); });
      if (!any && o.payment && o.payment.status === 'Paid') { var rc = null; try { rc = DB.receiptOf(o); } catch (e) {} rows.push(['PAY-' + o.id, (o.payment.paidAt || '').slice(0, 10), o.id, o.dealerName || '', o.payment.method || '', o.payment.txn || '', r2(o.totals && o.totals.total), 'Received', o.payment.by || '', (o.payment.paidAt || '').slice(0, 10), rc ? rc.no : (o.payment.txn || '')]); }
    }
    else if (src === 'invoices') { if (!(o.invoiceFile && (dept === 'host' || vis(dept)))) return rows; rows.push([o.id, o.dealerName || '', o.invoice ? o.invoice.no : '', (o.invoice && o.invoice.date || '').slice(0, 10), (o.invoiceFile && o.invoiceFile.by) || '', o.ewayFile ? o.ewayFile.no : '', o.whPush ? 'Yes' : 'No', o.whPush ? o.whPush.by : '']); }
    else if (src === 'shipments') { if (!(dept === 'host' || vis('logistics')) || !(df || sh.trackingId)) return rows; rows.push([o.id, o.dealerName || '', w, df ? df.name : '', df ? df.perKg : '', df ? df.cost : '', cr, sh.trackingId || '', o.status, (sh.dispatchedAt || (o.whDispatch && o.whDispatch.at) || '').slice(0, 10), o.status === 'Delivered' ? ((o.history || []).filter(function (h) { return /deliver/i.test(h.status); }).map(function (h) { return h.at.slice(0, 10); })[0] || '') : '', (function () { try { var c2 = sh.partner ? DB.getCourier(sh.partner) : null; return c2 && c2.url && sh.trackingId ? c2.url.replace('{id}', encodeURIComponent(sh.trackingId)) : ''; } catch (e) { return ''; } })()]); }
    else if (src === 'tracker') {
      if (dept !== 'host') return rows; var hd = function (re) { var h = (o.history || []).filter(function (x) { return re.test(x.status); })[0]; return h ? String(h.at).slice(0, 10) : ''; }, tick = function (d) { return d ? '\u2713 ' + String(d).slice(0, 10) : '\u2713'; };
      var paid = o.payment && o.payment.status === 'Paid', needE = false; try { needE = DB.needsEway(o); } catch (e) {}
      var steps = [paid ? tick(o.payment.paidAt) : '', o.confirmed ? tick(hd(/confirm|pushed to logistics/i)) : '', o.invoiceFile ? tick(o.invoiceFile.at) : '', needE ? (o.ewayFile ? tick(o.ewayFile.at) : '') : 'n/a', o.whPush ? tick(o.whPush.at) : '', idx >= 6 ? tick(hd(/^packed/i)) : '', idx >= 7 ? tick(o.whDispatch && o.whDispatch.at) : '', sh.trackingId ? tick(sh.updatedAt) : '', idx >= 8 ? tick(hd(/deliver/i)) : ''];
      var names = ['Payment confirmed', 'Push to Logistics and Finance', 'Invoice upload', 'E-way bill', 'Verify and push to Warehouse', 'Packing', 'Dispatch', 'Tracking details', 'Delivery'], who = ['Sales / Finance', 'Sales', 'Logistics / Finance', 'Logistics / Finance', 'Logistics / Finance', 'Warehouse', 'Warehouse', 'Logistics / Finance', 'Logistics'], nx = -1, i;
      for (i = 0; i < steps.length; i++) { if (steps[i] === '' ) { nx = i; break; } }
      var cells = steps.map(function (x) { return x === '' ? 'Pending' : x; });
      rows.push([o.id, (o.date || '').slice(0, 10), o.dealerName || '', r2(o.totals && o.totals.total), base[13], o.cancelled ? 'Cancelled' : st, o.cancelled ? '' : (nx < 0 ? 'None: complete' : names[nx]), o.cancelled ? '' : (nx < 0 ? '' : who[nx])].concat(cells));
    }
    else if (src === 'topack') { if (!(vis('warehouse') && idx >= 4 && idx <= 5)) return rows; rows.push([o.id, (o.date || '').slice(0, 10), o.dealerName || '', (o.items || []).length, qty, w, o.invoice ? o.invoice.no : '', o.packNote ? o.packNote.text : '', st]); }
    else if (src === 'packed') { if (!(vis('warehouse') && idx >= 6)) return rows; rows.push([o.id, o.dealerName || '', qty, w, st, ((o.history || []).filter(function (h) { return /^packed/i.test(h.status); }).map(function (h) { return h.at.slice(0, 10); })[0]) || '', cr, sh.trackingId || '']); }
    return rows;
  }
  var pendingOut = [], lastOkAt = 0;
  /* every row sent to Google carries its department and, when the department has linked its own Google Sheet, that sheet's id */
  function item(b, tab, key, headers, row) { var g = b.kind === 'dept' ? glink(b.owner) : null; return { book: b.title, dept: b.kind === 'dept' ? b.owner : '', target: g ? g.id : '', tab: tab.name, key: key, headers: headers.map(safeCell), row: row.map(safeCell) }; }
  function upsert(tab, b, rows, nAuto) {
    var changed = false; if (tab.name === 'Order tracker' && tab.cells[0] && tab.cells[0][14] === '7 Tracking added') { tab.cells[0][14] = '7 Dispatched by the Warehouse'; tab.cells[0][15] = '8 Tracking added'; changed = true; }   /* existing workbooks: Dispatch now comes before Tracking */ rows.forEach(function (row) {
      var key = String(row[0]), at = -1; for (var r = 1; r < tab.cells.length; r++) if (String(tab.cells[r][0]) === key) { at = r; break; }
      if (at < 0) { var nr = row.slice(); while (nr.length < Math.max(tab.cells[0].length, nAuto)) nr.push(''); tab.cells.push(nr); changed = true; pendingOut.push(item(b, tab, key, tab.cells[0].slice(0, nAuto), row)); }
      else { var diff = false; for (var c = 0; c < row.length; c++) if (String(tab.cells[at][c]) !== String(row[c])) { tab.cells[at][c] = row[c]; diff = true; } if (diff) { changed = true; pendingOut.push(item(b, tab, key, tab.cells[0].slice(0, nAuto), row)); } }
    }); return changed;
  }
  /* older workbooks get the new automatic sheets and columns (existing rows and your own columns are kept) */
  function fixBook(b) {
    if (b.kind === 'dept') (TABS[b.owner] || []).forEach(function (x, i) { if (!b.tabs.some(function (t) { return t.auto === x[1]; })) { b.tabs.splice(Math.min(i, b.tabs.length), 0, newTab(x[0], x[1])); } });
    b.tabs.forEach(function (t) {
      if (!t.auto) return; var want = HEAD[t.auto], old = t.nAuto || (t.auto === 'shipments' ? 11 : want.length);
      if (old < want.length) t.cells.forEach(function (row) { var pad = []; for (var k = old; k < want.length; k++) pad.push(''); Array.prototype.splice.apply(row, [old, 0].concat(pad)); });
      t.nAuto = want.length; for (var c = 0; c < want.length; c++) { if (!t.cells[0]) t.cells[0] = []; t.cells[0][c] = want[c]; }
    });
  }
  function syncOrders(only) {
    var S = load(), ch = false, orders = only ? [only] : allOrdersRaw(); pendingOut = [];
    try { Object.keys(DEPT).forEach(function (d) { ensureBook('dept', d); }); } catch (e) {}
    Object.keys(S.books).forEach(function (id) { try { fixBook(S.books[id]); } catch (e) {} });
    Object.keys(S.books).forEach(function (id) { var b = S.books[id]; if (b.kind !== 'dept') return; b.tabs.forEach(function (t) { if (!t.auto || t.auto === 'activity') return; var rows = []; orders.forEach(function (o) { rowsFor(t.auto, b.owner, o).forEach(function (r) { rows.push(r); }); }); if (rows.length && upsert(t, b, rows, HEAD[t.auto].length)) ch = true; }); });
    /* each person's own workbook gets the orders they created or handle */
    Object.keys(S.books).forEach(function (id) { var b = S.books[id]; if (b.kind !== 'user') return; b.tabs.forEach(function (t) { if (t.auto !== 'orders') return; var rows = []; orders.forEach(function (o) { if ((o.attr && o.attr.emp === b.owner) || (o.createdBy && o.createdBy.code === b.owner)) rowsFor('orders', 'host', o).forEach(function (r) { rows.push(r); }); }); if (rows.length && upsert(t, b, rows, HEAD.orders.length)) ch = true; }); });
    if (ch) { save(); queueOut(); } return ch;
  }
  function ensureUserOrdersTab(u) { var b = ensureBook('user', u); if (!b.tabs.some(function (t) { return t.auto === 'orders'; })) { b.tabs.splice(0, 0, newTab('My orders', 'orders')); save(); } return b; }
  function logActivity(by, action, detail) {
    try {
      var S = load(), u = String(by || 'SYSTEM').toUpperCase(), e = null; try { e = DB.getEmployee(u); } catch (x) {} var dept = e ? e.dept : (u === 'ADMIN' ? 'host' : 'dealer'), ref = (/\b([A-Z0-9]+-[A-Z0-9]+(?:-\d+)?|H\d{4}-\d+)\b/.exec(String(detail || '')) || [''])[0], row = [fdt(new Date().toISOString()), u, dept === 'host' ? 'Company (Host)' : (DEPT[dept] || dept), String(action || ''), ref, String(detail || '')];
      var hostB = ensureBook('dept', 'host'), tabs = [hostB.tabs.filter(function (t) { return t.auto === 'activity'; })[0]]; if (e || u === 'ADMIN') { var ub = ensureBook('user', u); tabs.push(ub.tabs.filter(function (t) { return t.auto === 'activity'; })[0]); } if (e && dept !== 'host') { var db = ensureBook('dept', dept), dt = db.tabs.filter(function (t) { return t.auto === 'activity'; })[0]; if (!dt) { dt = newTab('Activity', 'activity'); db.tabs.splice(db.tabs.length - 1, 0, dt); } tabs.push(dt); }
      var dests = []; tabs.forEach(function (t) { if (!t) return; var ob = Object.keys(S.books).map(function (k) { return S.books[k]; }).filter(function (bk) { return bk.tabs.indexOf(t) > -1; })[0]; if (ob) dests.push({ b: ob, t: t }); });
      tabs.forEach(function (t) { if (!t) return; t.cells.push(row.slice()); if (t.cells.length > 2001) t.cells.splice(1, t.cells.length - 2001); }); save(); dests.forEach(function (d) { pendingOut.push(item(d.b, d.t, '', HEAD.activity, row)); }); queueOut();
    } catch (e) {}
  }

  /* ------------------------------------------------------------------ Google Sheets (Apps Script web app) ------------------------------------------------------------------ */
  var flushing = false;
  function queueOut() { var c = cfg(); if (!c.url || !pendingOut.length) { pendingOut = []; return; } var q = jget(qk(), []).concat(pendingOut.map(function (x) { return x; })); pendingOut = []; jset(qk(), q.slice(-1500)); setTimeout(flush, 50); }
  function flush() {
    var c = cfg(); if (!c.url || flushing) return; var q = jget(qk(), []); if (!q.length) return; if (typeof fetch !== 'function') return; flushing = true; var batch = q.slice(0, 25);
    (SV() ? fetch('/api/sheets/push', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': window.SelServer.csrf }, body: JSON.stringify({ items: batch }) }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); }) : fetch(c.url, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ secret: c.secret, items: batch }) })).then(function () { var left = jget(qk(), []).slice(batch.length); jset(qk(), left); flushing = false; lastOkAt = Date.now(); try { var s = jget(CFGK, {}); s.last = Date.now(); s.err = ''; jset(CFGK, s); } catch (e) {} if (left.length) setTimeout(flush, 300); }, function (err) { flushing = false; try { var s = jget(CFGK, {}); s.err = String((err && err.message) || err); jset(CFGK, s); } catch (e) {} setTimeout(flush, 60000); });
  }
  function sendAll() { var S = load(); pendingOut = []; Object.keys(S.books).forEach(function (id) { var b = S.books[id]; b.tabs.forEach(function (t) { if (!t.auto || t.auto === 'activity') return; for (var r = 1; r < t.cells.length; r++) pendingOut.push(item(b, t, String(t.cells[r][0]), t.cells[0].slice(0, HEAD[t.auto].length), t.cells[r].slice(0, HEAD[t.auto].length))); }); }); var n = pendingOut.length; queueOut(); return n; }


  /* ------------------------------------------------------------------ each department links ITS OWN Google Sheet: everything the department does is also written there as a safe copy ------------------------------------------------------------------ */
  function sheetId(url) { var m = /spreadsheets\/d\/([A-Za-z0-9_-]{20,})/.exec(String(url || '')); return m ? m[1] : ''; }
  function glink(dept) { var c = cfg(); return (c.glinks && c.glinks[dept]) || null; }
  function setGlink(dept, url, by) {
    if (SV()) { var rs = window.SelServer.xhr('PUT', '/api/sheets/glink', { dept: dept, url: String(url || '') }); scfg = null; return (rs.status === 200 && rs.json && rs.json.ok) ? { ok: true, id: 'server' } : { error: (rs.json && rs.json.error) || 'Could not save the link.' }; }
    var id = sheetId(url); if (!/^https:\/\/docs\.google\.com\/spreadsheets\/d\//.test(String(url || '')) || !id) return { error: 'Paste the link of a Google Sheet. It starts with https://docs.google.com/spreadsheets/d/' };
    if (!DEPT[dept]) return { error: 'Unknown department.' }; var c = cfg(); c.glinks = c.glinks || {}; c.glinks[dept] = { id: id, url: String(url).trim(), by: by, at: Date.now() }; jset(CFGK, c); return { ok: true, id: id };
  }
  function delGlink(dept) { if (SV()) { window.SelServer.xhr('PUT', '/api/sheets/glink', { dept: dept, url: '' }); scfg = null; return; } var c = cfg(); if (c.glinks) delete c.glinks[dept]; jset(CFGK, c); }
  function deptOf(u) { return u.role === 'admin' && (!u.dept || u.dept === 'host') ? 'host' : (u.dept || u.role); }
  /* true when Google is connected but the person's own department has not linked its sheet yet */
  function needsLink(u) { var c = cfg(); return !!(c.url && !glink(deptOf(u)) && u.role !== 'dealer'); }

  /* ------------------------------------------------------------------ hooks: new order, payment, push, invoice, warehouse, tracking, delivery ------------------------------------------------------------------ */
  var hooked = false;
  function after(name, pick) {
    var f = DB[name]; if (typeof f !== 'function') return; DB[name] = function () { var r = f.apply(DB, arguments); try { var ref = pick.apply(null, arguments); if (ref && !(r && r.error)) setTimeout(function () { try { var o = DB.getOrder(ref[0], ref[1]); if (o) { o.dealerCode = o.dealerCode || ref[0]; var d = DB.getDealer(ref[0]); if (d) o.dealerName = o.dealerName || d.name; syncOrders(o); } } catch (e) {} }, 0); } catch (e) {} return r; };
  }
  function hook() {
    if (hooked || typeof DB === 'undefined') return; hooked = true;
    ['markPaid', 'verifyProof', 'addProof', 'rzpPaid', 'confirmOrder', 'attachInvoiceFile', 'attachEwayFile', 'pushToWarehouse', 'setTracking', 'dispatchFrom', 'setPackNote', 'updateShipment', 'warehouseDispatch', 'markDelivered', 'startPacking', 'finishPacking', 'cancelOrder', 'editOrder'].forEach(function (n) { after(n, function (a, b) { return [a, b]; }); });
    var ao = DB.addOrder; DB.addOrder = function (code, o) { var r = ao.apply(DB, arguments); try { var id = (r && r.id) || (o && o.id); if (id) setTimeout(function () { try { var x = DB.getOrder(code, id); if (x) { x.dealerCode = x.dealerCode || code; var d = DB.getDealer(code); if (d) x.dealerName = x.dealerName || d.name; syncOrders(x); } } catch (e) {} }, 0); } catch (e) {} return r; };
    var na = DB.notifyAction; if (typeof na === 'function') DB.notifyAction = function (by, action, text, kind) { var r = na.apply(DB, arguments); if (kind !== 'signin') logActivity(by, action, text); return r; };
  }
  hook(); setTimeout(flush, 3000);
  /* the system sheets and the linked Google sheets are kept current by themselves: every minute (not only when someone opens the Sheets page) */
  function autoSync() { try { if (!me) { var s0 = JSON.parse(sessionStorage.getItem('sel.v2.staff') || 'null'); if (!s0) return; me = s0; } syncOrders(); ST.lastSync = Date.now(); } catch (e) {} try { flush(); } catch (e) {} }
  setInterval(autoSync, 60000); setTimeout(autoSync, 6000);
  window.addEventListener('online', function () { flush(); });

  /* ------------------------------------------------------------------ the screen ------------------------------------------------------------------ */
  var root = null, me = null, curBook = null, curTab = null;
  function route() { var h = (location.hash || '').replace(/^#\/?/, '').split('/'); return { book: h[1] ? decodeURIComponent(h[1]) : '', tab: h[2] ? decodeURIComponent(h[2]) : '', rest: h.slice(3) }; }
  function tabOf(b, id) { return b.tabs.filter(function (t) { return t.id === id; })[0] || b.tabs[0]; }
  function bookById(id) { return load().books[id]; }
  function linkEmbed(l) {
    var u = String(l.url || ''), m;
    if ((m = /spreadsheets\/d\/e\/([A-Za-z0-9_-]+)/.exec(u))) return 'https://docs.google.com/spreadsheets/d/e/' + m[1] + '/pubhtml?widget=true&headers=false';
    if ((m = /spreadsheets\/d\/([A-Za-z0-9_-]+)/.exec(u))) return l.mode === 'live' ? 'https://docs.google.com/spreadsheets/d/' + m[1] + '/edit?rm=minimal&widget=true&headers=false' : 'https://docs.google.com/spreadsheets/d/' + m[1] + '/htmlview?rm=minimal&widget=true';
    return '';
  }
  function visibleLinks(u) { return load().links.filter(function (l) { return l.by === u.code || u.role === 'admin' || l.scope === 'all' || (l.scope === 'dept' && l.dept === (u.dept || u.role)); }); }
  function home() {
    var books = visibleBooks(me), links = visibleLinks(me), c = cfg(), q = jget(qk(), []).length;
    var card = function (b) { var n = b.tabs.length, rows = b.tabs.reduce(function (a, t) { return a + Math.max(0, t.cells.length - 1); }, 0); return '<article class="shcard"><h3>' + esc(b.title) + '</h3><p class="osm">' + (b.kind === 'user' ? 'Personal workbook' : 'Department workbook') + ' \u00B7 ' + n + ' sheet' + (n > 1 ? 's' : '') + ' \u00B7 ' + rows + ' rows</p><p class="osm">' + esc(b.tabs.map(function (t) { return t.name; }).join(', ')) + '</p><div class="rowbtns"><a class="btn sm" href="#/sheets/' + encodeURIComponent(b.id) + '">View sheet</a></div></article>'; };
    var mine = books.filter(function (b) { return b.id === 'user:' + me.code; }), dept = books.filter(function (b) { return b.kind === 'dept'; }), people = books.filter(function (b) { return b.kind === 'user' && b.id !== 'user:' + me.code; });
    return '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap"><div><h1 class="page-title">Sheets</h1><p class="page-sub">Your data in spreadsheets, inside the portal. New orders and payments are saved here automatically.</p></div><div class="rowbtns"><button class="btn" type="button" data-sh="linknew">+ Link a Google Sheet</button>' + (me.role === 'admin' ? '<button class="btn ghost" type="button" data-sh="gconn">Connect Google</button>' : '') + '</div></div>' +
      gnag() + gcard() + '<h2 class="shh">My sheets</h2><div class="shgrid">' + mine.map(card).join('') + '</div>' + '<h2 class="shh">' + (me.role === 'admin' ? 'Departments' : 'My department') + '</h2><div class="shgrid">' + dept.map(card).join('') + '</div>' + (people.length ? '<h2 class="shh">Employees\u2019 sheets</h2><div class="shgrid">' + people.map(card).join('') + '</div>' : '') +
      '<h2 class="shh">Linked Google Sheets</h2>' + (links.length ? '<div class="shgrid">' + links.map(function (l) { return '<article class="shcard"><h3>' + esc(l.title) + '</h3><p class="osm">Google Sheet \u00B7 shared with ' + (l.scope === 'all' ? 'everyone' : l.scope === 'dept' ? esc(DEPT[l.dept] || l.dept) : 'only ' + esc(l.by)) + '</p><div class="rowbtns"><a class="btn sm" href="#/sheets/link/' + encodeURIComponent(l.id) + '">View sheet</a>' + (l.by === me.code || me.role === 'admin' ? '<button class="btn ghost sm" type="button" data-sh="linkdel" data-id="' + esc(l.id) + '">Remove</button>' : '') + '</div></article>'; }).join('') + '</div>' : '<p class="osm">No Google Sheets linked yet. Use <b>+ Link a Google Sheet</b> to show one here, inside the portal.</p>') +
      (me.role === 'admin' ? '<p class="osm" style="margin-top:14px">Google connection: ' + (c.url ? '<b>connected</b> \u00B7 ' + q + ' row(s) waiting to be sent' + (c.err ? ' \u00B7 last error: ' + esc(c.err) : '') : 'not connected (sheets are saved in the portal only)') + '</p>' : '');
  }

  function gnag() {
    var c = cfg(), dp = deptOf(me); if (!(c.url && !glink(dp))) return '';
    return '<div class="shnag" role="alert"><b>Please link your department\u2019s Google Sheet.</b> ' + esc(DEPT[dp] || dp) + ' has not linked one yet, so its data is not being copied to Google. Once linked, every order, payment and update for your department is written there automatically and stays safe even if this portal\u2019s server is down. <button class="btn sm" type="button" data-sh="dlink" data-d="' + esc(dp) + '">Link now</button></div>';
  }
  function gcard() {
    var c = cfg(), dp = deptOf(me), last = c.last ? new Date(c.last).toLocaleString('en-IN') : (lastOkAt ? new Date(lastOkAt).toLocaleString('en-IN') : ''), q = SV() ? (c.srvQueued || 0) : jget(qk(), []).length;
    function row(d) { var g = glink(d), mine = me.role === 'admin' || d === dp; return '<tr><td><b>' + esc(DEPT[d] || d) + '</b></td><td>' + (g ? '<span class="tag live">Linked</span> <a href="' + esc(g.url) + '" target="_blank" rel="noopener">open in Google</a><br><span class="osm">by ' + esc(g.by) + ', ' + new Date(g.at).toLocaleDateString('en-IN') + '</span>' : '<span class="tag sch">Not linked</span>') + '</td><td class="r">' + (mine ? '<div class="rowbtns" style="justify-content:flex-end"><button class="btn sm" type="button" data-sh="dlink" data-d="' + d + '">' + (g ? 'Change link' : 'Link a Google Sheet') + '</button>' + (g ? '<button class="btn ghost sm" type="button" data-sh="dtest" data-d="' + d + '">Send test row</button><button class="btn ghost sm" type="button" data-sh="dunlink" data-d="' + d + '">Unlink</button>' : '') + '</div>' : '') + '</td></tr>'; }
    var depts = me.role === 'admin' ? Object.keys(DEPT) : [dp];
    return '<h2 class="shh">Google backup' + (me.role === 'admin' ? ' by department' : ' for ' + esc(DEPT[dp] || dp)) + '</h2><section class="card panel"><p class="osm">' + (c.url ? 'Google is connected' + (c.owner ? ' (share each sheet with <b>' + esc(c.owner) + '</b> as Editor)' : '') + '. Last sent: ' + (last || 'nothing yet') + (q ? ' \u00B7 ' + q + ' row(s) waiting to be sent' : '') + '. ' + (SV() ? 'The portal\u2019s server keeps these sheets up to date by itself, even when nobody has the portal open.' : 'Updates are sent automatically every minute.') + ' <button class="btn ghost sm" type="button" data-sh="syncnow">Sync now</button>' + (c.err ? '<div role="alert" style="margin-top:8px;padding:10px 12px;border-radius:10px;background:#fdecec;color:#8a1c1c;font-weight:600">Problem: ' + esc(c.err) + '</div>' : (SV() && last ? '<div style="margin-top:6px;color:#0a6b3a;font-weight:600">\u2713 Working: the last update was accepted by Google.</div>' : '')) : (me.role === 'admin' ? 'Google is not connected yet. Press <b>Connect Google</b> above first (one time), then every department links its own sheet here.' : 'Google is not connected yet. The Host connects it once; after that you can link your department\u2019s sheet here.')) + '</p>' + TBL0(['Department', 'Google Sheet', ''], depts.map(row).join('')) + '<p class="osm" style="margin-top:8px">If the portal\u2019s server is ever down or lost, everything already sent is safe in these Google Sheets. While Google cannot be reached, new rows wait in the browser and are sent when it is back.</p></section>';
  }
  function TBL0(h, rows) { return '<div class="tblwrap"><table class="tbl"><thead><tr>' + h.map(function (x) { return '<th>' + x + '</th>'; }).join('') + '</tr></thead><tbody>' + rows + '</tbody></table></div>'; }
  function dlinkModal(d) {
    var g = glink(d), c = cfg(); return '<div class="overlay" role="dialog" aria-modal="true"><div class="modal"><h2>Link the ' + esc(DEPT[d] || d) + ' Google Sheet</h2><p class="osm">1) Create a Google Sheet (or use yours). 2) Press <b>Share</b> and give <b>Editor</b> access to ' + (c.owner ? '<b>' + esc(c.owner) + '</b>' : 'the Google account that owns the S-ELEVEN script (the Host knows it)') + '. 3) Paste the sheet\u2019s link here. Tabs for Orders, Payments and more are created in it automatically and kept up to date.</p><div class="field"><label for="dl-u">Google Sheets link</label><input id="dl-u" value="' + esc(g ? g.url : '') + '" placeholder="https://docs.google.com/spreadsheets/d/..." autocomplete="off"></div><p class="err" id="dl-e" role="alert"></p><div class="rowbtns"><button class="btn" type="button" data-sh="dlinksave" data-d="' + esc(d) + '">Save link</button><button class="btn ghost" type="button" data-sh="close">Cancel</button></div></div></div>';
  }
  function linkModal() {
    var d = me.dept || me.role; ST.modal = true; return '<div class="overlay" role="dialog" aria-modal="true"><div class="modal"><h2>Link a Google Sheet</h2><p class="osm">Open your Google Sheet, then <b>File > Share > Publish to web</b> and copy the link (best, view only), or paste the normal share link. The sheet is then shown here inside the portal.</p><div class="field"><label for="sl-t">Name</label><input id="sl-t" placeholder="e.g. Dealer price list"></div><div class="field"><label for="sl-u">Google Sheets link</label><input id="sl-u" placeholder="https://docs.google.com/spreadsheets/d/..."></div><div class="fgrid"><div class="field"><label for="sl-m">Show as</label><select id="sl-m"><option value="view">View only (published or shared)</option><option value="live">Live editor (needs Google sign-in)</option></select></div><div class="field"><label for="sl-s">Who can see it</label><select id="sl-s"><option value="me">Only me</option><option value="dept">My department (' + esc(DEPT[d] || d) + ')</option>' + (me.role === 'admin' ? '<option value="all">Everyone</option>' : '') + '</select></div></div><p class="err" id="sl-e" role="alert"></p><div class="rowbtns"><button class="btn" type="button" data-sh="linksave">Save</button><button class="btn ghost" type="button" data-sh="close">Cancel</button></div></div></div>';
  }
  function connModal() {
    var c = cfg(); return '<div class="overlay" role="dialog" aria-modal="true"><div class="modal"><h2>Connect Google Sheets</h2><p class="osm">Optional. Paste the web app address from the Google Apps Script included in <b>2-operations-platform-core/google-sheets</b> (setup takes about 5 minutes). Every automatic row is then also written to real Google Sheets: one file per department, one tab per sheet.</p><div class="field"><label for="gc-u">Web app URL</label><input id="gc-u" value="' + esc(SV() ? '' : (c.url || '')) + '" placeholder="' + (SV() && c.url ? 'Connected. The address and secret are saved on the server and hidden. Paste a new address only to change it.' : 'https://script.google.com/macros/s/.../exec') + '"></div><div class="field"><label for="gc-s">Secret (the same text you put in the script)</label><input id="gc-s" type="password" value="" placeholder="' + (SV() ? 'Hidden. Type a new secret only to change it' : '') + '" autocomplete="off"></div><div class="field"><label for="gc-o">Google account that owns the script (shown to departments so they can share their sheet with it)</label><input id="gc-o" type="email" value="' + esc(c.owner || '') + '" placeholder="accounts@yourcompany.com" autocomplete="off"></div><p class="osm" id="gc-m" role="status">' + (c.url ? 'Connected. Rows waiting: ' + jget(qk(), []).length : 'Not connected.') + '</p><div class="rowbtns"><button class="btn" type="button" data-sh="gsave">Save</button><button class="btn ghost" type="button" data-sh="gsendall">Send everything now</button><button class="btn ghost" type="button" data-sh="gtest">Send a test row</button><button class="btn ghost" type="button" data-sh="close">Close</button></div></div></div>';
  }
  function bookView(b, tabId) {
    var t = tabOf(b, tabId), ed = canEdit(me, b), tabs = b.tabs.map(function (x) { return '<a class="shtab' + (x.id === t.id ? ' on' : '') + '" href="#/sheets/' + encodeURIComponent(b.id) + '/' + x.id + '">' + esc(x.name) + (x.auto ? ' <i title="Filled automatically">\u26A1</i>' : '') + '</a>'; }).join('') + (ed ? '<button class="shtab add" type="button" data-sh="tabadd" title="Add a sheet">+</button>' : '');
    var tb = ed ? '<div class="shtool" role="toolbar" aria-label="Sheet tools"><button type="button" data-sh="undo" title="Undo (Ctrl+Z)">\u21B6</button><button type="button" data-sh="redo" title="Redo (Ctrl+Y)">\u21B7</button><span class="sep"></span><button type="button" data-sh="rowadd">+ Row</button><button type="button" data-sh="rowdel">\u2212 Row</button><button type="button" data-sh="coladd">+ Column</button><button type="button" data-sh="coldel">\u2212 Column</button><span class="sep"></span><button type="button" data-sh="sorta">Sort A\u2192Z</button><button type="button" data-sh="sortz">Sort Z\u2192A</button><button type="button" data-sh="fill">Fill down</button><button type="button" data-sh="bold"><b>B</b></button><select data-sh="fmt" aria-label="Number format"><option value="">Format</option><option value="gen">General</option><option value="num">Number</option><option value="inr">\u20B9 Rupees</option></select><span class="sep"></span><button type="button" data-sh="filter" title="Filter the rows by any column">Filter</button><button type="button" data-sh="csvout">Export CSV</button><button type="button" data-sh="csvin">Import CSV</button>' + (t.auto ? '' : '<button type="button" data-sh="tabren">Rename</button><button type="button" data-sh="tabdel">Delete sheet</button>') + '<input type="file" id="sh-file" accept=".csv,text/csv" hidden></div>' : '<div class="shtool"><span class="osm">View only</span><button type="button" data-sh="filter">Filter</button><button type="button" data-sh="csvout">Export CSV</button></div>';
    return '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap"><div><a class="btn ghost sm" href="#/sheets">\u2190 All sheets</a><h1 class="page-title" style="margin-top:8px">' + esc(b.title) + '</h1></div><div class="shfind"><input id="sh-find" placeholder="Find in this sheet" value="' + esc(ST.find) + '" aria-label="Find in this sheet"></div></div><div class="shtabs">' + tabs + '</div>' + tb +
      '<div class="rowbtns" style="margin:8px 0"><button class="btn ghost sm" type="button" data-sh="csvout">\u2B07 Download this sheet (CSV, opens in Excel)</button></div>' +
      '<div class="shbar"><span id="sh-name" class="shname"></span><span class="shfx">fx</span><input id="sh-fx" aria-label="Cell content or formula" ' + (ed ? '' : 'readonly') + ' placeholder="Select a cell, then type. Start a formula with ="></div><div class="shwrap" id="sh-wrap" tabindex="0" aria-label="Spreadsheet"></div><p class="osm" id="sh-stat" role="status" style="margin-top:6px"></p>' + (t.auto ? '<p class="osm">\u26A1 This sheet is filled in automatically from orders and payments. The first ' + HEAD[t.auto].length + ' columns update by themselves; add your own columns to the right and use formulas freely.</p>' : '');
  }
  function snap(t) { var k = t.id; (ST.undo[k] = ST.undo[k] || []).push(JSON.stringify({ c: t.cells, f: t.fmt, b: t.bold })); if (ST.undo[k].length > 60) ST.undo[k].shift(); ST.redo[k] = []; }
  function restore(t, s) { var o = JSON.parse(s); t.cells = o.c; t.fmt = o.f; t.bold = o.b; }
  function selBox() { var s = ST.sel; return { r1: Math.min(s.r, s.r2), r2: Math.max(s.r, s.r2), c1: Math.min(s.c, s.c2), c2: Math.max(s.c, s.c2) }; }
  function passF(v, text) { text = String(text || '').trim(); if (!text) return true; var x = isErr(v) ? v.e : (v == null ? '' : v), m = /^(<>|<=|>=|=|<|>)\s*(.*)$/.exec(text); if (m) return matchCrit(x, m[1] + m[2]); return String(x).toLowerCase().indexOf(text.toLowerCase()) > -1; }
  function drawGrid() {
    ST.flt = ST.flt || {}; ST.fltOn = ST.fltOn || {};
    var b = curBook, t = curTab, w = root.querySelector('#sh-wrap'); if (!w) return; var val = evaluator(t), sb = selBox(), ncol = 0; t.cells.forEach(function (r) { ncol = Math.max(ncol, r.length); }); if (t.auto) ncol = Math.max(ncol, HEAD[t.auto].length + 2);   /* two free columns beside the automatic ones, for your own notes and formulas */
    t.cells.forEach(function (r) { while (r.length < ncol) r.push(''); });
    var fl = ST.flt[t.id] || {}, fon = !!ST.fltOn[t.id], q = ST.find.trim().toLowerCase(), h = '<table class="shgridt"><thead><tr><th class="shc0"></th>'; for (var c = 0; c < ncol; c++) h += '<th data-hc="' + c + '" style="min-width:' + (t.widths[c] || (c === 0 ? 120 : 110)) + 'px">' + colName(c) + '</th>'; var frow = '', dls = ''; if (fon) { frow = '<tr class="shfrow"><th class="shr"><button type="button" class="shclr" data-sh="fclear" title="Clear all filters" aria-label="Clear all filters">\u2715</button></th>'; for (var fc = 0; fc < ncol; fc++) { var seenv = {}, vals = []; for (var rr = (t.auto ? 1 : 0); rr < t.cells.length && vals.length < 40; rr++) { var vv = fmtVal(val(rr, fc), t.fmt[fc]); if (vv !== '' && !seenv[vv]) { seenv[vv] = 1; vals.push(vv); } } vals.sort(); frow += '<th><input class="shflt" data-fc="' + fc + '" list="shl' + fc + '" value="' + esc(fl[fc] || '') + '" placeholder="Filter" aria-label="Filter column ' + colName(fc) + '" autocomplete="off"></th>'; dls += '<datalist id="shl' + fc + '">' + vals.map(function (z) { return '<option value="' + esc(z) + '">'; }).join('') + '</datalist>'; } frow += '</tr>'; }
    h += '</tr>' + frow + '</thead><tbody>';
    for (var r = 0; r < t.cells.length; r++) {
      if (q && (t.auto ? r > 0 : true)) { var hit = t.cells[r].some(function (x) { return String(x).toLowerCase().indexOf(q) > -1; }); if (!hit) continue; }
      if (Object.keys(fl).length && !(t.auto && r === 0)) { var okf = true; Object.keys(fl).forEach(function (k) { if (!passF(val(r, +k), fl[k])) okf = false; }); if (!okf) continue; }
      h += '<tr><th class="shr" data-hr="' + r + '">' + (r + 1) + '</th>';
      for (c = 0; c < ncol; c++) { var v = val(r, c), on = r >= sb.r1 && r <= sb.r2 && c >= sb.c1 && c <= sb.c2, head = t.auto && r === 0, lock = t.auto && c < HEAD[t.auto].length && r > 0, cls = 'shcell' + (on ? ' on' : '') + (r === ST.sel.r && c === ST.sel.c ? ' cur' : '') + (head ? ' head' : '') + (lock ? ' lock' : '') + (typeof v === 'number' ? ' n' : '') + (isErr(v) ? ' er' : '') + (t.bold[r + ',' + c] || head ? ' b' : ''); h += '<td class="' + cls + '" data-r="' + r + '" data-c="' + c + '">' + esc(r === 0 && t.auto ? v : fmtVal(v, t.fmt[c])) + '</td>'; }
      h += '</tr>';
    }
    w.innerHTML = h + '</tbody></table>' + dls; var cell = (t.cells[ST.sel.r] || [])[ST.sel.c]; var nm = root.querySelector('#sh-name'), fx = root.querySelector('#sh-fx'); if (nm) nm.textContent = sb.r1 === sb.r2 && sb.c1 === sb.c2 ? colName(ST.sel.c) + (ST.sel.r + 1) : colName(sb.c1) + (sb.r1 + 1) + ':' + colName(sb.c2) + (sb.r2 + 1); if (fx && !ST.editing) fx.value = cell == null ? '' : cell;
    var ns = [], cnt = 0; for (r = sb.r1; r <= sb.r2; r++) for (c = sb.c1; c <= sb.c2; c++) { var x = val(r, c); if (typeof x === 'number') ns.push(x); if (x !== '' && x != null) cnt++; } var st = root.querySelector('#sh-stat'); if (st) st.textContent = (sb.r1 === sb.r2 && sb.c1 === sb.c2) ? 'Click a cell to select it. Double-click or just type to edit.' : 'Selected: ' + cnt + ' filled' + (ns.length ? ' \u00B7 Sum ' + fmtVal(ns.reduce(function (a, y) { return a + y; }, 0)) + ' \u00B7 Average ' + fmtVal(ns.reduce(function (a, y) { return a + y; }, 0) / ns.length) + ' \u00B7 Min ' + Math.min.apply(null, ns) + ' \u00B7 Max ' + Math.max.apply(null, ns) : '');
  }
  function commit(r, c, v) { var t = curTab; if (!canEdit(me, curBook)) return false; if (t.auto && (r === 0 || c < HEAD[t.auto].length)) { return false; } snap(t); while (t.cells.length <= r) t.cells.push([]); while (t.cells[r].length <= c) t.cells[r].push(''); t.cells[r][c] = v; save(); return true; }
  function startEdit(r, c, initial) {
    var t = curTab, td = root.querySelector('td[data-r="' + r + '"][data-c="' + c + '"]'); if (!td || !canEdit(me, curBook)) return; if (t.auto && (r === 0 || c < HEAD[t.auto].length)) { toast2('This column is filled in automatically. Add your own columns to the right.'); return; }
    ST.editing = true; var cur = (t.cells[r] || [])[c], inp = document.createElement('input'); inp.className = 'shedit'; inp.value = initial != null ? initial : (cur == null ? '' : cur); td.textContent = ''; td.appendChild(inp); inp.focus(); if (initial == null) inp.select();
    var done = function (mv) { if (!ST.editing) return; ST.editing = false; ST.pend = null; var v = inp.value; if (mv !== 'esc') commit(r, c, v); if (mv === 'down') ST.sel = { r: r + 1, c: c, r2: r + 1, c2: c }; else if (mv === 'right') ST.sel = { r: r, c: c + 1, r2: r, c2: c + 1 }; drawGrid(); var w = root.querySelector('#sh-wrap'); if (w) w.focus(); };
    inp.addEventListener('input', function () { ST.pend = { r: r, c: c, v: inp.value }; }); inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); done('down'); } else if (e.key === 'Tab') { e.preventDefault(); done('right'); } else if (e.key === 'Escape') { e.preventDefault(); done('esc'); } e.stopPropagation(); }); inp.addEventListener('blur', function () { setTimeout(function () { if (inp.isConnected) done('stay'); }, 0); });   /* if the page was re-drawn, the input is gone and mount() restores the half-typed text */
  }
  function toast2(m) { var t = document.getElementById('toast') || document.querySelector('.toast'); if (typeof window.toast === 'function') { try { window.toast(m); return; } catch (e) {} } var n = document.createElement('div'); n.className = 'shtoast'; n.textContent = m; document.body.appendChild(n); setTimeout(function () { n.remove(); }, 2600); }
  function tsv(sb, val) { var o = []; for (var r = sb.r1; r <= sb.r2; r++) { var row = []; for (var c = sb.c1; c <= sb.c2; c++) { var x = val(r, c); row.push(isErr(x) ? x.e : String(x == null ? '' : x)); } o.push(row.join('\t')); } return o.join('\n'); }
  /* text that starts with = + @ (or - and is not a number) would be run as a formula by Google Sheets or Excel: store it as text */
  function safeCell(v) { if (typeof v !== 'string') return v; return (/^[=+@\t\r]/.test(v) || (/^-/.test(v) && isNaN(Number(v)))) ? "'" + v : v; }
  function csvEsc(s) { s = String(s == null ? '' : s); s = safeCell(s); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
  function parseCsv(text) { var rows = [], row = [], f = '', q = false, i = 0; for (; i < text.length; i++) { var ch = text[i]; if (q) { if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; } else if (ch === '"') q = true; else if (ch === ',') { row.push(f); f = ''; } else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; } else f += ch; } if (f !== '' || row.length) { row.push(f); rows.push(row); } return rows; }
  function dl(name, text, type) { var a = document.createElement('a'), u = URL.createObjectURL(new Blob([text], { type: type || 'text/csv' })); a.href = u; a.download = name; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(u); a.remove(); }, 800); }
  function shift(dim, at, delta) { /* insert/delete a row or column */ var t = curTab; snap(t); if (dim === 'r') { if (delta > 0) { var row = []; for (var c = 0; c < t.cells[0].length; c++) row.push(''); t.cells.splice(at, 0, row); } else t.cells.splice(at, 1); } else { t.cells.forEach(function (r) { if (delta > 0) r.splice(at, 0, ''); else r.splice(at, 1); }); } save(); }
  function act(a, el) {
    var t = curTab, ed = canEdit(me, curBook), sb = selBox(), val = evaluator(t); if (!ed && ['csvout'].indexOf(a) < 0) return;
    if (a === 'undo') { var u = ST.undo[t.id] || []; if (u.length) { (ST.redo[t.id] = ST.redo[t.id] || []).push(JSON.stringify({ c: t.cells, f: t.fmt, b: t.bold })); restore(t, u.pop()); save(); } }
    else if (a === 'redo') { var rd = ST.redo[t.id] || []; if (rd.length) { (ST.undo[t.id] = ST.undo[t.id] || []).push(JSON.stringify({ c: t.cells, f: t.fmt, b: t.bold })); restore(t, rd.pop()); save(); } }
    else if (a === 'rowadd') shift('r', sb.r2 + 1, 1); else if (a === 'coladd') shift('c', sb.c2 + 1, 1);
    else if (a === 'rowdel') { if (t.auto) { toast2('Rows of automatic sheets are managed by the portal.'); return; } if (sb.r1 === 0 && t.cells.length < 2) return; shift('r', sb.r1, -1); ST.sel.r = ST.sel.r2 = Math.max(0, sb.r1 - (sb.r1 >= t.cells.length ? 1 : 0)); }
    else if (a === 'coldel') { if (t.auto && sb.c1 < HEAD[t.auto].length) { toast2('Automatic columns cannot be deleted.'); return; } shift('c', sb.c1, -1); }
    else if (a === 'sorta' || a === 'sortz') {   /* select several rows to sort just those; otherwise the whole sheet (an automatic sheet keeps its header row). Empty cells always go last. */
      snap(t); var c0 = sb.c1, from = sb.r1 !== sb.r2 ? sb.r1 : (t.auto ? 1 : 0), to = sb.r1 !== sb.r2 ? sb.r2 : t.cells.length - 1, seg = t.cells.slice(from, to + 1), dir = a === 'sorta' ? 1 : -1;
      seg.sort(function (x, y) { var p = x[c0], q = y[c0], bp = p === '' || p == null, bq = q === '' || q == null; if (bp && bq) return 0; if (bp) return 1; if (bq) return -1; var o = isNumStr(p) && isNumStr(q) ? Number(p) - Number(q) : (String(p).toLowerCase() < String(q).toLowerCase() ? -1 : String(p).toLowerCase() > String(q).toLowerCase() ? 1 : 0); return o * dir; });
      t.cells = t.cells.slice(0, from).concat(seg, t.cells.slice(to + 1)); save(); }
    else if (a === 'fill') { snap(t); for (var c = sb.c1; c <= sb.c2; c++) { var src = (t.cells[sb.r1] || [])[c]; for (var r = sb.r1 + 1; r <= sb.r2; r++) { if (t.auto && c < HEAD[t.auto].length) continue; while (t.cells[r].length <= c) t.cells[r].push(''); var s = String(src == null ? '' : src); t.cells[r][c] = s.charAt(0) === '=' ? s.replace(/([A-Z]+)(\d+)/g, function (m0, cc, rr) { return cc + (parseInt(rr, 10) + (r - sb.r1)); }) : s; } } save(); }
    else if (a === 'bold') { snap(t); var on = !t.bold[sb.r1 + ',' + sb.c1]; for (r = sb.r1; r <= sb.r2; r++) for (c = sb.c1; c <= sb.c2; c++) { if (on) t.bold[r + ',' + c] = 1; else delete t.bold[r + ',' + c]; } save(); }
    else if (a === 'fmt') { var f = el.value; if (!f) return; snap(t); for (c = sb.c1; c <= sb.c2; c++) { if (f === 'gen') delete t.fmt[c]; else t.fmt[c] = f; } save(); el.value = ''; }
    else if (a === 'csvout') { var out = t.cells.map(function (row, i) { return row.map(function (x, j) { var v = val(i, j); return csvEsc(isErr(v) ? v.e : (v == null ? '' : v)); }).join(','); }).join('\r\n'); dl((curBook.title + ' - ' + t.name).replace(/[^A-Za-z0-9 _-]/g, '') + '.csv', '\uFEFF' + out); return; }
    else if (a === 'csvin') { root.querySelector('#sh-file').click(); return; }
    else if (a === 'tabadd') { var nm = window.prompt('Name of the new sheet:', 'Sheet' + (curBook.tabs.length)); if (!nm) return; var nt = newTab(nm.trim().slice(0, 30), null); curBook.tabs.push(nt); save(); location.hash = '#/sheets/' + encodeURIComponent(curBook.id) + '/' + nt.id; return; }
    else if (a === 'tabren') { var rn = window.prompt('Rename this sheet:', t.name); if (!rn) return; t.name = rn.trim().slice(0, 30); save(); }
    else if (a === 'tabdel') { if (curBook.tabs.length < 2) return; if (!window.confirm('Delete the sheet "' + t.name + '" and everything in it?')) return; curBook.tabs = curBook.tabs.filter(function (x) { return x.id !== t.id; }); save(); location.hash = '#/sheets/' + encodeURIComponent(curBook.id); return; }
    mount(root, me);
  }
  function mount(el, user) {
    root = el; me = user; var wasEditing = ST.editing && ST.pend, pend = ST.pend; ST.editing = false; ST.pend = null; try { hook(); if (!ST.lastSync || Date.now() - ST.lastSync > 30000 || !route().book) { syncOrders(); ST.lastSync = Date.now(); } } catch (e) {} var rt = route(), h = '';
    if (rt.book === 'link') { var l = load().links.filter(function (x) { return x.id === rt.tab; })[0]; if (!l) { root.innerHTML = home(); return; } var src = linkEmbed(l); root.innerHTML = '<a class="btn ghost sm" href="#/sheets">\u2190 All sheets</a><h1 class="page-title" style="margin-top:8px">' + esc(l.title) + '</h1><p class="osm">Google Sheet shown inside the portal. If it stays blank, the sheet is private: publish it (File > Share > Publish to web) or share it with \u201CAnyone with the link\u201D, then link it again.</p>' + (src ? '<iframe class="shframe" title="' + esc(l.title) + '" src="' + esc(src) + '" referrerpolicy="no-referrer" loading="lazy"></iframe>' : '<p class="err">This link is not a Google Sheets address.</p>'); return; }
    if (!rt.book) { root.innerHTML = home(); return; }
    var b = bookById(rt.book); if (!b || !canOpen(me, b)) { root.innerHTML = home(); return; } curBook = b; curTab = tabOf(b, rt.tab); if (!ST.sel || ST.last !== curTab.id) { ST.sel = { r: curTab.auto ? 1 : 0, c: 0, r2: curTab.auto ? 1 : 0, c2: 0 }; ST.last = curTab.id; }
    root.innerHTML = bookView(b, curTab.id); drawGrid(); if (wasEditing && pend) startEdit(pend.r, pend.c, pend.v);   /* a re-render of the page must not lose a half-typed cell */
  }
  function onClick(e) {
    if (!root || !root.contains(e.target) && !e.target.closest('.overlay')) return; var el = e.target.closest('[data-sh]'), td = e.target.closest('td.shcell');
    if (td && root.contains(td)) { var r = +td.getAttribute('data-r'), c = +td.getAttribute('data-c'); if (ST.editing) return; if (e.shiftKey) { ST.sel.r2 = r; ST.sel.c2 = c; } else ST.sel = { r: r, c: c, r2: r, c2: c }; drawGrid(); return; }
    var hr = e.target.closest('th.shr'); if (hr && root.contains(hr) && !e.target.closest('[data-sh]')) { var rr = +hr.getAttribute('data-hr'); ST.sel = { r: rr, c: 0, r2: rr, c2: Math.max(0, curTab.cells[0].length - 1) }; drawGrid(); return; }
    var hc = e.target.closest('th[data-hc]'); if (hc && root.contains(hc)) { var cc = +hc.getAttribute('data-hc'); ST.sel = { r: curTab.auto ? 1 : 0, c: cc, r2: curTab.cells.length - 1, c2: cc }; drawGrid(); return; }
    if (!el) return; var a = el.getAttribute('data-sh');
    if (a === 'fmt') return;
    if (a === 'linknew') { document.body.insertAdjacentHTML('beforeend', linkModal()); }
    else if (a === 'gconn') { document.body.insertAdjacentHTML('beforeend', connModal()); }
    else if (a === 'close') { document.querySelectorAll('.overlay').forEach(function (n) { n.remove(); }); }
    else if (a === 'linksave') {
      var t = document.getElementById('sl-t').value.trim(), u = document.getElementById('sl-u').value.trim(), er = document.getElementById('sl-e'); if (t.length < 2) { er.textContent = 'Enter a name.'; return; } if (!/^https:\/\/docs\.google\.com\/spreadsheets\/d\//.test(u)) { er.textContent = 'Paste a Google Sheets link. It starts with https://docs.google.com/spreadsheets/d/'; return; }
      var sc = document.getElementById('sl-s').value, S = load(); S.links.push({ id: uid('l'), title: t.slice(0, 60), url: u, mode: document.getElementById('sl-m').value, scope: sc === 'me' ? 'me' : sc, dept: me.dept || me.role, by: me.code, at: Date.now() }); save(); document.querySelectorAll('.overlay').forEach(function (n) { n.remove(); }); mount(root, me);
    }
    else if (a === 'linkdel') { if (!window.confirm('Remove this link? The Google Sheet itself is not touched.')) return; var S2 = load(); S2.links = S2.links.filter(function (x) { return x.id !== el.getAttribute('data-id'); }); save(); mount(root, me); }
    else if (a === 'gsave') { var s = Object.assign({}, cfg(), { url: document.getElementById('gc-u').value.trim(), secret: document.getElementById('gc-s').value.trim(), owner: (document.getElementById('gc-o') || {}).value ? document.getElementById('gc-o').value.trim() : '' }); var m = document.getElementById('gc-m'); if (s.url && !/^https:\/\/script\.google\.com\/macros\/s\/[^ ]+\/exec$/.test(s.url)) { m.textContent = 'The address should look like https://script.google.com/macros/s/.../exec'; return; } if (SV()) { var body = { owner: s.owner }; if (s.url && s.url !== '(connected)') body.url = s.url; if (s.secret) body.secret = s.secret; var rr = window.SelServer.xhr('PUT', '/api/sheets/config', body); scfg = null; if (rr.status !== 200) { m.textContent = (rr.json && rr.json.error) || 'Could not save.'; return; } } else jset(CFGK, s); m.textContent = s.url ? 'Saved. New rows are sent to Google automatically.' : 'Disconnected.'; if (s.url) flush(); }
    else if (a === 'gsendall') { var n = sendAll(); document.getElementById('gc-m').textContent = n + ' row(s) queued to send to Google.'; }
    else if (a === 'syncnow') { if (SV()) { toast2('Updating the Google sheets now...'); var rs = window.SelServer.xhr('POST', '/api/sheets/sync', {}); scfg = null; toast2(rs.status === 200 ? ((rs.json && rs.json.status && rs.json.status.lastError) ? 'Google reported a problem: ' + rs.json.status.lastError : 'The Google sheets are up to date.') : 'Could not update the Google sheets.'); if (window.location && root) { try { mount(root, me); } catch (e) {} } } else { try { syncOrders(); sendAll(); } catch (e) {} toast2('Sending the latest rows to Google now.'); } }
    else if (a === 'gtest') { pendingOut = [{ book: 'Company (Host) sheets', tab: 'Test', key: 'TEST-' + Date.now(), headers: ['Key', 'Message', 'Time'], row: ['TEST-' + Date.now(), 'Hello from S-ELEVEN portal', fdt(new Date().toISOString())] }]; queueOut(); document.getElementById('gc-m').textContent = 'Test row queued. Check the "Company (Host) sheets" file in Google Drive in a few seconds.'; }
    else if (a === 'dlink') { var dd = el.getAttribute('data-d'); if (me.role !== 'admin' && dd !== deptOf(me)) return; document.querySelectorAll('.overlay').forEach(function (n) { n.remove(); }); document.body.insertAdjacentHTML('beforeend', dlinkModal(dd)); }
    else if (a === 'dlinksave') { var dd2 = el.getAttribute('data-d'); if (me.role !== 'admin' && dd2 !== deptOf(me)) return; var rr = setGlink(dd2, document.getElementById('dl-u').value, me.code); if (rr.error) { document.getElementById('dl-e').textContent = rr.error; return; } document.querySelectorAll('.overlay').forEach(function (n) { n.remove(); }); pendingOut = []; var S3 = load(); Object.keys(S3.books).forEach(function (id) { var bk = S3.books[id]; if (bk.kind === 'dept' && bk.owner === dd2) bk.tabs.forEach(function (t) { if (!t.auto || t.auto === 'activity') return; for (var r = 1; r < t.cells.length; r++) pendingOut.push(item(bk, t, String(t.cells[r][0]), t.cells[0].slice(0, HEAD[t.auto].length), t.cells[r].slice(0, HEAD[t.auto].length))); }); }); queueOut(); mount(root, me); toast2('Linked. Existing data is being copied to your Google Sheet.'); }
    else if (a === 'dunlink') { var dd3 = el.getAttribute('data-d'); if (me.role !== 'admin' && dd3 !== deptOf(me)) return; if (!window.confirm('Unlink the Google Sheet? Data already in it stays there; new data stops being copied.')) return; delGlink(dd3); mount(root, me); }
    else if (a === 'dtest') { var dd4 = el.getAttribute('data-d'), g4 = glink(dd4); if (!g4) return; var bk4 = ensureBook('dept', dd4); pendingOut = [{ book: bk4.title, dept: dd4, target: g4.id, tab: 'Connection test', key: 'TEST-' + Date.now(), headers: ['Key', 'Message', 'Time'], row: ['TEST-' + Date.now(), 'Hello from the S-ELEVEN portal: this sheet is linked', fdt(new Date().toISOString())] }]; queueOut(); toast2('Test row sent. Open your Google Sheet: a tab "Connection test" appears.'); }
    else if (a === 'filter') { ST.fltOn[curTab.id] = !ST.fltOn[curTab.id]; drawGrid(); var fi = root.querySelector('.shflt'); if (fi) fi.focus(); return; }
    else if (a === 'fclear') { ST.flt[curTab.id] = {}; drawGrid(); return; }
    else if (curTab) act(a, e.target.closest('[data-sh]'));
  }
  function onKey(e) {
    if (!root || !curTab || !root.querySelector('#sh-wrap') || ST.editing) return; var tg = e.target; if (tg && tg.classList && tg.classList.contains('shflt')) return;   /* typing in a filter box is just typing */
    if (tg && (tg.id === 'sh-fx' || tg.id === 'sh-find')) { if (tg.id === 'sh-fx' && e.key === 'Enter') { e.preventDefault(); if (commit(ST.sel.r, ST.sel.c, tg.value)) { drawGrid(); } return; } return; }
    if (!(root.querySelector('#sh-wrap').contains(tg) || tg === document.body)) return; var t = curTab, s = ST.sel, mx = t.cells.length - 1, my = (t.cells[0] || []).length - 1, sbox = selBox(), val = evaluator(t), mv = function (dr, dc) { var r = Math.max(0, Math.min(mx + 1, s.r + dr)), c = Math.max(0, Math.min(my + 1, s.c + dc)); if (e.shiftKey) { s.r2 = r; s.c2 = c; s.r = s.r; } else ST.sel = { r: r, c: c, r2: r, c2: c }; drawGrid(); e.preventDefault(); };
    if (e.key === 'ArrowDown') mv(1, 0); else if (e.key === 'ArrowUp') mv(-1, 0); else if (e.key === 'ArrowLeft') mv(0, -1); else if (e.key === 'ArrowRight') mv(0, 1); else if (e.key === 'Tab') mv(0, e.shiftKey ? -1 : 1); else if (e.key === 'Enter') { e.preventDefault(); startEdit(s.r, s.c, null); }
    else if (e.key === 'F2') { e.preventDefault(); startEdit(s.r, s.c, null); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { if (!canEdit(me, curBook)) return; e.preventDefault(); snap(t); for (var r = sbox.r1; r <= sbox.r2; r++) for (var c = sbox.c1; c <= sbox.c2; c++) { if (t.auto && (r === 0 || c < HEAD[t.auto].length)) continue; if (t.cells[r]) t.cells[r][c] = ''; } save(); drawGrid(); }
    else if ((e.ctrlKey || e.metaKey) && /^[zZ]$/.test(e.key)) { e.preventDefault(); act(e.shiftKey ? 'redo' : 'undo'); } else if ((e.ctrlKey || e.metaKey) && /^[yY]$/.test(e.key)) { e.preventDefault(); act('redo'); } else if ((e.ctrlKey || e.metaKey) && /^[dD]$/.test(e.key)) { e.preventDefault(); act('fill'); }
    else if ((e.ctrlKey || e.metaKey) && /^[cC]$/.test(e.key)) { var txt = tsv(sbox, val); ST.clip = txt; if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).catch(function () {}); e.preventDefault(); }
    else if ((e.ctrlKey || e.metaKey) && /^[xX]$/.test(e.key)) { ST.clip = tsv(sbox, val); if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(ST.clip).catch(function () {}); e.preventDefault(); if (canEdit(me, curBook)) { snap(t); for (r = sbox.r1; r <= sbox.r2; r++) for (c = sbox.c1; c <= sbox.c2; c++) { if (!(t.auto && (r === 0 || c < HEAD[t.auto].length)) && t.cells[r]) t.cells[r][c] = ''; } save(); drawGrid(); } }
    else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) { if (canEdit(me, curBook)) { e.preventDefault(); startEdit(s.r, s.c, e.key); } }
  }
  function onPaste(e) { if (!root || !curTab || ST.editing || !canEdit(me, curBook) || !root.querySelector('#sh-wrap')) return; var tg = e.target; if (tg && (tg.id === 'sh-fx' || tg.id === 'sh-find' || tg.tagName === 'INPUT')) return; var text = (e.clipboardData && e.clipboardData.getData('text')) || ST.clip || ''; if (!text) return; e.preventDefault(); var t = curTab, rows = text.replace(/\r/g, '').replace(/\n$/, '').split('\n').map(function (x) { return x.split('\t'); }); snap(t); rows.forEach(function (row, i) { row.forEach(function (v, j) { var r = ST.sel.r + i, c = ST.sel.c + j; if (t.auto && (r === 0 || c < HEAD[t.auto].length)) return; while (t.cells.length <= r) t.cells.push([]); while (t.cells[r].length <= c) t.cells[r].push(''); t.cells[r][c] = v; }); }); save(); drawGrid(); }
  function onDbl(e) { var td = e.target.closest('td.shcell'); if (td && root && root.contains(td)) startEdit(+td.getAttribute('data-r'), +td.getAttribute('data-c'), null); }
  function onInput(e) {
    if (e.target && e.target.id === 'sh-find') { ST.find = e.target.value; drawGrid(); return; }
    if (e.target && e.target.classList && e.target.classList.contains('shflt') && curTab) { var c = e.target.getAttribute('data-fc'), id = curTab.id, pos = e.target.selectionStart; ST.flt[id] = ST.flt[id] || {}; if (e.target.value.trim()) ST.flt[id][c] = e.target.value; else delete ST.flt[id][c]; clearTimeout(ST.ft); ST.ft = setTimeout(function () { drawGrid(); var n = root.querySelector('.shflt[data-fc="' + c + '"]'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (x) {} } }, 120); }
  }
  function onChange(e) { var t = e.target; if (!root || !root.contains(t)) return; if (t.id === 'sh-file' && t.files && t.files[0]) { var rd = new FileReader(); rd.onload = function () { var rows = parseCsv(String(rd.result).replace(/^\uFEFF/, '')); if (!rows.length) return; var nt = newTab((t.files[0].name || 'Imported').replace(/\.csv$/i, '').slice(0, 30), null); nt.cells = rows; curBook.tabs.push(nt); save(); location.hash = '#/sheets/' + encodeURIComponent(curBook.id) + '/' + nt.id; }; rd.readAsText(t.files[0]); } else if (t.getAttribute && t.getAttribute('data-sh') === 'fmt') act('fmt', t); }
  document.addEventListener('click', onClick); document.addEventListener('dblclick', onDbl); document.addEventListener('keydown', onKey); document.addEventListener('paste', onPaste); document.addEventListener('input', onInput); document.addEventListener('change', onChange);
  document.addEventListener('input', function (e) { if (e.target && e.target.id === 'sh-fx' && root && root.contains(e.target)) ST.fxDirty = true; });
  window.Sheets = { autoSync: autoSync, needsLink: needsLink, glink: glink, setGlink: setGlink, sheetId: sheetId, mount: mount, syncOrders: syncOrders, log: logActivity, flush: flush, evaluator: evaluator, tokenize: tokenize, load: load, ensureBook: ensureBook, visibleBooks: visibleBooks, canEdit: canEdit, linkEmbed: linkEmbed, sendAll: sendAll, HEAD: HEAD, colName: colName, parseCsv: parseCsv, _state: ST };
})();
