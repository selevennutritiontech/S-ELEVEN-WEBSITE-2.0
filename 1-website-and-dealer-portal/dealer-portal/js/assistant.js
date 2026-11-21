/* "Eleven" - the dealer assistant (DEMO). Runs in the browser; reads the dealer's own orders, prices, offers and cart.
   Voice uses the browser's speech features (Chrome / Edge / Safari). Eleven.answer() is the single place
   to connect a real AI service later. */
(function () {
  'use strict';
  var A = window.PortalApp, root = document.getElementById('ai');
  if (!A || !root) return;
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  var PK = 'sel.v2.ai', pref = {};
  try { pref = JSON.parse(localStorage.getItem(PK) || '{}') || {}; } catch (e) {}
  function savePref() { try { localStorage.setItem(PK, JSON.stringify(pref)); } catch (e) {} }
  var st = { open: false, voice: pref.speak !== false, hf: false, speaking: false, rec: null, acts: [], greeted: false, ctx: null, awakeUntil: 0, lastCoupon: '', expectAnswer: false };
  var $ = function (s) { return root.querySelector(s); };

  /* ---------- ui ---------- */
  root.innerHTML =
    '<button class="ai-fab" type="button" data-ai="toggle" id="aiFab" aria-label="Ask Eleven, the dealer assistant"><span class="orb" id="orbF"></span><span class="tip">Ask Eleven</span><span class="wake">Say \u201CEleven\u2026\u201D</span></button>' +
    '<section class="ai-panel" id="aiPanel" role="dialog" aria-label="Eleven assistant"><div class="ai-head"><span class="orb" id="orbH"></span><div><b>Eleven</b><small>Your S-ELEVEN dealer assistant</small></div>' +
    '<div class="sp"><button type="button" data-ai="voice" id="aiVoice"></button><button type="button" data-ai="close" aria-label="Close assistant">\u2715</button></div></div>' +
    '<div class="ai-set"><select id="aiVoiceSel" aria-label="Voice"></select><button type="button" id="aiHf" data-ai="hf" aria-pressed="false" title="Always listen for \u201CEleven\u201D while this page is open">Hands-free</button></div>' +
    '<div class="ai-body" id="aiBody" aria-live="polite"></div><div class="ai-chips" id="aiChips"></div><div class="ai-status" id="aiStatus"></div>' +
    '<form class="ai-in" id="aiForm"><input id="aiInput" placeholder="Type, or say \u201CEleven, add 10 mass gainers\u201D" autocomplete="off" aria-label="Ask Eleven">' +
    '<button type="button" class="mic" id="aiMic" data-ai="mic" aria-label="Speak your question">' + A.ic('mic') + '</button><button class="send" type="submit" aria-label="Send">' + A.ic('send') + '</button></form></section>';
  if (!SR) { var mm = $('#aiMic'); mm.disabled = true; mm.title = 'Voice input needs Chrome, Edge or Safari. Please type.'; $('#aiHf').disabled = true; }
  function voiceBtn() { $('#aiVoice').textContent = 'Voice replies: ' + (st.voice ? 'on' : 'off'); }
  voiceBtn();
  function chips() {
    var d = A.getDealer(), l = d ? ['Add 10 mass gainers to cart', 'Where is my latest order?', 'Live offers', 'Price of BOLT Whey Protein', 'Read my notifications'] : ['Brand catalogues', 'How do I get a dealer code?', 'Contact support'];
    $('#aiChips').innerHTML = l.map(function (c) { return '<button type="button" data-ai="chip">' + A.esc(c) + '</button>'; }).join('');
  }
  function status(t) { $('#aiStatus').textContent = t || ''; }
  function orb(state) { ['orbF', 'orbH'].forEach(function (id) { var o = document.getElementById(id); if (o) { o.classList.remove('listening', 'speaking'); if (state) o.classList.add(state); } }); }
  function scroll() { var b = $('#aiBody'); b.scrollTop = b.scrollHeight; }
  function bubble(kind, html) { var d = document.createElement('div'); d.className = 'bub ' + kind; d.innerHTML = html; $('#aiBody').appendChild(d); scroll(); return d; }
  function actHtml(actions) {
    return (actions || []).map(function (a) {
      if (a.href) return '<a class="act" href="' + A.esc(a.href) + '"' + (/^https?:/.test(a.href) ? ' target="_blank" rel="noopener noreferrer"' : '') + '>' + A.esc(a.label) + '</a>';
      st.acts.push(a); return '<a class="act" href="#" data-ai="act" data-i="' + (st.acts.length - 1) + '">' + A.esc(a.label) + '</a>';
    }).join('');
  }

  /* ---------- voice: pleasant female voice, clear delivery ---------- */
  function voiceScore(v) {
    var n = v.name.toLowerCase(), l = (v.lang || '').toLowerCase(), s = 0;
    if (/en[-_]in/.test(l)) s += 30; else if (/en[-_](gb|us|au)/.test(l)) s += 16; else if (/^en/.test(l)) s += 8; else return -999;
    if (/(neerja|heera|veena|kalpana)/.test(n)) s += 40;
    if (/(aria|jenny|zira|samantha|karen|moira|tessa|serena|susan|hazel|libby|sonia|catherine|female)/.test(n)) s += 26;
    if (/(ravi|prabhat|rishi|david|mark|george|james|daniel|alex|fred|guy|ryan|thomas|oliver|male)/.test(n) && !/female/.test(n)) s -= 70;
    if (/(natural|neural|online)/.test(n)) s += 12; if (/google/.test(n)) s += 3;
    return s;
  }
  function voices() { try { return speechSynthesis.getVoices() || []; } catch (e) { return []; } }
  function pickVoice() {
    var vs = voices(), chosen = null;
    if (pref.voice) vs.forEach(function (v) { if (v.name === pref.voice) chosen = v; });
    if (chosen) return chosen;
    var best = -999; vs.forEach(function (v) { var s = voiceScore(v); if (s > best) { best = s; chosen = v; } });
    return chosen;
  }
  function fillVoices() {
    var sel = $('#aiVoiceSel'), vs = voices().filter(function (v) { return voiceScore(v) > -999; }).sort(function (a, b) { return voiceScore(b) - voiceScore(a); });
    if (!vs.length) { sel.innerHTML = '<option value="">Voice: browser default</option>'; return; }
    var auto = pickVoice();
    sel.innerHTML = '<option value="">Voice: Auto (' + A.esc(auto ? auto.name.replace(/Microsoft |Google /, '') : 'default') + ')</option>' +
      vs.map(function (v) { return '<option value="' + A.esc(v.name) + '"' + (pref.voice === v.name ? ' selected' : '') + '>' + A.esc(v.name.replace(/Microsoft /, '') + ' (' + v.lang + ')') + '</option>'; }).join('');
  }
  try { speechSynthesis.onvoiceschanged = fillVoices; } catch (e) {}
  fillVoices();
  function md(t) {
    var h = A.esc(t).replace(/```([\s\S]*?)```/g, '<pre>$1</pre>').replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`\n]+)`/g, '<code>$1</code>').replace(/^#{1,4}\s*(.+)$/gm, '<b>$1</b>').replace(/(^|[\s(])\*(?!\s)([^*\n]+?)\*(?=[\s).,!?]|$)/g, '$1<i>$2</i>');
    return h.replace(/^\s*[-*]\s+/gm, '\u2022 ').replace(/\n/g, '<br>');
  }
  function speakable(t) {
    return String(t).replace(/[*_`#]/g, '').replace(/\u20B9\s?([\d,]+(?:\.\d+)?)/g, function (m, n) { return n.replace(/,/g, '') + ' rupees'; })
      .replace(/(\d)\s?(LB|lb)\b/g, '$1 pounds').replace(/(\d)\s?kg\b/gi, '$1 kilograms').replace(/(\d)\s?ml\b/gi, '$1 millilitres').replace(/(\d)\s?g\b/g, '$1 grams')
      .replace(/\u00D7/g, ' times ').replace(/SE-(\d+)-(\d+)/g, 'order $1 $2').replace(/[\u2022\u00B7\u2014\u2192\u2713]/g, ',').replace(/\n+/g, '. ').replace(/\s+/g, ' ');
  }
  function chunks(t) { var out = [], cur = ''; String(t).split(/(?<=[.!?])\s+/).forEach(function (s) { if ((cur + ' ' + s).length > 170 && cur) { out.push(cur); cur = s; } else cur = (cur ? cur + ' ' : '') + s; }); if (cur) out.push(cur); return out; }
  function pauseRec() { try { if (st.rec) { st.rec.onend = null; st.rec.abort(); } } catch (e) {} st.rec = null; }
  function afterSpeech() {
    st.speaking = false; orb('');
    if (st.expectAnswer) { st.expectAnswer = false; if (st.hf) hfLoop(); else startListening(); }
    else if (st.hf) hfLoop();
  }
  function speakOut(text) {
    if (!('speechSynthesis' in window)) { afterSpeech(); return; }
    try {
      speechSynthesis.cancel(); pauseRec();
      var parts = chunks(speakable(text)), v = pickVoice();
      if (!parts.length) { afterSpeech(); return; }
      parts.forEach(function (p, i) {
        var u = new SpeechSynthesisUtterance(p); u.lang = (v && v.lang) || 'en-IN'; if (v) u.voice = v;
        u.rate = 0.96; u.pitch = 1.08; u.volume = 1;
        if (i === 0) u.onstart = function () { st.speaking = true; orb('speaking'); };
        if (i === parts.length - 1) { u.onend = afterSpeech; u.onerror = afterSpeech; }
        speechSynthesis.speak(u);
      });
    } catch (e) { afterSpeech(); }
  }
  function stopSpeaking() { try { speechSynthesis.cancel(); } catch (e) {} st.speaking = false; }

  /* say(): shows a bubble and (if voice is on, or the user spoke) reads it aloud. ask = Eleven expects an answer */
  function say(text, actions, viaVoice, ask) {
    bubble('bot', md(text) + (actions && actions.length ? '<div>' + actHtml(actions) + '</div>' : ''));
    st.expectAnswer = !!ask && (viaVoice || st.voice || st.hf) && !!SR;
    if (viaVoice || st.voice) speakOut(text); else st.expectAnswer = false;
  }

  /* ---------- listening: tap-to-talk and hands-free ("Eleven ...") ---------- */
  function makeRec(cont) { var r = new SR(); r.lang = 'en-IN'; r.continuous = cont; r.interimResults = !cont; r.maxAlternatives = 1; return r; }
  function startListening() {
    if (!SR) { status('Voice input needs Chrome, Edge or Safari. Please type.'); return; }
    stopSpeaking(); pauseRec();
    try {
      var rec = makeRec(false); st.rec = rec;
      rec.onresult = function (e) {
        var t = ''; for (var i = e.resultIndex; i < e.results.length; i++) t += e.results[i][0].transcript; $('#aiInput').value = t;
        if (e.results[e.results.length - 1].isFinal) { st.rec = null; $('#aiMic').classList.remove('on'); orb(''); status(''); submit(t, true); }
      };
      rec.onerror = function (e) { status(e.error === 'not-allowed' || e.error === 'service-not-allowed' ? 'Microphone permission was blocked. You can still type.' : 'I could not hear that. Tap the mic and try again.'); $('#aiMic').classList.remove('on'); orb(''); st.rec = null; };
      rec.onend = function () { $('#aiMic').classList.remove('on'); if (!st.speaking) orb(''); st.rec = null; if (st.hf && !st.speaking) setTimeout(hfLoop, 300); };
      rec.start(); $('#aiMic').classList.add('on'); orb('listening'); status('Listening\u2026');
    } catch (e) { status('Could not start the microphone.'); }
  }
  function stopListening() { try { if (st.rec) { st.rec.onend = null; st.rec.stop(); } } catch (e) {} st.rec = null; $('#aiMic').classList.remove('on'); if (!st.speaking) orb(''); if ($('#aiStatus').textContent === 'Listening\u2026') status(''); }
  function wakeMatch(raw) { var q = norm(raw), m = q.match(/^(?:hey |ok |okay |hi |hello )?(?:eleven|elevan|leven|11)\b[ ,.!]*(.*)$/); return m ? m[1].trim() : null; }
  function heard(raw) {
    if (!raw || !raw.trim()) return;
    var cmd = wakeMatch(raw), awake = Date.now() < st.awakeUntil || !!st.ctx;
    if (cmd !== null) {
      if (!cmd) { st.awakeUntil = Date.now() + 9000; ensureLog(); say('Yes? How can I help?', null, true, true); return; }
      ensureLog(); submit(cmd, true);
    } else if (awake) { st.awakeUntil = 0; ensureLog(); submit(raw, true); }
  }
  var hfFails = 0;
  function hfLoop() {
    if (!st.hf || !SR || st.speaking || st.rec) return;
    try {
      var r = makeRec(true); st.rec = r;
      r.onresult = function (e) { for (var i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) { hfFails = 0; heard(e.results[i][0].transcript); } };
      r.onerror = function (e) {
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { hfSet(false); status('Microphone blocked, so hands-free is off.'); }
        else if (e.error !== 'no-speech' && e.error !== 'aborted') hfFails++;
      };
      r.onend = function () { st.rec = null; if (st.hf && !st.speaking && hfFails < 6) setTimeout(hfLoop, 500); else if (hfFails >= 6) hfSet(false); };
      r.start();
    } catch (e) { st.rec = null; }
  }
  function hfSet(on) {
    st.hf = !!on && !!SR; pref.hf = st.hf; savePref(); hfFails = 0;
    $('#aiHf').setAttribute('aria-pressed', st.hf ? 'true' : 'false'); $('#aiFab').classList.toggle('hf', st.hf);
    if (st.hf) { status('Hands-free on. Just say \u201CEleven\u2026\u201D'); hfLoop(); } else { pauseRec(); if (!st.speaking) orb(''); }
  }
  function ensureLog() { if (!st.greeted) greet(); }

  /* ---------- language helpers ---------- */
  function norm(s) { return String(s).toLowerCase().replace(/[^a-z0-9\-\u20B9. ]+/g, ' ').replace(/\s+/g, ' ').trim(); }
  var NUMW = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, eighteen: 18, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, dozen: 12 };
  function numberWords(q) {
    q = q.replace(/\b(a )?half dozen\b/g, '6').replace(/\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|twelve|thirteen|fourteen|fifteen|sixteen|eighteen|twenty|thirty|forty|fifty|sixty|dozen)\b/g, function (w) { return NUMW[w]; });
    q = q.replace(/\b(\d+)\s+hundred\b/g, function (m, n) { return String(+n * 100); }).replace(/\b(\d+)\s+thousand\b/g, function (m, n) { return String(+n * 1000); });
    return q;
  }
  var STOP = 'products product items item range list catalogue price of the for what is mrp cost how much a an my show me tell about details flavour flavor flavours flavors available pack size sizes and in do you have rate per whats are does to can i please want need get any variants variant add put buy purchase order include into cart basket some or with'.split(' ');
  var SIZEU = /^(lb|lbs|pound|pounds|kg|kilo|kilos|kilogram|kilograms|g|gm|gms|gram|grams|ml|capsule|capsules|tablet|tablets|serving|servings|count)$/;
  var QTYU = /^(x|pcs|pc|pieces|piece|units|unit|nos|no|tubs|tub|jars|jar|bottles|bottle|packets|packet)$/;
  var BRAND_WORDS = { bolt: ['bolt', 'bolt nutrition'], ved: ['ved', 'vedayu', 'the vedayu'], wheymill: ['wheymill', 'whey mill'], eleo1ne: ['eleone', 'eleo1ne', 'eleone by bolt', 'eleo1ne by bolt'], pureluxe: ['pureluxe', 'pure luxe'], uenergy: ['uenergy', 'u-energy', 'u energy'] };
  function brandIn(q) {
    var best = null, pd = ' ' + q + ' ';
    Object.keys(BRAND_WORDS).forEach(function (id) { BRAND_WORDS[id].forEach(function (w) { if (pd.indexOf(' ' + w + ' ') > -1 && (!best || w.length > best.phrase.length)) best = { id: id, phrase: w }; }); });
    return best;
  }
  function sing(t) { return (t.length > 3 && /s$/.test(t) && !/ss$/.test(t)) ? t.slice(0, -1) : t; }
  function canon(s) { // "2 LB" -> "2lb", "Pack of 12" -> "packof12"
    s = norm(s).replace(/\(.*?\)/g, '').replace(/\u00d7/g, 'x').replace(/(\d)\s+(?=[a-z])/g, '$1').replace(/\bpounds?\b|\blbs\b/g, 'lb').replace(/\bkilograms?\b|\bkilos?\b/g, 'kg').replace(/\bgrams?\b|\bgms?\b/g, 'g').replace(/\bcapsule\b/g, 'capsules').replace(/\btablet\b/g, 'tablets').replace(/\bserving\b/g, 'servings');
    return s.replace(/\s+/g, '');
  }
  function sizeTokens(q) { // sizes mentioned in what the dealer said, as canonical strings
    var t = numberWords(norm(q)), out = [], m, re = /(\d+(?:\.\d+)?)\s*(lbs?|pounds?|kg|kilos?|kilograms?|gms?|grams?|g|ml|capsules?|tablets?|servings?|count)\b/g;
    while ((m = re.exec(t))) out.push(canon(m[1] + ' ' + m[2]));
    var re2 = /\b(pack|box|tube)\s+of\s+(\d+)/g; while ((m = re2.exec(t))) out.push(m[1] + 'of' + m[2]);
    if (/travel/.test(t)) out.push('travelpack');
    return out;
  }
  function matchVariant(text, variants) {
    var toks = sizeTokens(text), hit = null;
    variants.forEach(function (v) { var c = canon(v.label); toks.forEach(function (t) { if (c === t || (c.indexOf(t) === 0 && t.length > 3)) hit = v; }); });
    return hit;
  }
  function matchFlavour(text, flavours) {
    var t = ' ' + norm(text) + ' ', best = null, bs = 0;
    flavours.forEach(function (f) { var s = 0; norm(f).split(' ').forEach(function (w) { if (w.length > 3 && t.indexOf(' ' + w) > -1) s++; }); if (/unflavou?red|plain/.test(norm(f)) && /(unflavou?red|plain|no flavou?r)/.test(t)) s += 2; if (s > bs) { bs = s; best = f; } });
    return bs ? best : null;
  }
  function parseQty(q) {
    var t = numberWords(norm(q)).split(' ');
    for (var i = 0; i < t.length; i++) {
      var m = t[i].match(/^(\d+)x?$/); if (!m) continue;
      var nx = t[i + 1] || '', pv = t[i - 1] || '';
      if (SIZEU.test(nx) || pv === 'of') continue;
      return Math.min(999, +m[1]);
    }
    return 0;
  }
  function products(tokens, brand) {
    var out = [];
    Object.keys(SEL.CATALOG).forEach(function (bid) {
      if (brand && bid !== brand) return;
      SEL.CATALOG[bid].forEach(function (p) {
        var hay = ' ' + norm(p.name + ' ' + p.cat + ' ' + p.flavours.join(' ')) + ' ', sc = 0;
        tokens.forEach(function (t) { if (hay.indexOf(t) > -1) sc++; });
        if (sc > 0) out.push({ brand: bid, p: p, sc: sc });
      });
    });
    out.sort(function (a, b) { return b.sc - a.sc; }); return out;
  }
  function phraseTokens(q, brandPhrase) {
    var bw = brandPhrase ? brandPhrase.split(' ') : [];
    return numberWords(norm(q)).split(' ').filter(function (t) { return t && !/^\d/.test(t) && STOP.indexOf(t) < 0 && !SIZEU.test(t) && !QTYU.test(t) && bw.indexOf(t) < 0 && t.length > 1; }).map(sing);
  }
  function openOrders() { return A.getDealer() ? DB.listOrders(A.getDealer().code) : []; }
  function brandName(id) { var b = SEL.brandById(id); return b ? b.name : id; }
  function or(list) { return list.length < 2 ? list.join('') : list.slice(0, -1).join(', ') + ' or ' + list[list.length - 1]; }

  /* ---------- offers: suggest + "add N more to unlock" ---------- */
  function offerHints(lastLine) {
    var info = A.cartInfo(), sub = info.totals.subtotal, live = DB.listOffers().filter(function (o) { return DB.offerState(o) === 'live'; }), cur = info.coupon ? info.coupon.code : '';
    var unlocked = [], near = [], lines = [], acts = [];
    live.forEach(function (o) {
      if (o.code === cur) return;
      var miss = []; (o.requires || []).forEach(function (r) { var have = 0; info.cart.forEach(function (l) { if (l.pid === r.pid) have += l.qty; }); if (have < r.qty) miss.push({ pid: r.pid, need: r.qty - have, have: have }); });
      var short = o.min && sub < o.min ? o.min - sub : 0;
      if (!miss.length && !short) unlocked.push(o); else near.push({ o: o, miss: miss, short: short });
    });
    if (cur) lines.push('Coupon ' + cur + ' is applied to your cart.');
    unlocked.sort(function (a, b) { return b.amount - a.amount; });
    if (unlocked.length) { var u = unlocked[0]; lines.push('Good news: you qualify for ' + u.title + ' (' + u.code + '), flat ' + A.inr(u.amount) + ' off. Say "apply ' + u.code + '" to use it.'); acts.push({ label: 'Apply ' + u.code, type: 'apply', code: u.code }); st.lastCoupon = u.code; }
    var unit = lastLine ? lastLine.price : 0;
    near.forEach(function (n) {
      n.units = (n.short && unit) ? Math.ceil(n.short / unit) : 0;
      n.rank = n.miss.length ? (n.miss.some(function (m) { return m.have > 0; }) ? n.miss.length : 90) : (n.units || 99 + n.short / 1000);
    });
    near.sort(function (a, b) { return a.rank - b.rank; });
    near.slice(0, unlocked.length ? 1 : 2).forEach(function (n) {
      var o = n.o, txt;
      if (n.miss.length) {
        if (n.rank >= 90 && !(lastLine && n.miss.some(function (m) { return m.pid === lastLine.pid; }))) return;
        txt = 'Add ' + n.miss.map(function (m) { var f = SEL.findProduct(m.pid); return m.need + ' more ' + (f ? f.product.name : m.pid); }).join(' and ') + ' to unlock the ' + o.title + ' and save ' + A.inr(o.amount) + '.';
      } else if (n.units && n.units <= 40) {
        txt = 'Add ' + n.units + ' more ' + lastLine.product + ' to unlock ' + o.title + ' (' + o.code + ') and save ' + A.inr(o.amount) + '.';
      } else {
        txt = 'Add ' + A.inr(Math.ceil(n.short)) + ' more to unlock ' + o.title + ' (' + o.code + ') and save ' + A.inr(o.amount) + '.';
      }
      lines.push(txt);
    });
    if (near.length || unlocked.length) acts.push({ label: 'Open Offers', type: 'go', to: 'offers' });
    return { text: lines.join('\n'), actions: acts };
  }

  /* ---------- ordering by voice: slot filling (brand -> product -> flavour -> size -> quantity) ---------- */
  function finishAdd(c) {
    var f = SEL.findProduct(c.pid), v = null; f.product.variants.forEach(function (x) { if (x.id === c.vid) v = x; });
    A.addLine(c.pid, c.vid, c.flavour || '', c.qty);
    var short = f.product.name.split(' (')[0], price = A.priceOf(c.pid, c.vid, v.mrp), info = A.cartInfo(), h = offerHints({ pid: c.pid, price: price, product: short + ' ' + v.label });
    var t = 'Done. I added ' + c.qty + ' \u00D7 ' + brandName(f.brand) + ' ' + short + ', ' + v.label + (c.flavour ? ', ' + c.flavour : '') + ' to your cart, at ' + A.inr(price) + ' each. Your cart subtotal is ' + A.inr2(info.totals.subtotal) + '.';
    if (h.text) t += '\n' + h.text;
    st.ctx = null;
    return { text: t, actions: [{ label: 'Open cart', type: 'go', to: 'cart' }].concat(h.actions) };
  }
  function advance(c) {
    if (!c.pid) {
      var cands = products(c.tokens, c.brand);
      if (!cands.length) { st.ctx = null; return { text: 'I could not find that product. Tell me the brand and product, for example "BOLT whey protein".' }; }
      var top = cands[0].sc, best = cands.filter(function (x) { return x.sc === top; }), brands = [];
      best.forEach(function (x) { if (brands.indexOf(x.brand) < 0) brands.push(x.brand); });
      if (brands.length > 1 && !c.brand) { c.ask = 'brand'; c.options = brands; return { text: 'Sure. Which brand would you like \u2014 ' + or(brands.map(brandName)) + '? You can also tell me the flavour and size.', ask: true }; }
      var inb = best.filter(function (x) { return !c.brand || x.brand === c.brand; });
      if (!inb.length) inb = best;
      if (inb.length > 1) { c.ask = 'product'; c.options = inb.slice(0, 6).map(function (x) { return x.p.id; }); return { text: 'Which one \u2014 ' + or(inb.slice(0, 6).map(function (x) { return x.p.name; })) + '?', ask: true }; }
      c.pid = inb[0].p.id; c.brand = inb[0].brand;
    }
    var f = SEL.findProduct(c.pid), p = f.product;
    if (c.flavour === undefined) {
      if (p.flavours.length === 0) c.flavour = '';
      else if (p.flavours.length === 1) c.flavour = p.flavours[0];
      else { var fl = matchFlavour(c.text, p.flavours); if (fl) c.flavour = fl; }
    }
    if (c.flavour === undefined) { c.ask = 'flavour'; c.options = p.flavours.slice(); return { text: 'Which flavour for ' + brandName(f.brand) + ' ' + p.name + ' \u2014 ' + or(p.flavours) + '?', ask: true }; }
    if (!c.vid) {
      if (p.variants.length === 1) c.vid = p.variants[0].id;
      else { var v = matchVariant(c.text, p.variants); if (v) c.vid = v.id; }
    }
    if (!c.vid) { c.ask = 'size'; c.options = p.variants.map(function (x) { return x.id; }); return { text: 'What size would you like \u2014 ' + or(p.variants.map(function (x) { return x.label + ' at ' + A.inr(A.priceOf(p.id, x.id, x.mrp)); })) + '?', ask: true }; }
    if (!c.qty) { c.ask = 'qty'; c.options = []; return { text: 'How many would you like?', ask: true }; }
    return finishAdd(c);
  }
  function startAdd(raw) {
    var t = numberWords(norm(raw)), bm = brandIn(t), qty = parseQty(raw);
    var c = { qty: qty, brand: bm ? bm.id : '', tokens: phraseTokens(t, bm ? bm.phrase : ''), text: t, pid: '', ask: '', options: [] };
    if (!c.tokens.length && !c.brand) { return { text: 'What would you like to add? For example, "add 10 mass gainers".', ask: true }; }
    st.ctx = c; var r = advance(c); if (!r.ask && !r.actions) st.ctx = null; return r;
  }
  function ordinal(q) { var m = q.match(/\b(first|1st|second|2nd|third|3rd|fourth|4th|last)\b/); return m ? ({ first: 0, '1st': 0, second: 1, '2nd': 1, third: 2, '3rd': 2, fourth: 3, '4th': 3, last: -1 }[m[1]]) : null; }
  function continueAdd(raw) {
    var c = st.ctx, t = numberWords(norm(raw));
    if (/\b(cancel|never ?mind|forget it|stop|leave it|no thanks?)\b/.test(t)) { st.ctx = null; return { text: 'Okay, I have cancelled that.' }; }
    c.text += ' ' + t;
    var bm = brandIn(t); if (bm && !c.brand) c.brand = bm.id;
    var ord = ordinal(t), pick = null, asked = c.ask;
    if (asked === 'brand') { if (bm && c.options.indexOf(bm.id) > -1) c.brand = bm.id; else if (ord !== null) c.brand = c.options[ord < 0 ? c.options.length - 1 : ord] || ''; else c.brand = ''; }
    else if (asked === 'product') {
      var toks = phraseTokens(t, ''), bs = 0; c.options.forEach(function (id) { var nm = ' ' + norm(SEL.findProduct(id).product.name) + ' ', s = 0; toks.forEach(function (w) { if (nm.indexOf(w) > -1) s++; }); if (s > bs) { bs = s; pick = id; } });
      if (!pick && ord !== null) pick = c.options[ord < 0 ? c.options.length - 1 : ord];
      if (pick) c.pid = pick;
    }
    else if (asked === 'flavour') {
      var p = SEL.findProduct(c.pid).product, fl = matchFlavour(t, p.flavours); if (!fl && ord !== null) fl = p.flavours[ord < 0 ? p.flavours.length - 1 : ord]; if (fl) c.flavour = fl;
    }
    else if (asked === 'size') {
      var pr = SEL.findProduct(c.pid).product, v = matchVariant(t, pr.variants);
      if (!v) { var nm2 = t.match(/\b(\d+(?:\.\d+)?)\b/); if (nm2) pr.variants.forEach(function (x) { if (norm(x.label).split(' ')[0] === nm2[1]) v = x; }); }
      if (!v && ord !== null) v = pr.variants[ord < 0 ? pr.variants.length - 1 : ord]; if (v) c.vid = v.id;
    }
    else if (asked === 'qty') { var q = parseQty(raw) || (t.match(/\b(\d+)\b/) ? +t.match(/\b(\d+)\b/)[1] : 0); if (q) c.qty = q; }
    var r = advance(c);
    if (r.ask && c.ask === asked) r.text = 'Sorry, I did not catch that. ' + r.text;
    return r;
  }

  /* ---------- the brain ---------- */
  function answer(raw) {
    var q = norm(raw), d = A.getDealer(), go = function (label, to) { return { label: label, type: 'go', to: to }; };
    var support = [{ label: 'Call +91 90238 12338', href: 'tel:+919023812338' }, { label: 'Email info@s-eleven.com', href: 'mailto:info@s-eleven.com' }];
    var needLogin = { text: 'Please log in with your dealer code first, then I can help with your orders, prices and cart.' };
    if (!q) return { text: 'I am listening. What would you like to do?' };
    if (st.ctx) { if (!d) { st.ctx = null; return needLogin; } return continueAdd(raw); }
    if (/^(hi|hello|hey|namaste|hii|good (morning|afternoon|evening))\b/.test(q) && q.split(' ').length < 5) return { text: 'Hi' + (d ? ' ' + d.person : '') + '! I can add products to your cart, check orders and tracking, share live offers and tell you prices. What do you need?' };
    if (/\b(thank|thanks|shukriya|dhanyavad)\b/.test(q)) return { text: 'You are welcome! Anything else?' };
    if (/\b(bye|goodbye|see you)\b/.test(q)) return { text: 'Goodbye! I am here whenever you need me.' };
    if (/who are you|your name|what can you do|^help$/.test(q)) return { text: 'I am Eleven, your S-ELEVEN assistant. Try:\n\u2022 "Add 10 mass gainers to cart"\n\u2022 "Where is my latest order?"\n\u2022 "Any offers?"\n\u2022 "Apply FLASH500"\nI will tell you when an order or tracking status changes, and when offers go live.' };

    var hasAddVerb = /\b(add|put|buy|purchase|include)\b/.test(q), hasOrderVerb = /\b(order|get|want|need)\b/.test(q) && !/(track|status|where|deliver|dispatch|my order|latest order|last order|history|reorder|how|offer|coupon|code)/.test(q);
    if ((hasAddVerb || hasOrderVerb) && !/(coupon|promo|offer|code)/.test(q)) {
      var tk = phraseTokens(q, (brandIn(numberWords(q)) || {}).phrase || '');
      if (hasAddVerb || tk.length || parseQty(raw)) { if (!d) return needLogin; return startAdd(raw); }
    }
    if (/\bapply\b|use (the )?(coupon|code|offer)/.test(q)) {
      if (!d) return needLogin;
      var flat = numberWords(q).replace(/[\s\-]/g, ''), found = null;
      DB.listOffers().forEach(function (o) { if (o.code && flat.indexOf(o.code.toLowerCase()) > -1) found = o; });
      var code = found ? found.code : (/\b(it|that|this|the offer|the coupon)\b/.test(q) ? st.lastCoupon : '');
      if (!code) return { text: 'Which code should I apply? Say for example "apply FLASH500", or open Offers.', actions: [go('Open Offers', 'offers')], ask: true };
      var r = A.applyCoupon(code);
      if (r.error) return { text: r.error, actions: [go('Open Offers', 'offers')] };
      var info = A.cartInfo(); return { text: 'Applied ' + r.coupon.code + '. You save ' + A.inr2(info.totals.couponDiscount) + '. Your total is now ' + A.inr2(info.totals.total) + '.', actions: [go('Open cart', 'cart'), go('Checkout', 'checkout')] };
    }
    if (/\b(checkout|proceed to payment|pay now|place (the )?order)\b/.test(q)) { if (!d) return needLogin; var ci = A.cartInfo(); if (!ci.count) return { text: 'Your cart is empty. Tell me what to add, for example "add 5 whey protein".' }; A.go('checkout'); return { text: 'Opening checkout. Your total is ' + A.inr2(ci.totals.total) + '. Please check the delivery address and pay.' }; }
    if (/\b(open|go to|show|view|take me to)\b.*\b(cart|basket)\b|^(my )?cart$/.test(q)) { if (!d) return needLogin; A.go('cart'); var c2 = A.cartInfo(); return { text: c2.count ? 'Here is your cart: ' + c2.count + ' item(s), total ' + A.inr2(c2.totals.total) + '.' : 'Your cart is empty.' }; }
    var nav = q.match(/\b(open|go to|show|take me to)\b.*\b(offers|orders|updates|home|generate order)\b/);
    if (nav) { if (!d) return needLogin; var w = nav[2]; A.go(w === 'home' ? '' : (w === 'generate order' ? 'order' : w)); return { text: 'Opening ' + w + '.' }; }
    if (/(reorder|re-order|order again|repeat (my )?(last )?order)/.test(q) && /(last|latest|previous|again|repeat|reorder|re-order)/.test(q)) {
      if (!d) return needLogin; var lo = A.reorderLast(); if (!lo) return { text: 'You have no previous order to repeat yet.' };
      var inf = A.cartInfo(), hh = offerHints(null); return { text: 'I added all items from order ' + lo.id + ' to your cart. Subtotal ' + A.inr2(inf.totals.subtotal) + '.' + (hh.text ? '\n' + hh.text : ''), actions: [go('Open cart', 'cart')].concat(hh.actions) };
    }
    if (/(notification|notifications|alerts?)\b/.test(q) || (/\bany (new )?(news|updates)\b/.test(q) && !/order/.test(q))) {
      if (!d) return needLogin; var un = A.notifs().filter(function (n) { return !n.read; }), all = A.notifs();
      if (!all.length) return { text: 'No notifications yet. I will tell you as soon as an order status or tracking ID changes, or a new offer goes live.' };
      var show = (un.length ? un : all).slice(0, 4); A.markRead();
      return { text: (un.length ? un.length + ' new update(s):' : 'No new updates. Latest ones:') + '\n' + show.map(function (n) { return '\u2022 ' + n.title + (n.text ? ' \u2014 ' + n.text : ''); }).join('\n'), actions: [{ label: 'Open notifications', type: 'notifs' }] };
    }
    if (/catalog|brochure|pdf/.test(q)) return { text: 'Here are the brand catalogues. Tap one to open it.', actions: SEL.BRANDS.filter(function (b) { return b.catalogue; }).map(function (b) { return { label: b.name, href: b.catalogue }; }) };
    if (/(contact|call|phone|email|human|agent|representative|speak to|talk to|customer care|support)/.test(q) && !/order|track|where/.test(q)) return { text: 'You can reach the S-ELEVEN team on +91 90238 12338 or info@s-eleven.com.', actions: support };
    if (/(dealer code|become a dealer|new dealer|forgot|password|login|log in|sign in)/.test(q)) return { text: 'Dealer codes and passwords are created by S-ELEVEN when your dealer profile is set up. If you do not have one, or forgot your password, please contact the team.', actions: support };

    if (/\b(invoice|sales order|tax invoice|bill)\b/.test(q)) {
      if (!d) return needLogin; var ords = openOrders(), idm0 = raw.match(/SE-\d{6}-\d{4}/i), od = null;
      if (idm0) ords.forEach(function (x) { if (x.id.toUpperCase() === idm0[0].toUpperCase()) od = x; }); else od = ords[0];
      if (!od) return { text: 'You have no orders yet.' };
      var wantInv = /invoice|bill/.test(q);
      if (wantInv && od.payment.status !== 'Paid') return { text: 'Order ' + od.id + ' is awaiting payment, so its tax invoice will be issued once it is paid. I can open the sales order.', actions: [{ label: 'Sales order', type: 'doc', id: od.id, t: 'so' }] };
      return { text: 'Here is the ' + (wantInv ? 'tax invoice ' + od.invoice.no : 'sales order') + ' for order ' + od.id + '. Tap to open it.', actions: [{ label: wantInv ? 'Open invoice' : 'Open sales order', type: 'doc', id: od.id, t: wantInv ? 'inv' : 'so' }] };
    }
    var idm = raw.match(/SE-\d{6}-\d{4}/i);
    /* v31: also locate an order by any id the dealer actually has (DEMO-, H- and other formats), not only SE- ids */
    var _up = ' ' + String(raw).toUpperCase() + ' ', _idHit = null;
    if (!idm && d) { openOrders().forEach(function (x) { if (!_idHit && x.id && x.id.length >= 4 && _up.indexOf(x.id.toUpperCase()) > -1) _idHit = x; }); }
    if (idm || _idHit || (/(track|where is|where\'s|status|dispatch|dispatched|delivered|delivery|courier|tracking|awb|shipment|my order|latest order|last order)/.test(q) && !/(how (do|to|can)|place)/.test(q))) {
      if (!d) return needLogin;
      var orders = openOrders(), o = null;
      if (idm) orders.forEach(function (x) { if (x.id.toUpperCase() === idm[0].toUpperCase()) o = x; }); else if (_idHit) o = _idHit; else o = orders[0];
      if (!orders.length) return { text: 'You have no orders yet. Shall we place your first one?', actions: [go('Generate Order', 'order')] };
      if (!o) return { text: 'I could not find order ' + (idm ? idm[0].toUpperCase() : 'that') + ' on your account.', actions: [go('My Orders', 'orders')] };
      var sh = o.shipment, t = 'Order ' + o.id + ' (' + A.inr2(o.totals.total) + ', placed ' + A.fdate(o.date) + ') is ' + o.status + '.';
      if (sh && sh.trackingId) { var cr = DB.getCourier(sh.partner); t += '\nCourier: ' + (cr ? cr.name : sh.partner) + '\nTracking ID: ' + sh.trackingId; }
      else t += '\nIt has not been handed to a courier yet. I will tell you the moment the tracking ID is added.';
      return { text: t, actions: [{ label: 'Track order', type: 'track', id: o.id }, go('My Orders', 'orders')] };
    }
    if (/(offer|sale|deal|combo|saving|savings|discount|coupon|promo)/.test(q) && !/(how|not working)/.test(q)) {
      var live = DB.listOffers().filter(function (x) { return DB.offerState(x) === 'live'; }).sort(function (a, b) { return a.expiresAt - b.expiresAt; });
      if (!live.length) return { text: 'There are no live offers right now. I will tell you when a new one goes live.', actions: [go('Open Offers', 'offers')] };
      var tt = live.length + ' live offer(s), soonest ending first:\n' + live.slice(0, 5).map(function (x) { return '\u2022 ' + x.title + ', code ' + x.code + ', ends in ' + DB.countdown(x.expiresAt - Date.now()); }).join('\n');
      var hh2 = d ? offerHints(null) : { text: '', actions: [] }; if (hh2.text) tt += '\n' + hh2.text;
      return { text: tt, actions: [go('Open Offers', 'offers')].concat(hh2.actions) };
    }
    if (/(coupon|promo|code)/.test(q)) return { text: 'To use a coupon: add items, then in the cart type the code and tap Apply, or just say "apply" and the code. Combo codes need every listed product in the cart, and each offer has a minimum order and an expiry timer.', actions: [go('Open Offers', 'offers')] };
    if (/(how|where).*(place|make|create|generate).*order|how to order/.test(q)) return { text: 'Just say what you need, like "add 10 mass gainers to cart", and I will ask for the brand, flavour and size. Or open Generate Order and add products by hand.', actions: [go('Generate Order', 'order')] };
    if (/(payment|pay |upi|card|net ?banking|gateway|paid)/.test(q)) return { text: 'At checkout you scan our QR code or use our bank details to pay the total amount, then attach the payment screenshot. Our Finance team confirms it and your invoice follows. You get an order ID as soon as the order is placed.' };
    if (/(cart|basket)/.test(q)) { if (!d) return needLogin; var ca = A.cartInfo(); return ca.count ? { text: 'You have ' + ca.count + ' item(s) in your cart. Subtotal ' + A.inr2(ca.totals.subtotal) + (ca.coupon ? ', coupon ' + ca.coupon.code + ' applied' : '') + '.', actions: [go('Open cart', 'cart')] } : { text: 'Your cart is empty. Try saying "add 5 whey protein".', actions: [go('Generate Order', 'order')] }; }
    if (/(update|news|launch|announce|notice)/.test(q)) return { text: 'The Updates section has the latest from S-ELEVEN. The newest: UENERGY is launching soon.', actions: [go('Open Updates', 'updates')] };

    var bm = brandIn(numberWords(q)), toks = phraseTokens(q, bm ? bm.phrase : '');
    if (toks.length || bm) {
      var res = toks.length ? products(toks, bm ? bm.id : '') : [];
      if (!toks.length && bm) { var b0 = SEL.brandById(bm.id); return { text: b0.full + ' has ' + SEL.CATALOG[bm.id].length + ' product(s) in the portal.', actions: [{ label: 'Browse ' + b0.name, type: 'search', brand: bm.id, text: '' }].concat(b0.catalogue ? [{ label: 'Catalogue', href: b0.catalogue }] : []) }; }
      if (res.length) {
        var topn = res.slice(0, 2), lines = topn.map(function (r2) {
          var p = r2.p, packs = p.variants.map(function (v) { return v.label + ': MRP ' + A.inr(v.mrp) + (d ? ', your price ' + A.inr(A.priceOf(p.id, v.id, v.mrp)) : ''); }).join('\n  ');
          return brandName(r2.brand) + ' ' + p.name + '\n  ' + packs + (p.flavours.length ? '\n  Flavours: ' + p.flavours.join(', ') : '');
        });
        return { text: lines.join('\n\n') + (res.length > 2 ? '\n\nI found ' + res.length + ' matches. Name a brand to narrow it down.' : '') + (d ? '\nSay "add 5 of these" and I will ask for the rest.' : ''),
          actions: topn.map(function (r2) { return { label: 'Order ' + r2.p.name.split(' (')[0], type: 'search', brand: r2.brand, text: r2.p.name.split(' (')[0] }; }) };
      }
    }
    return { text: 'I am not sure I got that. I can add products to your cart, check orders and tracking, share offers and prices. For anything else, our team is a call away.', actions: support };
  }


  /* ---------- AI mode: a real language model (via your backend) that can use the portal as tools ---------- */
  var CFG = window.SEL_CONFIG || {};
  st.hist = []; st.pendingActs = []; st.lastLine = null; st.mode = 'text';
  function pageAct(label, to) { if (!st.pendingActs.some(function (a) { return a.label === label; })) st.pendingActs.push({ label: label, type: 'go', to: to }); }
  function orderOut(o) {
    var sh = o.shipment || {}, c = sh.partner ? DB.getCourier(sh.partner) : null;
    return { order_id: o.id, date: o.date.slice(0, 10), status: o.status, payment_status: o.payment.status, total_incl_gst: o.totals.total, taxable_value: o.totals.taxable, gst: { cgst: o.totals.cgst, sgst: o.totals.sgst, igst: o.totals.igst },
      invoice_no: o.invoice ? o.invoice.no : null, items: o.items.map(function (l) { return { product: l.product, pack: l.variant, flavour: l.flavour, quantity: l.qty, unit_price: l.price }; }),
      courier: c ? c.name : (sh.partner || null), tracking_id: sh.trackingId || null, tracking_url: sh.trackingId ? (DB.trackUrl(sh.partner, sh.trackingId) || null) : null, entered_by_team: !!(o.createdBy && o.createdBy.role !== 'dealer') };
  }
  function cartOut() {
    var i = A.cartInfo(); return { items: i.cart.map(function (l) { return { product_id: l.pid, variant_id: l.vid, product: l.product, pack: l.variant, flavour: l.flavour, quantity: l.qty, unit_price_incl_gst: l.price, mrp: l.mrp }; }),
      item_count: i.count, subtotal_incl_gst: i.totals.subtotal, coupon: i.coupon ? { code: i.coupon.code, discount: i.totals.couponDiscount } : null, total_payable: i.totals.total, taxable_value: i.totals.taxable, gst: { cgst: i.totals.cgst, sgst: i.totals.sgst, igst: i.totals.igst } };
  }
  function suggestionsData() {
    var info = A.cartInfo(), sub = info.totals.subtotal, cur = info.coupon ? info.coupon.code : '', out = { applied_coupon: cur || null, ready_to_apply: [], almost_unlocked: [] }, unit = st.lastLine ? st.lastLine.price : 0;
    DB.listOffers().filter(function (o) { return DB.offerState(o) === 'live' && o.code !== cur; }).forEach(function (o) {
      var miss = []; (o.requires || []).forEach(function (r) { var have = 0; info.cart.forEach(function (l) { if (l.pid === r.pid) have += l.qty; }); if (have < r.qty) { var f = SEL.findProduct(r.pid); miss.push({ product: f ? f.product.name : r.pid, quantity_needed: r.qty - have }); } });
      var short = o.min && sub < o.min ? Math.ceil(o.min - sub) : 0, base = { code: o.code, title: o.title, saves_rupees: o.amount, ends_in: DB.countdown(o.expiresAt - Date.now()) };
      if (!miss.length && !short) out.ready_to_apply.push(base);
      else { var x = Object.assign({}, base, { add_more_items: miss, add_more_rupees: short || null }); if (short && unit) x.about_units_of_last_added = { product: st.lastLine.product + ' ' + st.lastLine.pack, units: Math.ceil(short / unit) }; out.almost_unlocked.push(x); }
    });
    out.almost_unlocked.sort(function (a, b) { return (a.add_more_rupees || 1e9) - (b.add_more_rupees || 1e9); }); out.almost_unlocked = out.almost_unlocked.slice(0, 3); return out;
  }
  function findProd(id) { var f = SEL.findProduct(id); return f ? f : null; }
  var TOOLFN = {
    get_dealer_profile: function () { var d = A.getDealer(); return { dealer_code: d.code, business_name: d.name, contact: d.person, city: d.city, phone: d.phone, gstin: d.gst, pincode: d.pincode }; },
    search_products: function (i) {
      var q = norm(i.query || ''), toks = phraseTokens(q, ''), res = toks.length ? products(toks, i.brand || '') : (i.brand ? (SEL.CATALOG[i.brand] || []).map(function (p) { return { brand: i.brand, p: p, sc: 1 }; }) : []);
      return { matches: res.slice(0, 8).map(function (r) { var p = r.p; return { product_id: p.id, brand: brandName(r.brand), name: p.name, category: p.cat, flavours: p.flavours, packs: p.variants.map(function (v) { return { variant_id: v.id, label: v.label, mrp: v.mrp, your_price_incl_gst: A.priceOf(p.id, v.id, v.mrp) }; }) }; }), total_found: res.length };
    },
    get_cart: function () { pageAct('Open cart', 'cart'); return cartOut(); },
    add_to_cart: function (i) {
      var f = findProd(i.product_id); if (!f) return { error: 'Unknown product_id. Use search_products first.' };
      var p = f.product, v = p.variants.filter(function (x) { return x.id === i.variant_id; })[0], q = parseInt(i.quantity, 10), fl = i.flavour || '';
      if (!v) return { error: 'Unknown variant_id. Valid packs: ' + p.variants.map(function (x) { return x.id + ' (' + x.label + ')'; }).join(', ') };
      if (p.flavours.length && p.flavours.indexOf(fl) < 0) return { error: 'A flavour is required. Valid flavours: ' + p.flavours.join(', ') };
      if (!p.flavours.length) fl = '';
      if (!(q >= 1 && q <= 999)) return { error: 'quantity must be between 1 and 999' };
      A.addLine(p.id, v.id, fl, q); st.lastLine = { pid: p.id, price: A.priceOf(p.id, v.id, v.mrp), product: p.name.split(' (')[0], pack: v.label }; pageAct('Open cart', 'cart');
      return { ok: true, added: { product: p.name, pack: v.label, flavour: fl, quantity: q, unit_price_incl_gst: st.lastLine.price }, cart: cartOut() };
    },
    update_cart_item: function (i) { var f = findProd(i.product_id); if (!f) return { error: 'Unknown product_id' }; var hit = A.setQty(i.product_id, i.variant_id, i.flavour || '', parseInt(i.quantity, 10) || 0); pageAct('Open cart', 'cart'); return hit ? { ok: true, cart: cartOut() } : { error: 'That item is not in the cart', cart: cartOut() }; },
    clear_cart: function () { A.clearCart(); return { ok: true, cart: cartOut() }; },
    list_live_offers: function () { pageAct('Open Offers', 'offers'); return { offers: DB.listOffers().filter(function (o) { return DB.offerState(o) === 'live'; }).map(function (o) { return { code: o.code, section: DB.SECTIONS[o.section], title: o.title, description: o.text, saves_rupees: o.amount, minimum_order_incl_gst: o.min || null, requires: (o.requires || []).map(function (r) { var f = SEL.findProduct(r.pid); return { product: f ? f.product.name : r.pid, quantity: r.qty }; }), ends_in: DB.countdown(o.expiresAt - Date.now()) }; }) }; },
    get_offer_suggestions: function () { pageAct('Open Offers', 'offers'); return suggestionsData(); },
    apply_coupon: function (i) { var r = A.applyCoupon(i.code || ''); pageAct('Open cart', 'cart'); return r.error ? { error: r.error } : { ok: true, coupon: r.coupon.code, cart: cartOut() }; },
    remove_coupon: function () { A.removeCoupon(); return { ok: true, cart: cartOut() }; },
    list_orders: function (i) { var l = openOrders().filter(function (o) { return !i.status || o.status === i.status || (i.status === 'Awaiting payment' && o.payment.status !== 'Paid'); }).slice(0, Math.min(10, parseInt(i.limit, 10) || 5)); pageAct('My Orders', 'orders'); return { orders: l.map(orderOut) }; },
    get_order: function (i) { var o = DB.getOrder(A.getDealer().code, i.order_id); if (!o) return { error: 'Order not found for this dealer' }; pageAct('My Orders', 'orders'); return orderOut(o); },
    reorder: function (i) { var l = i.order_id ? DB.getOrder(A.getDealer().code, i.order_id) : openOrders()[0]; if (!l) return { error: 'No such order' }; l.items.forEach(function (x) { A.addLine(x.pid, x.vid, x.flavour, x.qty); }); pageAct('Open cart', 'cart'); return { ok: true, copied_from: l.id, cart: cartOut() }; },
    open_page: function (i) { var ok = ['home', 'order', 'orders', 'offers', 'updates', 'cart', 'checkout'].indexOf(i.page) > -1; if (!ok) return { error: 'Unknown page' }; A.go(i.page === 'home' ? '' : i.page); return { ok: true, opened: i.page, note: i.page === 'checkout' ? 'Checkout is open. The dealer must review the address and pay themselves.' : '' }; },
    open_document: function (i) { var o = DB.getOrder(A.getDealer().code, i.order_id); if (!o) return { error: 'Order not found' }; if (i.type === 'invoice' && o.payment.status !== 'Paid') return { error: 'No tax invoice yet: payment is pending for this order. The sales order is available.' }; st.pendingActs.push({ label: i.type === 'invoice' ? 'Open invoice' : 'Open sales order', type: 'doc', id: o.id, t: i.type === 'invoice' ? 'inv' : 'so' }); return { ok: true, note: 'A button to open the document has been shown to the dealer (the browser needs a tap to open it).' }; },
    open_tracking: function (i) { var o = DB.getOrder(A.getDealer().code, i.order_id); if (!o) return { error: 'Order not found' }; st.pendingActs.push({ label: 'Track order', type: 'track', id: o.id }); return { ok: true, order: orderOut(o) }; },
    list_notifications: function (i) { var l = A.notifs().filter(function (n) { return !i.unread_only || !n.read; }).slice(0, 8); return { notifications: l.map(function (n) { return { title: n.title, detail: n.text, type: n.type, read: n.read }; }) }; },
    get_catalogue_link: function (i) { var b = SEL.brandById(i.brand); return b && b.catalogue ? { brand: b.full, catalogue_pdf: b.catalogue } : { error: 'No catalogue for that brand yet' }; }
  };
  function S(type, desc, extra) { var o = { type: type, description: desc }; return Object.assign(o, extra || {}); }
  var TOOLS = [
    { name: 'get_dealer_profile', description: "The signed-in dealer's profile (code, business name, city, GSTIN).", input_schema: { type: 'object', properties: {} } },
    { name: 'search_products', description: 'Find products in the S-ELEVEN catalogue (49 products across BOLT, ved, WHEYMILL, Eleone, Pureluxe). Returns ids, packs, flavours, MRP and the dealer\'s own GST-inclusive purchase price.', input_schema: { type: 'object', properties: { query: S('string', 'Product words, e.g. "mass gainer", "omega 3"'), brand: S('string', 'Optional brand id', { enum: ['bolt', 'ved', 'wheymill', 'eleo1ne', 'pureluxe'] }) }, required: ['query'] } },
    { name: 'get_cart', description: "The dealer's current cart with totals (prices include GST).", input_schema: { type: 'object', properties: {} } },
    { name: 'add_to_cart', description: 'Add a product to the cart. You MUST have product_id, variant_id (pack size), flavour (if the product has flavours) and quantity; ask the dealer if any are missing.', input_schema: { type: 'object', properties: { product_id: S('string', 'From search_products'), variant_id: S('string', 'Pack id from search_products'), flavour: S('string', 'Exact flavour name, or empty string if none'), quantity: S('integer', 'Units, 1 to 999') }, required: ['product_id', 'variant_id', 'quantity'] } },
    { name: 'update_cart_item', description: 'Change the quantity of a cart line (0 removes it).', input_schema: { type: 'object', properties: { product_id: S('string', ''), variant_id: S('string', ''), flavour: S('string', ''), quantity: S('integer', 'New quantity; 0 removes') }, required: ['product_id', 'variant_id', 'quantity'] } },
    { name: 'clear_cart', description: 'Empty the cart. Ask the dealer to confirm first.', input_schema: { type: 'object', properties: {} } },
    { name: 'list_live_offers', description: 'Live offers (Live Sale, Combos, Super Savings) with codes, conditions and time left.', input_schema: { type: 'object', properties: {} } },
    { name: 'get_offer_suggestions', description: 'Offers the current cart already qualifies for, and offers that are almost unlocked, with how many more items or rupees are needed. Call after adding items.', input_schema: { type: 'object', properties: {} } },
    { name: 'apply_coupon', description: 'Apply an offer code to the cart.', input_schema: { type: 'object', properties: { code: S('string', 'Offer code') }, required: ['code'] } },
    { name: 'remove_coupon', description: 'Remove the coupon from the cart.', input_schema: { type: 'object', properties: {} } },
    { name: 'list_orders', description: "The dealer's orders, newest first, with status, payment status, invoice number, courier and tracking ID.", input_schema: { type: 'object', properties: { status: S('string', 'Optional: Placed, Processing, Dispatched, Out for delivery, Delivered, Awaiting payment'), limit: S('integer', 'Max orders, default 5') } } },
    { name: 'get_order', description: 'One order in detail.', input_schema: { type: 'object', properties: { order_id: S('string', 'e.g. SE-261019-1010') }, required: ['order_id'] } },
    { name: 'reorder', description: "Copy an earlier order's items into the cart (latest order if no id).", input_schema: { type: 'object', properties: { order_id: S('string', 'Optional') } } },
    { name: 'open_page', description: 'Open a portal page for the dealer. Checkout only opens the page; the dealer pays.', input_schema: { type: 'object', properties: { page: S('string', 'Page', { enum: ['home', 'order', 'orders', 'offers', 'updates', 'cart', 'checkout'] }) }, required: ['page'] } },
    { name: 'open_document', description: 'Offer the dealer a button to open the Sales Order or Tax Invoice of an order (invoice exists only after payment).', input_schema: { type: 'object', properties: { order_id: S('string', ''), type: S('string', '', { enum: ['sales_order', 'invoice'] }) }, required: ['order_id', 'type'] } },
    { name: 'open_tracking', description: 'Show the tracking window (status timeline, courier, tracking ID, courier link) for an order.', input_schema: { type: 'object', properties: { order_id: S('string', '') }, required: ['order_id'] } },
    { name: 'list_notifications', description: 'Recent notifications (order status, tracking, invoices, offers, posts).', input_schema: { type: 'object', properties: { unread_only: S('boolean', '') } } },
    { name: 'get_catalogue_link', description: 'Link to a brand catalogue PDF.', input_schema: { type: 'object', properties: { brand: S('string', '', { enum: ['bolt', 'ved', 'wheymill', 'eleo1ne', 'pureluxe'] }) }, required: ['brand'] } }
  ];
  function ctxInfo() { var d = A.getDealer(); return { dealer: d ? { code: d.code, name: d.name, city: d.city } : null, page: A.route ? A.route() : '', mode: st.mode, today: new Date().toISOString().slice(0, 10), cart_items: d ? A.cartInfo().count : 0, unread_notifications: d ? A.unread() : 0 }; }
  function trimHist() { while (st.hist.length > 30) { st.hist.shift(); while (st.hist.length && !(st.hist[0].role === 'user' && typeof st.hist[0].content === 'string')) st.hist.shift(); } }
  function postAI(body) {
    var opts = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
    try { if (window.AbortSignal && AbortSignal.timeout) opts.signal = AbortSignal.timeout(45000); } catch (e) {}
    return fetch(CFG.AI_ENDPOINT, opts).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  }
  function aiLoop(n) {
    if (n > 7) return Promise.resolve({ text: 'I could not finish that. Please try again.' });
    trimHist();
    return postAI({ messages: st.hist, tools: A.getDealer() ? TOOLS : [], context: ctxInfo() }).then(function (res) {
      var blocks = res.content || []; st.hist.push({ role: 'assistant', content: blocks });
      var uses = blocks.filter(function (b) { return b.type === 'tool_use'; });
      if (!uses.length) return { text: blocks.filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join('\n').trim() || 'Done.', actions: st.pendingActs.splice(0) };
      var results = uses.map(function (u) { var out; try { out = TOOLFN[u.name] ? TOOLFN[u.name](u.input || {}) : { error: 'Unknown tool ' + u.name }; } catch (e) { out = { error: String(e && e.message || e) }; } return { type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(out) }; });
      st.hist.push({ role: 'user', content: results });
      return aiLoop(n + 1);
    });
  }
  function aiSubmit(text, viaVoice) {
    st.mode = viaVoice ? 'voice' : 'text'; st.pendingActs = []; st.hist.push({ role: 'user', content: text });
    var typing = bubble('bot', '\u2026'), mark = st.hist.length;
    aiLoop(0).then(function (r) { typing.remove(); say(r.text, r.actions, viaVoice, /\?\s*$/.test(r.text.trim())); })
      .catch(function () {
        typing.remove(); st.hist.length = Math.max(0, mark - 1); var r; try { r = answer(text); } catch (e) { r = { text: 'Sorry, something went wrong. Please try again.' }; }
        say('(Offline mode) ' + r.text, r.actions, viaVoice, r.ask);
      });
  }

  /* ---------- conversation ---------- */
  function submit(text, viaVoice) {
    text = (text || '').trim(); if (!text) return;
    stopSpeaking(); bubble('me', A.esc(text)); $('#aiInput').value = ''; status('');
    if (CFG.AI_ENDPOINT && !st.ctx) { aiSubmit(text, viaVoice); return; }
    var typing = bubble('bot', '\u2026');
    setTimeout(function () {
      typing.remove(); var r;
      try { r = answer(text); } catch (e) { if (window.console) console.error(e); st.ctx = null; r = { text: 'Sorry, something went wrong on my side. Please try again.' }; }
      say(r.text, r.actions, viaVoice, r.ask);
    }, 320);
  }
  function greet() {
    st.greeted = true; var d = A.getDealer();
    say('Hi' + (d ? ' ' + d.person : '') + ', I am Eleven. Say or type what you need, for example "Eleven, add 10 mass gainers to cart". I will ask for the brand, flavour and size, suggest offers, and tell you when an order or tracking status changes.', null, false);
  }
  function openPanel() { st.open = true; $('#aiPanel').classList.add('open'); chips(); ensureLog(); setTimeout(function () { $('#aiInput').focus(); }, 50); }
  function closePanel() { st.open = false; $('#aiPanel').classList.remove('open'); stopListening(); stopSpeaking(); orb(''); if (st.hf) setTimeout(hfLoop, 200); }

  root.addEventListener('click', function (e) {
    var el = e.target.closest('[data-ai]'); if (!el) return; var k = el.getAttribute('data-ai');
    if (k === 'sugask') { var sb = document.getElementById('dsug'); if (sb) sb.classList.remove('show'); openPanel(); submit(el.getAttribute('data-q')); } else if (k === 'sugx') { var sb2 = document.getElementById('dsug'); if (sb2) sb2.classList.remove('show'); } else if (k === 'toggle') { var sb3 = document.getElementById('dsug'); if (sb3) sb3.classList.remove('show'); st.open ? closePanel() : openPanel(); }
    else if (k === 'close') closePanel();
    else if (k === 'mic') { if (st.rec && $('#aiMic').classList.contains('on')) stopListening(); else startListening(); }
    else if (k === 'voice') { st.voice = !st.voice; pref.speak = st.voice; savePref(); voiceBtn(); if (!st.voice) stopSpeaking(); else speakOut('Voice replies are on.'); }
    else if (k === 'hf') hfSet(!st.hf);
    else if (k === 'chip') submit(el.textContent);
    else if (k === 'act') {
      e.preventDefault(); var a = st.acts[+el.getAttribute('data-i')]; if (!a) return;
      if (a.type === 'go') { A.go(a.to); if (window.innerWidth < 700) closePanel(); }
      else if (a.type === 'track') A.track(a.id);
      else if (a.type === 'search') { A.search(a.brand, a.text); if (window.innerWidth < 700) closePanel(); }
      else if (a.type === 'apply') submit('apply ' + a.code);
      else if (a.type === 'notifs') A.openNotifs();
      else if (a.type === 'doc') A.openDoc(a.id, a.t);
    }
  });
  $('#aiVoiceSel').addEventListener('change', function (e) { pref.voice = e.target.value; savePref(); fillVoices(); speakOut('Hello, this is my voice.'); });
  $('#aiForm').addEventListener('submit', function (e) { e.preventDefault(); submit($('#aiInput').value); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && st.open) closePanel(); });


  /* ---- Eleven suggests something useful every minute ---- */
  var dsugIdx = 0;
  function dsuggestions() {
    var l = [], dl = null; try { dl = A.getDealer(); } catch (e) {} function add(t, q) { l.push({ t: t, q: q }); }
    try { var code = dl && (dl.code || dl.dealerCode); if (code) { var os = DB.listOrders(code), unpaid = os.filter(function (o) { return o.payment.status !== 'Paid' && !o.cancelled; }), transit = os.filter(function (o) { return DB.stageOf(o).idx === 7; }); if (unpaid.length) add(unpaid.length + ' of your order(s) are waiting for payment.', 'Show my pending orders'); if (transit.length) add(transit.length + ' order(s) are in transit. Track them under My Orders.', 'Track my orders'); } } catch (e) {}
    add('See today\u2019s live offers and combos.', 'Show offers'); add('Check your ledger balance.', 'What is my ledger balance'); add('Reorder your favourites quickly.', 'Reorder my last order'); add('Need a product that is out of stock? Make a preorder.', 'How do I make a preorder');
    return l;
  }
  function dsugTick() {
    var l = dsuggestions(); if (!l.length || st.open) return; var sg = l[dsugIdx % l.length]; dsugIdx++;
    var b = document.getElementById('dsug'); if (!b) { b = document.createElement('div'); b.id = 'dsug'; b.className = 'ai-sug'; b.setAttribute('role', 'status'); b.setAttribute('aria-live', 'polite'); root.appendChild(b); }
    b.innerHTML = '<b>Eleven suggests</b><span>' + String(sg.t).replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</span><div class="sugbtns"><button type="button" data-ai="sugask" data-q="' + String(sg.q).replace(/"/g, '&quot;') + '">Ask Eleven</button><button type="button" class="ghost" data-ai="sugx" aria-label="Dismiss">Not now</button></div>'; b.classList.add('show'); if (window.SelBot) SelBot.wave(); clearTimeout(b._t); b._t = setTimeout(function () { b.classList.remove('show'); }, 15000);
  }
  setTimeout(dsugTick, 8000); setInterval(dsugTick, 60000);
  window.Eleven = {
    ask: function (q) { if (!st.open) openPanel(); submit(q); },
    answer: answer, heard: heard,
    /* called by the portal when an order status / tracking ID / offer changes */
    notify: function (n) {
      var text = (n.title || '') + (n.text ? '. ' + n.text : '');
      bubble('bot', '<b>' + A.esc(n.title) + '</b><br>' + A.esc(n.text || '') + '<div>' + actHtml(n.type === 'order' ? [{ label: 'Track order', type: 'track', id: n.orderId }] : [{ label: 'Open Offers', type: 'go', to: 'offers' }]) + '</div>');
      if (st.voice && !document.hidden) speakOut(n.say || text);
    },
    reset: function () { $('#aiBody').innerHTML = ''; st.greeted = false; st.acts = []; st.ctx = null; st.hist = []; closePanel(); chips(); },
    aiMode: function () { return !!CFG.AI_ENDPOINT; }, _tools: function () { return TOOLS; },
    _ctx: function () { return st.ctx; }, _voice: pickVoice
  };
  chips();
  if (pref.hf && SR) { try { if (navigator.permissions && navigator.permissions.query) navigator.permissions.query({ name: 'microphone' }).then(function (p) { if (p.state === 'granted') hfSet(true); }); } catch (e) {} }
})();
