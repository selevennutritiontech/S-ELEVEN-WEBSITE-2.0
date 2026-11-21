/* S-ELEVEN documents: Sales Order and Tax Invoice (same layout as the company's blank invoice).
   Prices are GST-inclusive; the base value and GST are shown separately. DEMO: the IRN is a hash of the
   invoice details and the QR is a placeholder - a real e-invoice IRN/QR must come from the GST e-invoice portal. */
(function () {
  'use strict';
  var CO = {
    name: 'S-ELEVEN NUTRITION PVT. LTD', addr: '13th Floor 1314,1315,1316, I Square , Science City Road, Ahmedabad - 380060', state: 'Gujarat', code: '24',
    pan: 'ABNCS8061J', gstin: '24ABNCS8061J1ZV', cin: 'U46909GJ2024PTC153011', phone: '+91 90238 12338', email: 'finance@s-eleven.com',
    wh: { lines: ['Plot no.06, Industrial Shed City Survey', 'No.NA2106/1/6, near Gayatri farm house', 'Khatraj road, Shantej, 382721', 'Dist-Gandhinagar'], phone: '+91 6353 492 805', email: 'finance@s-eleven.com' },
    bank: { holder: 'S-ELEVEN NUTRITION PVT. LTD', name: 'IDFC FIRST BANK', ac: '10191031671', ifsc: 'SCIENCE CITY ROAD & IDFB0040319' }
  };
  var HSN = '21069099';   /* PLACEHOLDER: confirm the right HSN code per product with your CA */
  var DEMO_WATERMARK = true;
  var DECL = [
    ['Advance Payment', 'Payment shall be made in advance as per the payment terms mentioned in the invoice.'],
    ['GST', 'GST has been charged as per the applicable rules and rates prescribed by the Government. In case of any change in the GST rate, billing will be done accordingly.'],
    ['Invoice Validity', 'This Tax Invoice shall be considered a valid tax document for the sale of goods/services.'],
    ['Goods Acceptance', 'Upon receipt of the goods, the customer shall verify the quantity, product, batch details, and packaging.'],
    ['Damage / Shortage', 'In case of any shortage, damage, or leakage observed at the time of delivery, the customer must inform the company at the time of delivery or within a maximum of 24 hours, along with the necessary supporting evidence.'],
    ['Return / Replacement', "No product return or replacement will be accepted without the company's prior approval."],
    ['Expiry', 'Expired or near-expiry products will generally not be accepted for return or replacement, unless prior written approval is provided by the company.'],
    ['Price & MRP', 'The price and MRP mentioned in the invoice shall be applicable as per the relevant order and prevailing company pricing. Price/MRP may be revised due to changes in company policy, raw material costs, GST, or government regulations.'],
    ['Transportation & Delivery', "The company shall not be responsible for any delay related to transportation or logistics if such delay occurs due to circumstances beyond the company's reasonable control."],
    ['Outstanding Payment', 'In case of any outstanding payment, the company reserves the right to hold or stop the processing and/or dispatch of future orders until the outstanding amount is cleared.'],
    ['Dispute', 'Any dispute relating to the invoice must be reported by the customer to the company within 7 days from the date of receipt of the invoice.'],
    ['Jurisdiction', "In case of any dispute or disagreement, the jurisdiction of the company's registered office shall apply."]
  ];
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function r2(n) { return Math.round(n * 100) / 100; }
  function n2(n) { return Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function dmy(iso) { var d = new Date(iso), m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']; return d.getDate() + '-' + m[d.getMonth()] + '-' + String(d.getFullYear()).slice(2); }
  function fy(iso) { var d = new Date(iso), y = d.getFullYear(), s = d.getMonth() >= 3 ? y : y - 1; return String(s) + '-' + String(s + 1); }

  /* ----- amount in words (Indian system) ----- */
  var ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'], TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  function two(n) { return n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : ''); }
  function three(n) { return (n >= 100 ? ONES[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' : '') : '') + (n % 100 ? two(n % 100) : ''); }
  function words(amount) {
    var rup = Math.floor(amount + 1e-9), paise = Math.round((amount - rup) * 100), out = [];
    var cr = Math.floor(rup / 10000000), lk = Math.floor(rup / 100000) % 100, th = Math.floor(rup / 1000) % 100, rest = rup % 1000;
    if (cr) out.push(three(cr) + ' Crore'); if (lk) out.push(two(lk) + ' Lakh'); if (th) out.push(two(th) + ' Thousand'); if (rest) out.push(three(rest));
    var s = 'INR ' + (out.join(' ') || 'Zero'); if (paise) s += ' and ' + two(paise) + ' Paise'; return s + ' Only';
  }

  /* ----- demo IRN (sha-256, same formula the GST portal uses) ----- */
  function sha256(ascii) {
    function rr(v, a) { return (v >>> a) | (v << (32 - a)); } var mw = Math.pow(2, 32), res = '', words = [], abl = ascii.length * 8, i, j, h = sha256.h = sha256.h || [], k = sha256.k = sha256.k || [], pc = k.length, ic = {};
    for (var c = 2; pc < 64; c++) { if (!ic[c]) { for (i = 0; i < 313; i += c) ic[i] = c; h[pc] = (Math.pow(c, .5) * mw) | 0; k[pc++] = (Math.pow(c, 1 / 3) * mw) | 0; } }
    ascii += '\x80'; while (ascii.length % 64 - 56) ascii += '\x00';
    for (i = 0; i < ascii.length; i++) { j = ascii.charCodeAt(i); if (j >> 8) return ''; words[i >> 2] |= j << ((3 - i) % 4) * 8; }
    words[words.length] = ((abl / mw) | 0); words[words.length] = abl;
    for (j = 0; j < words.length;) {
      var w = words.slice(j, j += 16), oh = h; h = h.slice(0, 8);
      for (i = 0; i < 64; i++) {
        var w15 = w[i - 15], w2 = w[i - 2], a = h[0], e = h[4];
        var t1 = h[7] + (rr(e, 6) ^ rr(e, 11) ^ rr(e, 25)) + ((e & h[5]) ^ ((~e) & h[6])) + k[i] + (w[i] = (i < 16) ? w[i] : (w[i - 16] + (rr(w15, 7) ^ rr(w15, 18) ^ (w15 >>> 3)) + w[i - 7] + (rr(w2, 17) ^ rr(w2, 19) ^ (w2 >>> 10))) | 0);
        var t2 = (rr(a, 2) ^ rr(a, 13) ^ rr(a, 22)) + ((a & h[1]) ^ (a & h[2]) ^ (h[1] & h[2]));
        h = [(t1 + t2) | 0].concat(h); h[4] = (h[4] + t1) | 0;
      }
      for (i = 0; i < 8; i++) h[i] = (h[i] + oh[i]) | 0;
    }
    for (i = 0; i < 8; i++) for (j = 3; j + 1; j--) { var b = (h[i] >> (j * 8)) & 255; res += ((b < 16) ? 0 : '') + b.toString(16); }
    return res;
  }
  function qrPlaceholder(hex) {
    var n = 29, cells = '', bit = 0;
    function finder(x, y) { return '<rect x="' + x + '" y="' + y + '" width="7" height="7" fill="#000"/><rect x="' + (x + 1) + '" y="' + (y + 1) + '" width="5" height="5" fill="#fff"/><rect x="' + (x + 2) + '" y="' + (y + 2) + '" width="3" height="3" fill="#000"/>'; }
    for (var y = 0; y < n; y++) for (var x = 0; x < n; x++) {
      if ((x < 8 && y < 8) || (x > n - 9 && y < 8) || (x < 8 && y > n - 9)) continue;
      var v = parseInt(hex.charAt((bit++) % 64), 16); if ((v + x * 3 + y * 7) % 3 === 0 || v > 9) cells += '<rect x="' + x + '" y="' + y + '" width="1" height="1"/>';
    }
    return '<svg viewBox="0 0 ' + n + ' ' + n + '" width="150" height="150" shape-rendering="crispEdges"><rect width="' + n + '" height="' + n + '" fill="#fff"/>' + finder(0, 0) + finder(n - 7, 0) + finder(0, n - 7) + '<g fill="#000">' + cells + '</g></svg>';
  }

  /* ----- the document ----- */
  function build(o, type) {
    var inv = type === 'inv', t = o.totals, b = o.buyer || {}, s = o.ship || {}, gj = !!t.gujarat;
    var bst = DB.stateFromPin(b.pin) || { name: '', code: '' }, sst = DB.stateFromPin(s.pin) || { name: gj ? 'Gujarat' : '', code: gj ? '24' : '' };
    var docNo = inv ? (o.invoice ? o.invoice.no : '') : o.id, docDate = inv ? (o.invoice ? o.invoice.date : o.date) : o.date, title = inv ? 'INVOICE' : 'SALES ORDER';
    var irn = inv ? sha256(CO.gstin + 'INV' + docNo + fy(docDate)) : '', ack = inv ? String(Math.abs(parseInt(irn.slice(0, 8), 16)) * 1000 + 162000000000000).slice(0, 15) : '';
    var rows = '', qtyTotal = 0, n = 0;
    (o.items || []).forEach(function (l) {
      n++; qtyTotal += l.qty; var base = r2(l.qty * l.price / 1.05), rate = r2(l.price / 1.05), br = SEL.brandById(l.brand);
      rows += '<tr><td class="c">' + n + '</td><td><b>' + esc((br ? br.name + ' ' : '') + l.product) + '</b><br>' + esc(l.variant + (l.flavour ? ' - ' + l.flavour : '')) + '</td><td class="c">' + (l.hsn || HSN) + '</td><td class="c">5%</td><td class="r">' + n2(l.mrp) + '</td><td class="r"><b>' + l.qty + ' Nos</b></td><td class="r">' + n2(rate) + '</td><td class="c">Nos</td><td class="c"></td><td class="r">' + n2(base) + '</td></tr>';
    });
    if (t.couponDiscount) rows += '<tr><td></td><td class="r"><i>Less: Coupon discount (' + esc(t.couponCode) + ')</i></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td class="r">(-)' + n2(r2(t.couponDiscount / 1.05)) + '</td></tr>';
    if (gj) rows += '<tr><td></td><td class="r"><b>CGST</b> @ 2.5%</td><td></td><td></td><td></td><td></td><td class="c">2.5</td><td class="c">%</td><td></td><td class="r">' + n2(t.cgst) + '</td></tr><tr><td></td><td class="r"><b>SGST</b> @ 2.5%</td><td></td><td></td><td></td><td></td><td class="c">2.5</td><td class="c">%</td><td></td><td class="r">' + n2(t.sgst) + '</td></tr>';
    else rows += '<tr><td></td><td class="r"><b>IGST</b> @ 5%</td><td></td><td></td><td></td><td></td><td class="c">5</td><td class="c">%</td><td></td><td class="r">' + n2(t.igst) + '</td></tr>';
    var pad = ''; for (var i = 0; i < Math.max(0, 7 - n); i++) pad += '<tr class="pad"><td>&nbsp;</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>';
    var taxAmt = t.cgst + t.sgst + t.igst;
    var hsnTbl = '<table class="hsn"><thead><tr><th rowspan="2">HSN/SAC</th><th rowspan="2">Taxable Value</th>' + (gj ? '<th colspan="2">CGST</th><th colspan="2">SGST/UTGST</th>' : '<th colspan="2">IGST</th>') + '<th rowspan="2">Total Tax Amount</th></tr><tr>' + (gj ? '<th>Rate</th><th>Amount</th><th>Rate</th><th>Amount</th>' : '<th>Rate</th><th>Amount</th>') + '</tr></thead><tbody><tr><td>' + HSN + '</td><td class="r">' + n2(t.taxable) + '</td>' + (gj ? '<td class="c">2.5%</td><td class="r">' + n2(t.cgst) + '</td><td class="c">2.5%</td><td class="r">' + n2(t.sgst) + '</td>' : '<td class="c">5%</td><td class="r">' + n2(t.igst) + '</td>') + '<td class="r">' + n2(taxAmt) + '</td></tr><tr class="tot"><td class="r"><b>Total</b></td><td class="r"><b>' + n2(t.taxable) + '</b></td>' + (gj ? '<td></td><td class="r"><b>' + n2(t.cgst) + '</b></td><td></td><td class="r"><b>' + n2(t.sgst) + '</b></td>' : '<td></td><td class="r"><b>' + n2(t.igst) + '</b></td>') + '<td class="r"><b>' + n2(taxAmt) + '</b></td></tr></tbody></table>';
    var addr = function (a) { return esc(a || '').replace(/\n/g, '<br>'); };
    var paid = o.payment && o.payment.status === 'Paid';
    var sh = o.shipment, c = sh && sh.partner ? DB.getCourier(sh.partner) : null;
    var css = '*{box-sizing:border-box}body{margin:0;background:#e9ecf3;font-family:Arial,Helvetica,sans-serif;color:#000}.bar{position:sticky;top:0;background:#0b1b3a;color:#fff;padding:10px 16px;display:flex;gap:12px;align-items:center;justify-content:space-between;font-size:13px}.bar button{background:#d8232a;color:#fff;border:0;border-radius:999px;padding:9px 18px;font-weight:700;cursor:pointer}' +
      '.doc{width:794px;margin:16px auto;background:#fff;padding:0 0 16px;font-size:10.5px;line-height:1.35;position:relative;border:1px solid #c9cde0}.lav{background:#dedcff}.hd{display:flex;align-items:stretch;padding:8px 16px 14px;min-height:112px}.hd .logo{width:132px;background:#fff;margin:8px 0;display:flex;align-items:center;justify-content:center;padding:6px}.hd .logo img{max-width:100%;max-height:60px}.hd .ttl{flex:1;text-align:center;padding-right:132px}.t1{font-weight:700;font-size:11px}.t2{font-weight:700;font-size:24px;margin:2px 0 4px}' +
      '.r3{display:flex;justify-content:space-between;padding:8px 16px;border-bottom:1px solid #000}.boxes{display:flex;gap:40px;padding:6px 16px 10px 150px;border-bottom:1px solid #000}.boxes>div{flex:1;background:#dedcff;padding:3px 10px 6px}.boxes b.h{display:block;text-align:center}' +
      '.einv{display:flex;justify-content:space-between;padding:10px 16px;min-height:150px}.einv .tag{display:inline-block;background:#dedcff;font-weight:700;padding:2px 40px 2px 8px;font-size:11px;margin-bottom:34px}.irn{word-break:break-all}.qr{width:150px}' +
      'table{border-collapse:collapse;width:100%}table.meta td{vertical-align:top;padding:3px 10px;border:0}.meta .h{background:#dedcff;font-weight:700;padding:3px 8px}' +
      'table.items{margin-top:6px}.items th{border:1px solid #000;background:#dedcff;padding:4px 3px;font-weight:400;font-size:10.5px}.items td{border-left:1px solid #000;border-right:1px solid #000;padding:3px 4px;vertical-align:top}.items tr.pad td{border-top:0}.items tfoot td{border:1px solid #000;font-weight:700;padding:3px 4px}.c{text-align:center}.r{text-align:right}' +
      '.eoe{text-align:right;background:#dedcff;padding:2px 16px;border-top:1px solid #000}.sec{padding:6px 16px}.hsn{margin-top:6px}.hsn th,.hsn td{border:1px solid #000;padding:3px 5px;font-size:10px;font-weight:400}.hsn th{background:#dedcff}.bank{float:right;width:330px;margin:10px 16px 0 0}.decl{clear:both;padding:6px 16px;font-size:9.5px}.decl p{margin:1px 0}.sig{display:flex;justify-content:space-between;padding:14px 16px 0}.foot{text-align:center;padding-top:8px}' +
      '.wm{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;font-size:110px;font-weight:700;color:rgba(216,35,42,.08);transform:rotate(-24deg);letter-spacing:8px}.pend{background:#fff4e5;border:1px solid #f0c27b;padding:6px 10px;margin:6px 16px;color:#7a4a00;font-weight:700}' +
      '@page{size:A4;margin:8mm}@media print{body{background:#fff}.bar{display:none}.doc{margin:0;border:0;width:auto}}';
    var buyerBlock = '<b>' + esc(b.name) + '</b><br>' + addr(b.address) + ('<br>GSTIN/UIN : ' + (b.gst ? esc(b.gst) : 'Unregistered')) + '<br>State Name : ' + esc(bst.name) + ', Code : ' + esc(bst.code) + (b.phone ? '<br>Contact : ' + esc(b.phone) : '');
    var shipBlock = '<b>' + esc(b.name) + '</b><br>' + addr(s.address) + '<br>State Name : ' + esc(sst.name) + ', Code : ' + esc(sst.code) + (s.phone ? '<br>Contact : ' + esc(s.phone) : '');
    var html = '<!doctype html><html><head><meta charset="utf-8"><title>' + title + ' ' + esc(docNo) + '</title><style>' + css + '</style></head><body>' +
      '<div class="bar"><span>' + title + ' ' + esc(docNo) + (inv ? '' : ' \u2022 payment ' + (paid ? 'received' : 'pending')) + '</span><button onclick="window.print()">Print / Save as PDF</button></div><div class="doc">' + (DEMO_WATERMARK ? '<div class="wm">DEMO</div>' : '') +
      '<div class="lav hd"><div class="logo"><img src="' + SEL.LOGO + '" alt=""></div><div class="ttl"><div class="t1">' + title + '</div><div class="t2">' + CO.name + '</div><div>' + CO.addr + '</div><div>State Name: ' + CO.state + ' Code: ' + CO.code + '</div><div>Company\'s PAN: ' + CO.pan + '</div></div></div>' +
      '<div class="r3"><span>GSTIN/UIN: ' + CO.gstin + '</span><span>CIN: ' + CO.cin + '</span><span>Contact: ' + CO.phone + '<br>E-Mail: ' + CO.email + '</span></div>' +
      '<div class="boxes"><div><b class="h">Where House</b>' + CO.wh.lines.join('<br>') + '<br>Contact: ' + CO.wh.phone + '<br>E-Mail: ' + CO.wh.email + '</div><div><b class="h">' + CO.name + '</b>13th Floor 1314,1315,1316<br>I Square , Science City Road<br>Ahmedabad - 380060<br>Contact: ' + CO.phone + '<br>E-Mail: ' + CO.email + '</div></div>' +
      (inv ? '<div class="einv"><div><span class="tag">e-Invoice</span><div class="irn"><b>IRN:</b> <b>' + irn + '</b></div><div><b>Ack No.:</b> <b>' + ack + '</b> &nbsp;&nbsp;&nbsp;&nbsp; Ack Date: <b>' + dmy(docDate) + '</b></div><div style="color:#b81a21;margin-top:8px">Demo values. The real IRN, Ack No. and QR come from the GST e-invoice portal.</div></div><div class="qr">' + qrPlaceholder(irn) + '</div></div>' : '<div class="pend">' + (paid ? 'Payment received. The Tax Invoice has been issued for this order.' : 'Sales Order. Payment is pending. The Tax Invoice is issued as soon as payment is received.') + '</div>') +
      '<table class="meta"><tr><td class="h" style="width:34%">Buyer (Bill to)</td><td class="h" style="width:30%">Consignee (Ship to)</td><td style="width:36%"><b>' + (inv ? 'Invoice No.' : 'Sales Order No.') + ': ' + esc(docNo) + '</b><br>Dated: <b>' + dmy(docDate) + '</b><br><small>Mode/Terms of Payment: ' + (paid ? esc((o.payment.method || '') + (o.payment.txn ? ' / Ref ' + o.payment.txn : '')) : 'Advance (pending)') + '</small></td></tr>' +
      '<tr><td>' + buyerBlock + '<br>Place of Supply: ' + esc(sst.name) + '</td><td>' + shipBlock + '</td><td>Delivery Note: <br>Order Ref.: ' + esc(o.id) + ' dt. ' + dmy(o.date) + '<br>Terms of Delivery: <br>Dispatch Doc No.: ' + (sh && sh.trackingId ? esc(sh.trackingId) : '') + '<br>Destination: ' + esc(sst.name) + '<br>Dispatched through: ' + (c ? esc(c.name) : (sh && sh.partner ? esc(sh.partner) : '')) + '<br>Other References: ' + (o.createdBy && o.createdBy.role !== 'dealer' ? 'Entered by S-ELEVEN team (' + esc(o.createdBy.code) + ')' : '') + '</td></tr></table>' +
      '<table class="items"><thead><tr><th style="width:4%">Sl<br>No.</th><th>Description of Goods</th><th style="width:10%">HSN/SAC</th><th style="width:6%">GST<br>Rate</th><th style="width:9%">MRP/<br>Marginal</th><th style="width:9%">Quantity</th><th style="width:10%">Rate</th><th style="width:5%">per</th><th style="width:6%">Disc. %</th><th style="width:12%">Amount</th></tr></thead><tbody>' + rows + pad + '</tbody><tfoot><tr><td></td><td class="r">Total</td><td></td><td></td><td></td><td class="r">' + qtyTotal + ' Nos</td><td></td><td></td><td></td><td class="r">\u20B9 ' + n2(t.total) + '</td></tr></tfoot></table><div class="eoe">E. &amp; O.E</div>' +
      '<div class="sec"><small>Amount Chargeable (in words)</small><br><b>' + words(t.total) + '</b><br><small style="color:#444">Prices are inclusive of GST. Taxable value \u20B9 ' + n2(t.taxable) + ' + ' + (gj ? 'CGST \u20B9 ' + n2(t.cgst) + ' + SGST \u20B9 ' + n2(t.sgst) : 'IGST \u20B9 ' + n2(t.igst)) + '</small>' + hsnTbl + '<div style="margin-top:4px">Tax Amount (in words): <b>' + words(taxAmt) + '</b></div></div>' +
      '<div class="bank"><b>Company\'s Bank Details</b><br>A/c Holder\'s Name: ' + CO.bank.holder + '<br>Bank Name: ' + CO.bank.name + '<br>A/c No.: ' + CO.bank.ac + '<br>Branch &amp; IFS Code: ' + CO.bank.ifsc + '<br>SWIFT Code:</div>' +
      '<div class="decl"><b>Declaration</b>' + DECL.map(function (d, i) { return '<p>' + (i + 1) + '. <b>' + d[0] + ':</b> ' + d[1] + '</p>'; }).join('') + '</div>' +
      '<div class="sig"><div><br><br>Customer\'s Seal and Signature</div><div style="text-align:right">for <b>' + CO.name + '</b><br><br><br>Authorised Signatory</div></div><div class="foot">This is a Computer Generated Document</div></div></body></html>';
    return html;
  }
  function open(order, type) {
    var w = window.open('', '_blank'); if (!w) { alert('Please allow pop-ups to view the document.'); return; }
    w.document.open(); w.document.write(build(order, type)); w.document.close();
  }
  window.Docs = { build: build, open: open, words: words, sha256: sha256, CO: CO, HSN: HSN, fy: fy };
})();
