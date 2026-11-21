/* "Eleven" for employees: a voice + chat assistant inside the admin console. It understands what you ask for your role, answers from live data and takes you to the right screen.
   Voice uses the browser (Chrome/Edge/Safari). Say "Eleven ..." when Hands-free is on. */
(function () {
  'use strict';
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition, PK = 'sel.v2.staffai', pref = {}, st = { open: false, voice: true, hf: false, speaking: false, rec: null, greeted: false, expect: false };
  try { pref = JSON.parse(localStorage.getItem(PK) || '{}') || {}; } catch (e) {} st.voice = pref.speak !== false;
  function savePref() { try { localStorage.setItem(PK, JSON.stringify(pref)); } catch (e) {} }
  function staff() { try { var s = JSON.parse(sessionStorage.getItem('sel.v2.staff') || 'null'); return s && s.tfa ? s : null; } catch (e) { return null; } }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function inr(n) { return '\u20B9' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 }); }
  var root = document.createElement('div'); root.id = 'ai'; root.style.display = 'none'; document.body.appendChild(root);
  root.innerHTML = '<button class="ai-fab" type="button" data-s="toggle" id="sfab" aria-label="Ask Eleven"><span class="orb" id="sorbF"></span><span class="tip">Ask Eleven</span><span class="wake">Say \u201CEleven\u2026\u201D</span></button>' +
    '<section class="ai-panel" id="spanel" role="dialog" aria-label="Eleven assistant"><div class="ai-head"><span class="orb" id="sorbH"></span><div><b>Eleven</b><small>Your S-ELEVEN work assistant</small></div><div class="sp"><button type="button" data-s="voice" id="svoice"></button><button type="button" data-s="close" aria-label="Close">\u2715</button></div></div>' +
    '<div class="ai-set"><select id="svsel" aria-label="Voice"></select><button type="button" id="shf" data-s="hf" aria-pressed="false">Hands-free</button></div><div class="ai-body" id="sbody" aria-live="polite"></div><div class="ai-chips" id="schips"></div><div class="ai-status" id="sstat"></div>' +
    '<form class="ai-in" id="sform"><input id="sinput" placeholder="Try: show pending orders" autocomplete="off" aria-label="Ask Eleven"><button type="button" class="mic" id="smic" data-s="mic" aria-label="Speak">\u{1F3A4}</button><button class="send" type="submit" aria-label="Send">\u27A4</button></form></section>';
  var $ = function (s) { return root.querySelector(s); };
  function vbtn() { $('#svoice').textContent = 'Voice replies: ' + (st.voice ? 'on' : 'off'); } vbtn();
  if (!SR) { $('#smic').disabled = true; $('#shf').disabled = true; }
  function orb(s) { ['sorbF', 'sorbH'].forEach(function (id) { var o = document.getElementById(id); if (o) { o.classList.remove('listening', 'speaking'); if (s) o.classList.add(s); } }); }
  function bubble(k, h) { var d = document.createElement('div'); d.className = 'bub ' + k; d.innerHTML = h; $('#sbody').appendChild(d); $('#sbody').scrollTop = 99999; return d; }
  /* ---- voice ---- */
  function vscore(v) { var n = v.name.toLowerCase(), l = (v.lang || '').toLowerCase(), s = 0; if (/en[-_]in/.test(l)) s += 30; else if (/^en/.test(l)) s += 12; else return -999; if (/(neerja|heera|veena|kalpana)/.test(n)) s += 40; if (/(aria|jenny|zira|samantha|karen|moira|tessa|susan|hazel|libby|sonia|female)/.test(n)) s += 26; if (/(ravi|prabhat|david|mark|george|james|daniel|alex|male)/.test(n) && !/female/.test(n)) s -= 70; if (/(natural|neural|online)/.test(n)) s += 12; return s; }
  function voices() { try { return speechSynthesis.getVoices() || []; } catch (e) { return []; } }
  function pick() { var vs = voices(), c = null, b = -999; if (pref.voice) vs.forEach(function (v) { if (v.name === pref.voice) c = v; }); if (c) return c; vs.forEach(function (v) { var s = vscore(v); if (s > b) { b = s; c = v; } }); return c; }
  function fill() { var vs = voices().filter(function (v) { return vscore(v) > -999; }).sort(function (a, b) { return vscore(b) - vscore(a); }), a = pick(); $('#svsel').innerHTML = '<option value="">Voice: Auto (' + esc(a ? a.name.replace(/Microsoft |Google /, '') : 'default') + ')</option>' + vs.map(function (v) { return '<option value="' + esc(v.name) + '"' + (pref.voice === v.name ? ' selected' : '') + '>' + esc(v.name.replace(/Microsoft /, '')) + '</option>'; }).join(''); }
  try { speechSynthesis.onvoiceschanged = fill; } catch (e) {} fill();
  function sp(t) { return String(t).replace(/\u20B9\s?([\d,]+)/g, function (m, n) { return n.replace(/,/g, '') + ' rupees'; }).replace(/[*_`#\u2022]/g, '').replace(/\n+/g, '. '); }
  function stopSpeak() { try { speechSynthesis.cancel(); } catch (e) {} st.speaking = false; }
  function after() { st.speaking = false; orb(''); if (st.expect) { st.expect = false; listen(); } else if (st.hf) hfLoop(); }
  function speak(t) { if (!('speechSynthesis' in window)) { after(); return; } try { speechSynthesis.cancel(); killRec(); var u = new SpeechSynthesisUtterance(sp(t)), v = pick(); u.lang = (v && v.lang) || 'en-IN'; if (v) u.voice = v; u.rate = .96; u.pitch = 1.08; u.onstart = function () { st.speaking = true; orb('speaking'); }; u.onend = after; u.onerror = after; speechSynthesis.speak(u); } catch (e) { after(); } }
  function say(text, acts, viaVoice, ask, choices) {
    var ah = (acts || []).map(function (a, i) { return '<a class="act" href="#" data-s="act" data-h="' + esc(a.hash || '') + '" data-c="' + esc(a.click || '') + '">' + esc(a.label) + '</a>'; }).join('');
    var ch = (choices || []).map(function (c) { return '<button type="button" class="act chbtn" data-s="choice" data-v="' + esc(c.value) + '">' + esc(c.label) + '</button>'; }).join(''); bubble('bot', esc(text).replace(/\n/g, '<br>') + (ah ? '<div>' + ah + '</div>' : '') + (ch ? '<div class="choices">' + ch + '</div>' : '')); st.expect = !!ask && (viaVoice || st.voice) && !!SR; if (viaVoice || st.voice) speak(text); else st.expect = false;
  }
  function killRec() { try { if (st.rec) { st.rec.onend = null; st.rec.abort(); } } catch (e) {} st.rec = null; }
  function mk(c) { var r = new SR(); r.lang = 'en-IN'; r.continuous = c; r.interimResults = !c; return r; }
  function listen() { if (!SR) return; stopSpeak(); killRec(); try { var r = mk(false); st.rec = r; r.onresult = function (e) { var t = ''; for (var i = e.resultIndex; i < e.results.length; i++) t += e.results[i][0].transcript; $('#sinput').value = t; if (e.results[e.results.length - 1].isFinal) { st.rec = null; orb(''); $('#sstat').textContent = ''; submit(t, true); } }; r.onerror = function () { $('#sstat').textContent = 'Could not hear that. Tap the mic and try again.'; orb(''); st.rec = null; }; r.onend = function () { if (!st.speaking) orb(''); st.rec = null; if (st.hf && !st.speaking) setTimeout(hfLoop, 300); }; r.start(); orb('listening'); $('#sstat').textContent = 'Listening\u2026'; } catch (e) {} }
  function wake(raw) { var q = String(raw).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').trim(), m = q.match(/^(?:hey |ok |okay |hi )?(?:eleven|elevan|leven|11)\b[ ,.!]*(.*)$/); return m ? m[1].trim() : null; }
  function heard(raw) { var c = wake(raw); if (c === null) return; open(); if (!c) { say('Yes? How can I help?', null, true, true); return; } submit(c, true); }
  var fails = 0; function hfLoop() { if (!st.hf || !SR || st.speaking || st.rec) return; try { var r = mk(true); st.rec = r; r.onresult = function (e) { for (var i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) { fails = 0; heard(e.results[i][0].transcript); } }; r.onerror = function (e) { if (e.error === 'not-allowed') hf(false); else if (e.error !== 'no-speech' && e.error !== 'aborted') fails++; }; r.onend = function () { st.rec = null; if (st.hf && !st.speaking && fails < 6) setTimeout(hfLoop, 500); }; r.start(); } catch (e) { st.rec = null; } }
  function hf(on) { st.hf = !!on && !!SR; pref.hf = st.hf; savePref(); $('#shf').setAttribute('aria-pressed', st.hf ? 'true' : 'false'); $('#sfab').classList.toggle('hf', st.hf); if (st.hf) hfLoop(); else killRec(); }
  /* ---- knowledge: live data ---- */
  function go(h) { if (location.hash === h) window.dispatchEvent(new Event('hashchange')); else location.hash = h; }
  function packed(o) { return ['Dispatched', 'Out for delivery', 'Delivered'].indexOf(o.status) > -1 || (o.packing && o.packing.state === 'Packed'); }
  function counts() {
    var all = DB.allOrders(), paid = all.filter(function (o) { return o.payment.status === 'Paid' && !o.cancelled; });
    var unp = paid.filter(function (o) { return ['Placed', 'Processing'].indexOf(o.status) > -1 && !packed(o); }), rdy = paid.filter(function (o) { return ['Placed', 'Processing'].indexOf(o.status) > -1 && packed(o); });
    var old = unp.reduce(function (m, o) { return Math.max(m, Date.now() - new Date((o.payment && o.payment.paidAt) || o.date).getTime()); }, 0);
    return { unp: unp, rdy: rdy, noInv: paid.filter(function (o) { return !o.invoiceFile; }), noEway: paid.filter(function (o) { return DB.needsEway(o) && !o.ewayFile; }), unpaid: all.filter(function (o) { return o.payment.status !== 'Paid' && !o.cancelled; }), oldH: Math.floor(old / 3600000), leaves: DB.leaves().filter(function (x) { return x.status === 'PENDING'; }) };
  }
  var STOP = 'show me the a an of in is are how many much what who for my to open go please stock available inventory pack packed units unit pcs tell about check any there'.split(' ');
  function productStock(q) {
    var words = [], size = ''; q.split(' ').forEach(function (t) { if (!t || STOP.indexOf(t) > -1) return; if (/^\d+(\.\d+)?(lb|lbs|kg|g|gm|ml|l)?$/.test(t) || /^(lb|lbs|kg|g|gm|ml|l)$/.test(t)) size += t.replace(/lbs$/, 'lb').replace(/gm$/, 'g'); else if (t.length > 1) words.push(t); });
    if (!words.length) return null; var out = [];
    Object.keys(SEL.CATALOG).forEach(function (b) { var s0 = staff(); if (s0 && s0.dept === 'fieldsales' && DB.fieldActiveBrands(s0.code).indexOf(b) < 0) return; SEL.CATALOG[b].forEach(function (p) { var hay = (SEL.brandById(b).name + ' ' + p.name).toLowerCase(); if (!words.every(function (t) { return hay.indexOf(t.replace(/s$/, '')) > -1; })) return; var vs = p.variants.filter(function (v) { return !size || v.label.toLowerCase().replace(/[\s.]/g, '').indexOf(size) > -1; }); out.push({ b: b, p: p, vs: vs.length ? vs : p.variants }); }); });
    return out.slice(0, 3);
  }
  /* ---- v28: Eleven speaks only about the user's own department ---- */
  var DEPT_HELP = {
    host: 'the overview, the Sales page by zone, the Team and Security pages, pending orders, finance and HR items, offers, and who is clocked in',
    sales: 'your orders (pending, preorders, samples, on-field orders from your consultants), the CRM, creating orders, your dealers, your field consultants (their visits, orders and commission), Sheets and WhatsApp to your dealers',
    fieldsales: 'creating dealers (in your state) and orders, your CRM leads, your orders and their status, logging and editing visits, your commission, offers from your senior, stock of your activated brands, and WhatsApp to your dealers',
    logistics: 'dispatch and tracking, invoices and e-way bills, on-field orders, return orders, sample orders and stock (including stock in, out and returns)',
    warehouse: 'packing and the orders to pack, return orders, and stock levels (view only)',
    finance: 'payments and proofs, dealer ledgers, returns and inward, on-field orders and commission, and stock',
    branding: 'posts, designs and your tasks', it: 'your tasks and the IT screens', hr: 'leave requests, attendance, allowances and salaries of employees'
  };
  var SCOPES = [
    [/(invoices? to upload|upload (the |an |a |my )?(invoices?|e ?way)|e ?way ?bills? (to|missing|needed)|add (the )?tracking|courier partner|dispatch (it|the order|from))/, ['logistics', 'finance', 'host'], 'Dispatch, invoices and e-way bills'],
    [/(not packed|unpacked|to pack\b|start packing|packing list)/, ['warehouse', 'logistics', 'host'], 'Packing'],
    [/(leave requests?|payroll|salary|salaries|who is absent|who is clocked|allowances?)/, ['host', 'hr'], 'HR'],
    [/\b(team|departments?|employees?|staff)\b/, ['host', 'hr'], 'Team and employees'],
    [/(security|authenticator|two.?factor|2fa)/, ['host'], 'Security'],
    [/(ledger|collection|revenue|payment proof|credit note|refund)/, ['finance', 'host', 'sales'], 'Finance'],
    [/\b(crm|leads?)\b/, ['sales', 'fieldsales', 'host'], 'The CRM'],
    [/\bvisits?\b/, ['fieldsales', 'sales', 'host'], 'Field visits'],
    [/\b(commission|incentives?)\b/, ['fieldsales', 'sales', 'finance', 'host'], 'Commission']
  ];
  function deptLabel(s) { try { return DB.DEPTS[s.dept] || s.dept; } catch (e) { return s.dept; } }
  function helpText(s) { return 'I can help you with ' + (DEPT_HELP[s.dept] || 'your own screens') + '.'; }
  function scopeReply(q, s) {
    var d = s.dept;
    if (d === 'fieldsales') {
      if (/(clock (in|out)|attendance|leave|salary|slip|allowance)/.test(q)) return { text: 'Attendance and allowances are not used for Field Sales Consultants: you earn commission instead. ' + helpText(s) };
      if (/\banalytics\b/.test(q)) return { text: 'Analytics is not part of your screens. Your commission is on your dashboard. ' + helpText(s) };
      if (/(message|whatsapp|chat|text).*(employee|colleague|manager|staff|senior|team)/.test(q)) return { text: 'You can message your dealers only. ' + helpText(s) };
    }
    for (var i = 0; i < SCOPES.length; i++) if (SCOPES[i][0].test(q) && SCOPES[i][1].indexOf(d) < 0) return { text: SCOPES[i][2] + ' belongs to another department, so I cannot share it with you (you are in ' + deptLabel(s) + '). ' + helpText(s) };
    return null;
  }
  function deptAnswer(q, s) {
    var d = s.dept;
    if (/\b(what can you do|help|what do you know|how can you help)\b/.test(q)) return { text: 'You are in ' + deptLabel(s) + '. ' + helpText(s) };
    if (/\b(crm|leads?)\b/.test(q) && ['sales', 'fieldsales', 'host'].indexOf(d) > -1) { var L = DB.listCrm(s.code, s.role), by = {}; L.forEach(function (x) { by[x.status] = (by[x.status] || 0) + 1; }); go('#/crm'); return { text: L.length ? 'You have ' + L.length + ' lead(s): ' + Object.keys(by).map(function (k) { return by[k] + ' ' + k.toLowerCase(); }).join(', ') + '. Opening the CRM.' : 'You have no leads yet. Opening the CRM so you can add one.' }; }
    if (/\bvisits?\b/.test(q) && ['fieldsales', 'sales', 'host'].indexOf(d) > -1) { var V = DB.listVisits(s.code, s.role); go('#/visits'); return { text: V.length + ' visit(s) are logged' + (d === 'fieldsales' ? '. You can log a new one or edit an earlier one.' : ' by the field consultants you can see.') + ' Opening the visits.' }; }
    if (/\b(commission|earned)\b/.test(q) && d === 'fieldsales') { var cs = DB.fieldCommissionSummary(s.code, DB.ym(Date.now())); go('#/mydash'); return { text: 'Your commission this month is ' + inr(cs.total) + ', earned only on orders whose payment Finance has verified. Opening your dashboard.' }; }
    if (/(which|what).*(brands?)/.test(q) && d === 'fieldsales') { var fb = (DB.getEmployee(s.code) || {}).fieldBrands || {}, on = Object.keys(fb).filter(function (b) { return fb[b] && fb[b].on; }); return { text: on.length ? 'You can sell: ' + on.map(function (b) { return SEL.brandById(b).name + ' (commission ' + DB.commissionLabel(fb[b]) + ')'; }).join(', ') + '.' : 'No brand is active for you yet. Your senior Sales executive switches brands on once the Host has set the commission.' }; }
    if (/(my orders?|order status|pending orders?|show pending)/.test(q) && (d === 'sales' || d === 'fieldsales')) { var mine = DB.allOrders().filter(function (o) { return o.attr && o.attr.emp === s.code && !o.cancelled; }), open = mine.filter(function (o) { return o.status !== 'Delivered'; }); go('#/orders'); return { text: d === 'sales' ? 'Opening your orders: pending orders, preorders, samples, delivered orders and the on-field orders of your consultants.' : 'You have ' + open.length + ' order(s) in progress and ' + (mine.length - open.length) + ' delivered. Opening your orders.' }; }
    return null;
  }
  function answer(raw) {
    var s9 = staff(), q9 = String(raw).toLowerCase().replace(/[^a-z0-9₹ ]+/g, ' ').replace(/\s+/g, ' ').trim(); if (s9 && q9) { var sc9 = scopeReply(q9, s9); if (sc9) return sc9; var da9 = deptAnswer(q9, s9); if (da9) return da9; }
    if (window.SelAgent) { var ag = null; try { ag = SelAgent.handle(raw); } catch (e) { if (window.console) console.error(e); } if (ag) { if (ag.go) go(ag.go); if (ag.guide && window.SelBot) setTimeout(function () { SelBot.guide(ag.guide.sel, ag.guide.text, { hold: 5200 }); }, 250); if (ag.tour && window.SelBot) setTimeout(SelBot.tour, 300); if (ag.openOrder && window.SelPortal) { go('#/orders'); setTimeout(function () { SelPortal.openOrder(ag.openOrder.code, ag.openOrder.id); }, 250); } return { text: ag.text, actions: ag.actions, choices: ag.choices }; } }
    var s = staff(), q = String(raw).toLowerCase().replace(/[^a-z0-9₹ ]+/g, ' ').replace(/\s+/g, ' ').trim(), c = counts(), role = s ? s.role : '', adm = role === 'admin';
    if (!s) return { text: 'Please sign in first.' };
    if (!q) return { text: 'I am listening.' };
    var sc0 = scopeReply(q, s); if (sc0) return sc0; var da0 = deptAnswer(q, s); if (da0) return da0;
    /* v31: Eleven locates any order (or a return) the staff member can see by its id, whatever its format,
       and opens it in the right tab. We scan the real ids so SE-, DEMO-, H- and RT- ids all work. */
    /* v31: Eleven locates any order (or a return) the staff member can see by its id, whatever its format,
       and opens it in the right tab. We scan the real ids so SE-, DEMO-, H- and RT- ids all work. */
    var upRaw = ' ' + String(raw).toUpperCase() + ' ';
    if (upRaw.replace(/[^A-Z0-9]/g, '').length >= 4) {
      var allO = DB.allOrders(), hitO = null;
      allO.forEach(function (o) { if (!hitO && o.id && o.id.length >= 4 && upRaw.indexOf(o.id.toUpperCase()) > -1) hitO = o; });
      if (!hitO) { var rl2 = (DB.listReturns ? DB.listReturns() : []), rHit = null; rl2.forEach(function (r) { if (!rHit && r.id && String(r.id).length >= 4 && upRaw.indexOf(String(r.id).toUpperCase()) > -1) rHit = r; }); if (rHit) allO.forEach(function (o) { if (o.id === rHit.orderId) hitO = o; }); }
      if (hitO) {
        var tabO = role === 'logistics' ? '#/logistics' : (role === 'warehouse' ? '#/warehouse' : '#/orders');
        go(tabO);
        if (window.SelPortal && SelPortal.openOrder) setTimeout(function () { SelPortal.openOrder(hitO.dealerCode, hitO.id); }, 260);
        return { text: 'Found order ' + hitO.id + ' for ' + hitO.dealerName + ' (' + inr(hitO.totals.total) + ') — it is ' + hitO.status + '. Opening it for you.' };
      }
    }
    if (/^(hi|hello|hey|namaste)\b/.test(q) && q.split(' ').length < 4) return { text: 'Hi ' + s.name.split(' ')[0] + '! Ask me for pending orders, stock, your attendance, or tell me where to go.' };
    if (/\b(thank|thanks)\b/.test(q)) return { text: 'You are welcome!' };
    if (/\bclock in\b|\bsign in to (my )?shift\b|start my (shift|day)/.test(q)) { var r = DB.clockIn(s.code); if (r.error) return { text: r.error }; go('#/mywork'); return { text: 'Done. You are clocked in. Have a good day!' }; }
    if (/\bclock out\b|end my (shift|day)/.test(q)) { var r2 = DB.clockOut(s.code); if (r2.error) return { text: r2.error }; go('#/mywork'); return { text: 'You are clocked out. See you tomorrow!' }; }
    if (/(my )?(attendance|leave balance|working hours)|request leave|apply for leave/.test(q) && !/who|everyone|team|all/.test(q)) { if (role === 'admin') { go('#/hr'); return { text: 'Opening HR. Choose an employee and tap View calendar for their month.' }; } go('#/mywork'); var b = DB.leaveBalance(s.code, new Date().getFullYear()), pd = b.PAID; return { text: 'Opening your attendance. You have ' + (pd ? pd.remaining + ' paid leave day(s) left' : 'no paid leave record') + '.' }; }
    if (/(not packed|unpacked|to pack|pending (orders?|packing)|orders? (to|need to) (be )?pack|pending orders?|show pending)/.test(q)) {
      var tgt = role === 'logistics' ? '#/logistics' : (role === 'employee' || role === 'finance' ? '#/orders' : '#/warehouse'); go(tgt);
      var t = c.unp.length ? c.unp.length + ' paid order(s) are not packed yet' + (c.oldH >= 2 ? ', the oldest waiting ' + c.oldH + ' hours (shown in red)' : ' (shown in yellow)') + '.' : 'Every paid order is packed.';
      t += ' ' + c.rdy.length + ' packed order(s) are waiting to be dispatched.' + (role === 'logistics' || adm ? ' ' + c.noInv.length + ' need an invoice upload' + (c.noEway.length ? ' and ' + c.noEway.length + ' need an e-way bill.' : '.') : ''); return { text: t + ' Opening it now.', actions: [{ label: 'Open Warehouse', hash: '#/warehouse' }, { label: 'Open Logistics', hash: '#/logistics' }] };
    }
    if (/(ready to dispatch|to dispatch|dispatch|courier|tracking)/.test(q)) { go('#/logistics'); return { text: c.rdy.length + ' packed order(s) are ready to dispatch. Opening Logistics.' }; }
    if (/(invoice|e way|eway|e-way)/.test(q)) { go('#/logistics'); return { text: c.noInv.length + ' paid order(s) need an invoice uploaded, and ' + c.noEway.length + ' order(s) above \u20B950,000 need an e-way bill. Opening Logistics.' }; }
    if (/(sample)/.test(q)) { go('#/samples'); return { text: 'Opening sample orders.' }; }
    if (/(leave requests?|pending leave|hr\b)/.test(q) && adm) { go('#/hr'); return { text: c.leaves.length + ' leave request(s) are waiting for you. Opening HR.' }; }
    if (/(who is|who\'s|who are).*(absent|present|in|clocked)|attendance today|absent today/.test(q) && adm) { var ym = DB.ym(Date.now()), today = new Date().toISOString().slice(0, 10), ab = [], inn = []; DB.listEmployees().forEach(function (e) { if (e.dept === 'host') return; (DB.clockState(e.id).state === 'in' ? inn : ab).push(e.name); }); return { text: inn.length + ' employee(s) are clocked in now' + (inn.length ? ': ' + inn.slice(0, 6).join(', ') : '') + '. Not clocked in: ' + (ab.length ? ab.slice(0, 8).join(', ') : 'nobody') + '.', actions: [{ label: 'Open HR', hash: '#/hr' }] }; }
    if (/(alerts?|notifications?)/.test(q)) { go(location.hash); setTimeout(function () { var b = document.querySelector('.bellbtn'); if (b) b.click(); }, 150); return { text: 'Here are your alerts.' }; }
    if (/(finance|collection|revenue|sales report)/.test(q) && (adm || role === 'finance')) { go('#/finance'); return { text: 'Opening Finance.' }; }
    if (/(overview|dashboard|home)/.test(q) && adm) { go('#/overview'); return { text: 'Opening the overview.' }; }
    var hub = q.match(/\b(targets?|freebies|freebie|offers?|preorders?)\b/); if (hub) { var k = hub[1].replace(/s$/, '') + 's'; k = { targets: 'targets', freebies: 'freebies', freebie: 'freebies', offers: 'offers', preorders: 'preorders' }[k] || k; go(adm ? '#/team/sales/' + k : '#/' + k); return { text: 'Opening ' + k + '.' }; }
    if (/(team|department)/.test(q) && adm) { var dm = q.match(/(sales|logistics|warehouse|finance|branding|it|host)/); go(dm ? '#/team/' + dm[1] : '#/team'); return { text: 'Opening ' + (dm ? dm[1] : 'the team') + '.' }; }
    var dealers = DB.listDealers().filter(function (d) { var n = d.name.toLowerCase(), cd = d.code.toLowerCase(); return q.indexOf(cd) > -1 || n.split(' ').filter(function (w) { return w.length > 3; }).some(function (w) { return q.indexOf(w) > -1; }); });
    if (dealers.length && /(order|orders|month|monthly|received|pending)/.test(q)) { var d = dealers[0], ym2 = DB.ym(Date.now()), ords = DB.listOrders(d.code), mo = ords.filter(function (o) { return DB.ym(new Date(o.date).getTime()) === ym2; }), team = mo.filter(function (o) { return o.createdBy && o.createdBy.role !== 'dealer' && o.createdBy.role !== 'system'; }); go('#/dealers'); return { text: d.name + ': ' + mo.length + ' order(s) this month worth ' + inr(mo.reduce(function (a, o) { return a + o.totals.total; }, 0)) + ' (' + (mo.length - team.length) + ' placed by the dealer, ' + team.length + ' by the Sales team). ' + ords.filter(function (o) { return o.payment.status !== 'Paid'; }).length + ' unpaid.', actions: [{ label: 'Open Dealers', hash: '#/dealers' }] }; }
    if (/(dealer)/.test(q)) { go('#/dealers'); return { text: 'Opening dealers.' }; }
    if (/(inventory|stock|in stock|available|how many)/.test(q)) {
      var ps = productStock(q); if (ps && ps.length) { var lines = []; ps.forEach(function (x) { x.vs.forEach(function (v) { var k = DB.stock(SEL.sku(x.p.id, v.id)); lines.push(SEL.brandById(x.b).name + ' ' + x.p.name.split(' (')[0] + ' ' + v.label + ': ' + k.avail + ' available (' + k.on + ' on hand, ' + k.res + ' reserved)'); }); }); go('#/inventory'); return { text: lines.slice(0, 5).join('\n'), actions: [{ label: 'Open Inventory', hash: '#/inventory' }] }; }
      go('#/inventory'); return { text: 'Opening inventory.' };
    }
    if (/(orders?)/.test(q)) { go(role === 'logistics' ? '#/logistics' : (role === 'warehouse' ? '#/warehouse' : (role === 'employee' || role === 'finance' ? '#/orders' : '#/logistics'))); return { text: 'Opening orders.' }; }
    var s8 = staff(); return { text: 'You are in ' + deptLabel(s8) + '. ' + helpText(s8) + ' Try "what can you do" or "show alerts".' };
  }
  function submit(t, viaVoice) { t = (t || '').trim(); if (!t) return; stopSpeak(); bubble('me', esc(t)); $('#sinput').value = ''; var r; try { r = answer(t); } catch (e) { if (window.console) console.error(e); r = { text: 'Sorry, something went wrong. Please try again.' }; } say(r.text, r.actions, viaVoice, r.ask, r.choices); }
  function chips() { var s = staff(), l = ['Show pending orders', 'Show alerts', 'Clock in']; if (s && s.dept === 'fieldsales') l = ['My orders', 'My leads', 'My commission', 'My visits']; else if (s && s.dept === 'sales') l = ['My orders', 'My leads', 'Field visits', 'Show alerts']; if (s && (s.role === 'warehouse' || s.role === 'logistics')) l = ['Show pending orders', 'Invoices to upload', 'Whey protein stock', 'Clock in']; if (s && s.role === 'admin') l = ['Show pending orders', 'Who is clocked in', 'Leave requests', 'Open sales offers']; $('#schips').innerHTML = l.map(function (c) { return '<button type="button" data-s="chip">' + esc(c) + '</button>'; }).join(''); }
  function open() { st.open = true; $('#spanel').classList.add('open'); chips(); if (!st.greeted) { st.greeted = true; var s = staff(); say('Hi ' + (s ? s.name.split(' ')[0] : '') + ', I am Eleven, your assistant for ' + (s ? deptLabel(s) : 'your department') + '. ' + (s ? helpText(s) : '') + ' You can also say "Eleven, show pending orders".', null, false); } setTimeout(function () { $('#sinput').focus(); }, 40); }
  function close() { st.open = false; $('#spanel').classList.remove('open'); killRec(); stopSpeak(); orb(''); if (st.hf) setTimeout(hfLoop, 200); }
  root.addEventListener('click', function (e) { var el = e.target.closest('[data-s]'); if (!el) return; var k = el.getAttribute('data-s');
    if (k === 'sugask') { var sb = $('#ssug'); if (sb) sb.classList.remove('show'); open(); submit(el.getAttribute('data-q')); } else if (k === 'sugx') { var sb2 = $('#ssug'); if (sb2) sb2.classList.remove('show'); } else if (k === 'toggle') { var sb3 = $('#ssug'); if (sb3) sb3.classList.remove('show'); st.open ? close() : open(); } else if (k === 'close') close(); else if (k === 'mic') listen(); else if (k === 'voice') { st.voice = !st.voice; pref.speak = st.voice; savePref(); vbtn(); if (!st.voice) stopSpeak(); } else if (k === 'hf') hf(!st.hf); else if (k === 'chip') submit(el.textContent);
    else if (k === 'choice') { submit(el.getAttribute('data-v')); } else if (k === 'act') { e.preventDefault(); var h = el.getAttribute('data-h'); if (h) go(h); } });
  $('#svsel').addEventListener('change', function (e) { pref.voice = e.target.value; savePref(); fill(); speak('Hello, this is my voice.'); });
  $('#sform').addEventListener('submit', function (e) { e.preventDefault(); submit($('#sinput').value); });
  function visible() { root.style.display = staff() ? '' : 'none'; } visible(); setInterval(visible, 1500); window.addEventListener('hashchange', visible);

  /* ---- Eleven suggests something useful every minute ---- */
  var sugIdx = 0;
  function suggestions() {
    var s = staff(); if (!s) return []; var c = {}, l = [], role = s.role; try { c = counts(); } catch (e) {} function add(t, q) { l.push({ t: t, q: q }); }
    if (c.unpaid && c.unpaid.length && (role === 'employee' || role === 'admin' || role === 'finance')) add(c.unpaid.length + ' order(s) are still waiting for payment.', 'Show pending orders');
    if (c.noInv && c.noInv.length && (role === 'logistics' || role === 'finance' || role === 'admin')) add(c.noInv.length + ' paid order(s) still need an invoice.', 'Invoices to upload');
    if (c.noEway && c.noEway.length && (role === 'logistics' || role === 'finance' || role === 'admin')) add('E-way bill is missing on ' + c.noEway.length + ' order(s).', 'E-way bills to upload');
    if (c.unp && c.unp.length && (role === 'warehouse' || role === 'logistics' || role === 'admin')) add(c.unp.length + ' paid order(s) are not packed yet.', 'Show pending orders');
    if (c.rdy && c.rdy.length && (role === 'warehouse' || role === 'logistics' || role === 'admin')) add(c.rdy.length + ' packed order(s) are ready to dispatch.', 'Show pending orders');
    if (c.leaves && c.leaves.length && role === 'admin') add(c.leaves.length + ' leave request(s) need your decision.', 'Leave requests');
    try { var n = DB.alertsFor(s.code, s.role).length; if (n) add('You have ' + n + ' alert(s) waiting under the bell.', 'Show alerts'); } catch (e) {}
    if (role === 'admin') { var ne = 0, nd = 0, anyStock = true; try { ne = DB.listEmployees().filter(function (e) { return e.dept !== 'host'; }).length; nd = DB.listDealers().length; anyStock = Object.keys(JSON.parse(localStorage.getItem('sel.v2.batches') || '{}')).length > 0; } catch (e) {} if (!ne) add('Start here: add your team under Team.', 'Where is Team'); else if (!nd) add('Next: add your first dealer under Dealers.', 'Where is Dealers'); if (!anyStock) add('No stock yet. Add stock in Inventory or upload a purchase bill.', 'Where is Inventory'); }
    add('Want a quick tour of the menu?', 'Give me a tour');
    if (role === 'employee' || role === 'admin') add('Need a preorder? Say: create a preorder of mass gainer for DEMO001.', 'Create a preorder for DEMO001');
    add('Check stock quickly: ask \u201Cwhey protein stock\u201D.', 'Whey protein stock'); add('Open your attendance and salary slips.', 'Open my attendance'); add('Clock in or out of your shift.', 'Clock in');
    return l;
  }
  function sugTick() {
    var s = staff(); if (!s) return; var l = suggestions(); if (!l.length) return; var sg = l[sugIdx % l.length]; sugIdx++;
    if (st.open) { $('#schips').innerHTML = [0, 1, 2, 3].map(function (k) { return l[(sugIdx + k - 1) % l.length]; }).filter(function (x, i, a) { return a.indexOf(x) === i; }).map(function (x) { return '<button type="button" data-s="chip">' + esc(x.q) + '</button>'; }).join(''); return; }
    var b = $('#ssug'); if (!b) { b = document.createElement('div'); b.id = 'ssug'; b.className = 'ai-sug'; b.setAttribute('role', 'status'); b.setAttribute('aria-live', 'polite'); root.appendChild(b); }
    b.innerHTML = '<b>Eleven suggests</b><span>' + esc(sg.t) + '</span><div class="sugbtns"><button type="button" data-s="sugask" data-q="' + esc(sg.q) + '">Ask Eleven</button><button type="button" class="ghost" data-s="sugx" aria-label="Dismiss">Not now</button></div>'; b.classList.add('show'); if (window.SelBot) SelBot.wave(); clearTimeout(b._t); b._t = setTimeout(function () { b.classList.remove('show'); }, 15000);
  }
  setTimeout(sugTick, 7000); setInterval(sugTick, 60000);
  window.StaffEleven = { answer: answer, heard: heard, ask: function (q) { open(); submit(q); } };
  if (pref.hf && SR) { try { navigator.permissions.query({ name: 'microphone' }).then(function (p) { if (p.state === 'granted') hf(true); }); } catch (e) {} }
})();
