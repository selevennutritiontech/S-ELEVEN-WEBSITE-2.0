/* Share a Sales Order, Invoice or E-way bill: native Share (attaches the PDF on phones and supported browsers), WhatsApp, Email, Download, Copy.
   Works in the dealer portal and the admin console. The Sales Order PDF is generated here; the invoice and e-way bill are the files that were uploaded. */
(function () {
  'use strict';
  var KIND = { so: 'Sales Order', inv: 'Invoice', eway: 'E-way bill' };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function money(n) { return 'Rs. ' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function ascii(s) { return String(s == null ? '' : s).replace(/\u20B9/g, 'Rs.').replace(/[\u2013\u2014]/g, '-').replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/[^\x20-\x7E]/g, '?'); }
  function pad(s, n, right) { s = ascii(s); if (s.length > n) s = s.slice(0, n - 1) + '.'; while (s.length < n) s = right ? ' ' + s : s + ' '; return s; }
  function wrap(s, n) { var out = [], line = ''; ascii(s).split(/\s+/).forEach(function (w) { if ((line + ' ' + w).trim().length > n) { out.push(line.trim()); line = w; } else line = (line + ' ' + w).trim(); }); if (line) out.push(line); return out; }
  function dmy(iso) { var d = new Date(iso); return isNaN(d) ? '' : ('0' + d.getDate()).slice(-2) + '/' + ('0' + (d.getMonth() + 1)).slice(-2) + '/' + d.getFullYear(); }
  function find(code, id) { try { if (window.DB) { if (code && DB.getOrder) { var o = DB.getOrder(code, id); if (o) return o; } if (DB.allOrders) { var l = DB.allOrders().filter(function (x) { return x.id === id; }); if (l.length) return l[0]; } } } catch (e) {} return null; }
  /* ---- a small PDF writer (Courier text, A4, several pages) so the Sales Order is a real PDF ---- */
  function makePdf(blocks) {
    var pages = [], cur = [], y = 806; blocks.forEach(function (b) { var lead = b.size * 1.4; if (y - lead < 40) { pages.push(cur); cur = []; y = 806; } cur.push({ t: b.s, size: b.size, bold: b.bold, y: y }); y -= lead + (b.gap || 0); }); pages.push(cur);
    var objs = [], n = 0; function add(s) { objs[++n] = s; return n; }
    add('<< /Type /Catalog /Pages 2 0 R >>'); add(''); add('<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>'); add('<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold >>');
    var kids = []; pages.forEach(function (pg) { var c = 'BT\n' + pg.map(function (l) { return '/' + (l.bold ? 'F2' : 'F1') + ' ' + l.size + ' Tf 1 0 0 1 36 ' + l.y.toFixed(1) + ' Tm (' + l.t.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)') + ') Tj'; }).join('\n') + '\nET', cn = add('<< /Length ' + c.length + ' >>\nstream\n' + c + '\nendstream'), pn = add('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ' + cn + ' 0 R >>'); kids.push(pn + ' 0 R'); });
    objs[2] = '<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + kids.length + ' >>';
    var out = '%PDF-1.4\n', off = []; for (var i = 1; i <= n; i++) { off[i] = out.length; out += i + ' 0 obj\n' + objs[i] + '\nendobj\n'; } var x = out.length; out += 'xref\n0 ' + (n + 1) + '\n0000000000 65535 f \n'; for (i = 1; i <= n; i++) out += ('0000000000' + off[i]).slice(-10) + ' 00000 n \n'; out += 'trailer\n<< /Size ' + (n + 1) + ' /Root 1 0 R >>\nstartxref\n' + x + '\n%%EOF\n';
    var u = new Uint8Array(out.length); for (i = 0; i < out.length; i++) u[i] = out.charCodeAt(i) & 255; return u;
  }
  function addrPin(a, p) { a = String(a || ''); return a + (p && a.indexOf(String(p)) < 0 ? ' - ' + p : ''); }
  function soBlocks(o) {
    var t = o.totals || {}, b = o.buyer || {}, s = o.ship || {}, B = [], line = function (x, sz, bold, gap) { B.push({ s: ascii(x), size: sz || 9, bold: !!bold, gap: gap || 0 }); };
    line('S-ELEVEN NUTRITION PVT. LTD.', 15, true); line('SALES ORDER', 12, true, 6); line('SO No: ' + o.id + '      Date: ' + dmy(o.date), 10, false, 6);
    line('Buyer: ' + (b.name || o.dealerName || ''), 10, true); line('GSTIN: ' + (b.gst || 'Unregistered') + '    Phone: ' + (b.phone || o.phone || ''), 9); wrap('Address: ' + addrPin(b.address || o.address, b.pin || o.pin), 92).forEach(function (l) { line(l, 9); });
    if (s.address && s.address !== b.address) { line('Ship to:', 9, true); wrap(addrPin(s.address, s.pin), 92).forEach(function (l) { line(l, 9); }); }
    line('', 6); line(pad('#', 3) + pad('Product', 34) + pad('Pack', 9) + pad('Flavour', 16) + pad('Qty', 5, 1) + pad('Rate', 12, 1) + pad('Amount', 13, 1), 8, true); line(new Array(93).join('-'), 8);
    (o.items || []).forEach(function (l, i) { line(pad(i + 1, 3) + pad(String(l.product || '').split(' (')[0], 34) + pad(l.variant, 9) + pad(l.flavour, 16) + pad(l.qty, 5, 1) + pad(Number(l.price).toFixed(2), 12, 1) + pad((l.price * l.qty).toFixed(2), 13, 1), 8); });
    (o.freebies || []).forEach(function (f) { line(pad('', 3) + pad('FREE: ' + f.name, 59) + pad(f.qty, 5, 1) + pad('0.00', 12, 1) + pad('0.00', 13, 1), 8); }); line(new Array(93).join('-'), 8, false, 4);
    var row = function (k, v) { line(pad(k, 70, 1) + pad(v, 22, 1), 9); };
    row('Subtotal (prices include GST):', money(t.subtotal)); if (t.couponDiscount) row('Coupon discount:', '- ' + money(t.couponDiscount)); if (t.taxable != null) row('Taxable value:', money(t.taxable)); if (t.cgst) { row('CGST:', money(t.cgst)); row('SGST:', money(t.sgst)); } if (t.igst) row('IGST:', money(t.igst)); if (t.freight) row('Freight (logistics):', money(t.freight));
    line('', 6); line(pad('TOTAL PAYABLE:', 70, 1) + pad(money(t.total), 22, 1), 11, true, 4); if (window.Docs && Docs.words) { try { wrap('Amount in words: ' + Docs.words(t.total), 92).forEach(function (l) { line(l, 9); }); } catch (e) {} }
    line('Payment: ' + (o.payment && o.payment.status === 'Paid' ? 'Paid' + (o.payment.paidAt ? ' on ' + dmy(o.payment.paidAt) : '') : 'Pending'), 9, false, 4); line('Dispatch is within 36 hours of payment.', 9); line('Computer-generated sales order.', 8);
    return B;
  }
  function fileFor(o, kind) {
    if (kind === 'so') { var u = makePdf(soBlocks(o)); return { bytes: u, name: 'Sales-Order-' + o.id + '.pdf', type: 'application/pdf' }; }
    var f = kind === 'inv' ? o.invoiceFile : o.ewayFile; if (!f || !f.data) return null; var m = /^data:([^;]+);base64,(.*)$/.exec(f.data); if (!m) return null; var bin = atob(m[2]), u8 = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); return { bytes: u8, name: f.name || ((kind === 'inv' ? 'Invoice-' : 'E-way-bill-') + o.id + '.pdf'), type: m[1] || 'application/pdf' };
  }
  function message(o, kind) { var t = o.totals || {}, inv = o.invoice && o.invoice.no ? ' (Invoice ' + o.invoice.no + ')' : ''; return 'S-ELEVEN Nutrition Pvt. Ltd.\n' + KIND[kind] + ' for order ' + o.id + inv + (o.dealerName ? '\nDealer: ' + o.dealerName : '') + '\nAmount: ' + money(t.total) + '\nDate: ' + dmy(o.date) + '\nThe PDF is attached.'; }
  function css() { if (document.getElementById('shr-css')) return; var s = document.createElement('style'); s.id = 'shr-css'; s.textContent = '.shr-ov{position:fixed;inset:0;background:rgba(10,20,50,.5);z-index:300;display:grid;place-items:center;padding:14px}.shr-m{background:#fff;border-radius:20px;max-width:30rem;width:100%;padding:20px 22px;box-shadow:0 30px 70px -20px rgba(10,20,50,.6);font:15px/1.45 system-ui,Segoe UI,Roboto,sans-serif;color:#0d2557;max-height:92vh;overflow:auto}.shr-m h2{margin:0 0 4px;font-size:1.15rem}.shr-m p{margin:6px 0;color:#4a5a78;font-size:.86rem}.shr-m label{display:block;font-weight:700;font-size:.8rem;margin-top:10px}.shr-m input{width:100%;box-sizing:border-box;padding:12px;border:1.5px solid #cfd8ea;border-radius:12px;font:inherit;min-height:44px}.shr-g{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:14px}.shr-b{min-height:46px;border:0;border-radius:14px;background:#1d4ba8;color:#fff;font:inherit;font-weight:700;cursor:pointer;padding:10px 12px}.shr-b.g{background:#25d366}.shr-b.o{background:#eef3fc;color:#1d4ba8}.shr-b.w{grid-column:1/-1}.shr-st{min-height:1.2em;font-weight:700;color:#0b7a46;margin-top:8px;font-size:.84rem}.shrbtn{margin-left:6px}'; document.head.appendChild(s); }
  function download(f) { var a = document.createElement('a'), url = URL.createObjectURL(new Blob([f.bytes], { type: f.type })); a.href = url; a.download = f.name; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 800); }
  function open(o, kind) {
    var f = fileFor(o, kind); if (!f) { alert('The ' + KIND[kind] + ' has not been uploaded yet, so there is nothing to share.'); return; } css(); var msg = message(o, kind), file = null; try { file = new File([f.bytes], f.name, { type: f.type }); } catch (e) {}
    var ph = String((o.buyer && o.buyer.phone) || o.phone || '').replace(/\D/g, ''), ov = document.createElement('div'); ov.className = 'shr-ov'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true');
    ov.innerHTML = '<div class="shr-m"><h2>Share ' + esc(KIND[kind]) + ' ' + esc(o.id) + '</h2><p>' + esc(f.name) + ' \u00B7 ' + Math.max(1, Math.round(f.bytes.length / 1024)) + ' KB</p><label for="shr-ph">WhatsApp number (optional)</label><input id="shr-ph" inputmode="tel" value="' + esc(ph) + '" placeholder="10-digit mobile number"><label for="shr-em">Email address (optional)</label><input id="shr-em" type="email" placeholder="name@company.com"><div class="shr-g"><button class="shr-b w" type="button" data-s="native">Share\u2026 (attaches the PDF)</button><button class="shr-b g" type="button" data-s="wa">WhatsApp</button><button class="shr-b o" type="button" data-s="mail">Email</button><button class="shr-b o" type="button" data-s="dl">Download PDF</button><button class="shr-b o" type="button" data-s="copy">Copy message</button><button class="shr-b o w" type="button" data-s="x">Close</button></div><div class="shr-st" id="shr-st" role="status"></div><p>WhatsApp and Email open with the message ready. Use <b>Share\u2026</b> to attach the PDF automatically (phones and supported browsers), or download the PDF and attach it.</p></div>';
    document.body.appendChild(ov); var st = function (t) { ov.querySelector('#shr-st').textContent = t; };
    ov.addEventListener('click', function (e) { if (e.target === ov) ov.remove(); var b = e.target.closest('[data-s]'); if (!b) return; var a = b.getAttribute('data-s');
      if (a === 'x') ov.remove();
      else if (a === 'dl') { download(f); st('Downloaded ' + f.name); }
      else if (a === 'copy') { var done = function () { st('Message copied'); }; if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(msg).then(done, function () { st('Could not copy'); }); else { var ta = document.createElement('textarea'); ta.value = msg; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); done(); } catch (x) { st('Could not copy'); } ta.remove(); } }
      else if (a === 'wa') { var n = ov.querySelector('#shr-ph').value.replace(/\D/g, ''); if (n.length === 10) n = '91' + n; window.SelWA.open(n, msg); st('The WhatsApp tab opened. Attach the downloaded PDF there if it is not attached.'); }
      else if (a === 'mail') { var em = ov.querySelector('#shr-em').value.trim(); location.href = 'mailto:' + encodeURIComponent(em).replace('%40', '@') + '?subject=' + encodeURIComponent(KIND[kind] + ' ' + o.id + ' - S-ELEVEN Nutrition') + '&body=' + encodeURIComponent(msg); st('Email opened. Attach the downloaded PDF.'); }
      else if (a === 'native') { if (file && navigator.canShare && navigator.canShare({ files: [file] })) navigator.share({ files: [file], title: KIND[kind] + ' ' + o.id, text: msg }).then(function () { st('Shared'); }, function (er) { if (er && er.name !== 'AbortError') st('Sharing was not completed'); }); else if (navigator.share) { navigator.share({ title: KIND[kind] + ' ' + o.id, text: msg }).then(function () { download(f); st('Message shared. The PDF was downloaded so you can attach it.'); }, function () {}); } else { download(f); st('This browser cannot attach files to a share. The PDF was downloaded; use WhatsApp or Email above.'); } }
    });
    document.addEventListener('keydown', function esc2(e) { if (e.key === 'Escape') { ov.remove(); document.removeEventListener('keydown', esc2); } });
  }
  /* a Share button appears beside every document button, as soon as the document exists */
  var busy = false;
  function enhance() {
    if (busy) return; busy = true; try {
      document.querySelectorAll('[data-a="doc"]:not([data-shr]),[data-act="doc"]:not([data-shr])').forEach(function (el) {
        var kind = el.getAttribute('data-t'); if (!KIND[kind]) return; var id = el.getAttribute('data-id'), code = el.getAttribute('data-c'), o = find(code, id); el.setAttribute('data-shr', '1'); if (!o) return; if (kind !== 'so' && !fileFor(o, kind)) { el.removeAttribute('data-shr'); return; }
        var b = document.createElement('button'); b.type = 'button'; b.className = (el.className || 'btn ghost sm').replace(/\bghost\b/g, '').replace(/\s+/g, ' ') + ' shrbtn ghost'; b.textContent = 'Share'; b.setAttribute('aria-label', 'Share ' + KIND[kind] + ' ' + id); b.setAttribute('data-shr-k', kind); b.setAttribute('data-shr-id', id); if (code) b.setAttribute('data-shr-c', code); el.parentNode.insertBefore(b, el.nextSibling);
      });
    } finally { busy = false; }
  }
  document.addEventListener('click', function (e) { var b = e.target.closest('.shrbtn'); if (!b) return; e.preventDefault(); e.stopPropagation(); var o = find(b.getAttribute('data-shr-c'), b.getAttribute('data-shr-id')); if (o) open(o, b.getAttribute('data-shr-k')); }, true);
  var tm = null; function later() { clearTimeout(tm); tm = setTimeout(enhance, 120); }
  if (window.MutationObserver) new MutationObserver(later).observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', later);

  /* one WhatsApp tab for the whole portal: the first Share opens WhatsApp Web (sign in once by scanning the QR code); every later Share reuses that same tab */
  window.SelWA = {
    win: null,
    mode: function () { try { return localStorage.getItem('sel.v2.wamode') === 'app' ? 'app' : 'web'; } catch (e) { return 'web'; } },
    setMode: function (m) { try { localStorage.setItem('sel.v2.wamode', m === 'app' ? 'app' : 'web'); } catch (e) {} },
    num: function (phone) { var n = String(phone || '').replace(/\D/g, ''); if (n.length === 10) n = '91' + n; return n; },
    url: function (phone, text) { var n = this.num(phone); return 'https://web.whatsapp.com/send?' + (n ? 'phone=' + n + '&' : '') + 'text=' + encodeURIComponent(text || ''); },
    appUrl: function (phone, text) { var n = this.num(phone); return 'whatsapp://send?' + (n ? 'phone=' + n + '&' : '') + 'text=' + encodeURIComponent(text || ''); },
    /* Web mode: keep a handle on the WhatsApp tab this portal opened and send every chat to THAT tab (WhatsApp Web can rename its own tab, so a plain "open by name" would start a new tab each time).
       App mode: hand the chat to the WhatsApp Desktop app that is already signed in on this computer (no tab at all). */
    hasExt: function () { return document.documentElement.getAttribute('data-sel-wa-ext') === '1'; },
    isMobile: function () { var u = navigator.userAgent || ''; return /iPhone|iPad|iPod|Android/i.test(u) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); },
    mobileUrl: function (phone, text) { var n = this.num(phone); return 'https://wa.me/' + n + '?text=' + encodeURIComponent(text || ''); },
    open: function (phone, text) {
      /* phones and tablets: the link opens the WhatsApp app itself, so there is no tab to reuse */
      if (this.isMobile()) { var m = document.createElement('a'); m.href = this.mobileUrl(phone, text); m.target = '_blank'; m.rel = 'noopener'; m.style.display = 'none'; document.body.appendChild(m); m.click(); setTimeout(function () { m.remove(); }, 600); return true; }
      /* the S-ELEVEN WhatsApp Helper extension finds the WhatsApp tab you already have open and uses it */
      if (this.mode() !== 'app' && this.hasExt()) { window.postMessage({ sel: 'wa', cmd: 'open', url: this.url(phone, text) }, '*'); return true; }
      if (this.mode() === 'app') { var a = document.createElement('a'); a.href = this.appUrl(phone, text); a.style.display = 'none'; document.body.appendChild(a); a.click(); setTimeout(function () { a.remove(); }, 600); return true; }
      var url = this.url(phone, text), w = this.win;
      if (w && !w.closed) { try { w.location.href = url; w.focus(); return true; } catch (e) {} }
      w = window.open(url, 'sel_whatsapp'); if (w) { this.win = w; try { w.focus(); } catch (e) {} return true; }
      alert('Allow pop-ups for this page so the WhatsApp tab can open.'); return false;
    }
  };
  window.Share = { open: open, makePdf: makePdf, soBlocks: soBlocks, fileFor: fileFor, message: message };
})();
