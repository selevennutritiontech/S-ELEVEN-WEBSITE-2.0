/* =====================================================================
   S-ELEVEN dealer portal - DEMO "backend" (db.js)
   Stores everything in this browser (localStorage) so the dealer portal
   and the admin console can be tried together. In the live version every
   function below becomes a call to the S-ELEVEN backend (Cloudflare
   Worker + database); the pages themselves do not need to change.
   ===================================================================== */
(function () {
  'use strict';
  var NS = 'sel.v2.';
  var SERVER = !!(window.SEL_SERVER || window.SEL_ENGINE);   /* secure server mode: data lives on the server; this code runs there and, read-only, in the browser */
  var LS = (window.SEL_SERVER && window.SelStore) ? window.SelStore : localStorage;
  var mem = {};
  function get(k, fb) {
    try { var v = LS.getItem(NS + k); if (v !== null) return JSON.parse(v); } catch (e) {}
    return (!SERVER && (k in mem)) ? JSON.parse(mem[k]) : fb;
  }
  function set(k, v) {
    var s = JSON.stringify(v);
    try { LS.setItem(NS + k, s); } catch (e) {}
    if (!SERVER) mem[k] = s;
  }
  function uid(p) { return p + Date.now().toString(36).toUpperCase() + Math.floor(Math.random() * 1296).toString(36).toUpperCase(); }
  function r2(n) { return Math.round(n * 100) / 100; }
  var H = 3600000, D = 24 * H;

  var DB = window.DB = {};
  DB.CONFIG = { GST_RATE: 5 };            // prices are GST-INCLUSIVE; 5% = CGST 2.5% + SGST 2.5% (Gujarat) or IGST 5% (other states)
  DB.STATUSES = ['Placed', 'Processing', 'Dispatched', 'Out for delivery', 'Delivered'];
  DB.SECTIONS = { live: 'Live Sale', combo: 'Combos', super: 'Super Savings' };


  /* ---------- place of supply: state from the pincode ---------- */
  var PINS = {};
  [['11', 'Delhi', '07'], ['12', 'Haryana', '06'], ['13', 'Haryana', '06'], ['14', 'Punjab', '03'], ['15', 'Punjab', '03'], ['16', 'Punjab', '03'], ['17', 'Himachal Pradesh', '02'], ['18', 'Jammu & Kashmir', '01'], ['19', 'Jammu & Kashmir', '01'],
    ['20', 'Uttar Pradesh', '09'], ['21', 'Uttar Pradesh', '09'], ['22', 'Uttar Pradesh', '09'], ['23', 'Uttar Pradesh', '09'], ['24', 'Uttar Pradesh', '09'], ['25', 'Uttar Pradesh', '09'], ['26', 'Uttar Pradesh', '09'], ['27', 'Uttar Pradesh', '09'], ['28', 'Uttar Pradesh', '09'],
    ['30', 'Rajasthan', '08'], ['31', 'Rajasthan', '08'], ['32', 'Rajasthan', '08'], ['33', 'Rajasthan', '08'], ['34', 'Rajasthan', '08'], ['36', 'Gujarat', '24'], ['37', 'Gujarat', '24'], ['38', 'Gujarat', '24'], ['39', 'Gujarat', '24'],
    ['40', 'Maharashtra', '27'], ['41', 'Maharashtra', '27'], ['42', 'Maharashtra', '27'], ['43', 'Maharashtra', '27'], ['44', 'Maharashtra', '27'], ['45', 'Madhya Pradesh', '23'], ['46', 'Madhya Pradesh', '23'], ['47', 'Madhya Pradesh', '23'], ['48', 'Madhya Pradesh', '23'], ['49', 'Chhattisgarh', '22'],
    ['50', 'Telangana', '36'], ['51', 'Andhra Pradesh', '37'], ['52', 'Andhra Pradesh', '37'], ['53', 'Andhra Pradesh', '37'], ['56', 'Karnataka', '29'], ['57', 'Karnataka', '29'], ['58', 'Karnataka', '29'], ['59', 'Karnataka', '29'],
    ['60', 'Tamil Nadu', '33'], ['61', 'Tamil Nadu', '33'], ['62', 'Tamil Nadu', '33'], ['63', 'Tamil Nadu', '33'], ['64', 'Tamil Nadu', '33'], ['67', 'Kerala', '32'], ['68', 'Kerala', '32'], ['69', 'Kerala', '32'],
    ['70', 'West Bengal', '19'], ['71', 'West Bengal', '19'], ['72', 'West Bengal', '19'], ['73', 'West Bengal', '19'], ['74', 'West Bengal', '19'], ['75', 'Odisha', '21'], ['76', 'Odisha', '21'], ['77', 'Odisha', '21'], ['78', 'Assam', '18'],
    ['80', 'Bihar', '10'], ['81', 'Bihar', '10'], ['82', 'Bihar', '10'], ['83', 'Jharkhand', '20'], ['84', 'Bihar', '10'], ['85', 'Jharkhand', '20']].forEach(function (r) { PINS[r[0]] = { name: r[1], code: r[2] }; });
  DB.pinFrom = function (text) { var m = String(text || '').match(/\b(\d{6})\b(?!.*\b\d{6}\b)/); return m ? m[1] : ''; };
  DB.stateFromPin = function (pin) {
    pin = String(pin || ''); if (!/^\d{6}$/.test(pin)) return null;
    if (pin.slice(0, 3) === '403') return { name: 'Goa', code: '30' };
    return PINS[pin.slice(0, 2)] || null;
  };
  /* shipping address OR pincode in Gujarat -> CGST + SGST, otherwise IGST. (State is approximate from the pincode: verify on invoices.) */
  DB.isGujarat = function (address, pin) {
    var p = /^\d{6}$/.test(String(pin || '')) ? String(pin) : DB.pinFrom(address);
    if (p) { var n = +p; return n >= 360000 && n <= 396999; }
    return /gujarat/i.test(String(address || ''));
  };

  /* ---------- demo purchase prices (the admin normally types these in) ---------- */
  function hash01(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return ((h >>> 0) % 10000) / 10000;
  }
  DB.randomPrices = function (code) {
    var out = {};
    SEL.allSkus().forEach(function (s) {
      out[s.sku] = Math.round(s.mrp * (0.70 + 0.16 * hash01(code + '|' + s.sku)));
    });
    return out;
  };

  /* ---------- seed (first run only) ---------- */
  function fyShort(iso) { var d = new Date(iso), y = d.getFullYear(), s = d.getMonth() >= 3 ? y : y - 1; return String(s).slice(2) + '-' + String(s + 1).slice(2); }
  DB.newInvoice = function (iso) { var n = get('invseq', 898) + 1; set('invseq', n); return { no: 'S11/' + fyShort(iso) + '/' + n, date: iso }; };
  var seedDepth = 0;
  function dbBusy() { var b = +LS.getItem('sel.v2.busy') || 0; return !!b && Date.now() - b < 10000; }
  function ensureSeed() { if (!window.SEL_SERVER && !window.SEL_ENGINE) return;   /* no secure server = no data and no logins (nothing is stored in a plain browser); */ if (window.SEL_SERVER && !window.SEL_ENGINE) return; if (dbBusy()) return; seedDepth++; try { ensureSeed0(); } finally { seedDepth--; } if (seedDepth === 0) applyCleanStart(); }
  function ensureSeed0() { ensureSeedMain(); ensureOps(); ensureOps2(); ensureOps3(); ensureOps4(); ensureOps5(); ensureOps6(); ensureOps7(); ensureOps8(); ensureOps9(); ensureOps10(); }
  function ensureSeedMain() {
    if (get('seeded', 0) === 3) return;
    var now = Date.now();
    var dealers = [
      { code: 'DEMO001', password: 'demo123', name: 'Demo Nutrition Store', person: 'Demo Dealer', city: 'Ahmedabad, Gujarat', phone: '9000000001', gst: '24ABCDE1234F1Z5', pincode: '380015', address: 'Shop 12, Sample Complex, SG Highway, Ahmedabad, Gujarat 380015' },
      { code: 'DEMO002', password: 'demo456', name: 'Sample Fitness Hub', person: 'Sample Dealer', city: 'Surat, Gujarat', phone: '9000000002', gst: '24FGHIJ5678K1Z9', pincode: '395002', address: 'Unit 4, Demo Market, Ring Road, Surat, Gujarat 395002' },
      { code: 'DEMO003', password: 'demo789', name: 'Mumbai Fit Store', person: 'Mumbai Dealer', city: 'Mumbai, Maharashtra', phone: '9000000003', gst: '27KLMNO9012P1Z3', pincode: '400001', address: 'Unit 7, Demo Plaza, Fort, Mumbai, Maharashtra 400001' }
    ];
    var OWN = { DEMO001: 'SALES', DEMO002: 'SALES2', DEMO003: 'SALES3' };
    dealers.forEach(function (d) { d.prices = DB.randomPrices(d.code); d.createdAt = now; d.salesEmp = OWN[d.code] || ''; d.createdBy = OWN[d.code] || 'ADMIN'; d.brandPct = {}; });
    set('dealers', dealers);
    set('couriers', [
      { id: 'delhivery', name: 'Delhivery', url: 'https://www.delhivery.com/track/package/{id}', sample: true },
      { id: 'bluedart', name: 'Blue Dart', url: 'https://www.bluedart.com/tracking?trackfor={id}', sample: true },
      { id: 'dtdc', name: 'DTDC', url: 'https://www.dtdc.in/tracking.html?tracking={id}', sample: true },
      { id: 'ecom', name: 'Ecom Express', url: 'https://ecomexpress.in/tracking/?awb_field={id}', sample: true }
    ]);
    set('offers', [
      { id: 'o1', section: 'live', title: 'Weekend Flash Sale', text: 'Flat \u20B9500 off on orders above \u20B910,000. Hurry, the timer is running.', code: 'FLASH500', amount: 500, min: 10000, requires: [], startsAt: now - H, expiresAt: now + 2 * D + 6 * H, active: true },
      { id: 'o2', section: 'live', title: 'Protein Bar Burst', text: 'Flat \u20B9300 off on orders above \u20B93,000. Perfect for restocking bars.', code: 'BARBURST300', amount: 300, min: 3000, requires: [], startsAt: now - H, expiresAt: now + 9 * H + 30 * 60000, active: true },
      { id: 'o3', section: 'combo', title: 'Whey + Creatine Combo', text: 'Buy 1 BOLT Whey Protein and 1 BOLT Micronized Creatine together and get \u20B9600 off.', code: 'WHEYCREATINE600', amount: 600, min: 0, requires: [{ pid: 'bolt-wp', qty: 1 }, { pid: 'bolt-cr', qty: 1 }], startsAt: now - H, expiresAt: now + 5 * D, active: true },
      { id: 'o4', section: 'combo', title: 'Wellness Duo', text: 'Take 2 Eleone ACV + Mother and 1 Glutathione Capsules and get \u20B9250 off.', code: 'WELLNESSDUO250', amount: 250, min: 0, requires: [{ pid: 'el-ac', qty: 2 }, { pid: 'el-gc', qty: 1 }], startsAt: now - H, expiresAt: now + 4 * D + 3 * H, active: true },
      { id: 'o5', section: 'super', title: 'Super Saver', text: 'Flat \u20B91,000 off on orders above \u20B925,000.', code: 'SUPER1000', amount: 1000, min: 25000, requires: [], startsAt: now - H, expiresAt: now + 12 * D, active: true },
      { id: 'o6', section: 'super', title: 'Mega Saver', text: 'Flat \u20B93,000 off on orders above \u20B960,000.', code: 'MEGA3000', amount: 3000, min: 60000, requires: [], startsAt: now - H, expiresAt: now + 20 * D, active: true },
      { id: 'o7', section: 'live', title: 'Festive Early Bird (ended)', text: 'This sample offer has already ended, to show how expired offers look.', code: 'EARLY200', amount: 200, min: 2000, requires: [], startsAt: now - 6 * D, expiresAt: now - D, active: true }
    ]);
    set('posts', [
      { id: 'p1', tag: 'Launch', title: 'UENERGY is launching soon', text: 'A new energy brand is joining the S-ELEVEN family. Dealer pre-booking details will be shared here first. Stay tuned.', image: 'img/feed-uenergy.jpg', link: { type: 'page', to: 'updates', label: 'See updates' }, at: now - 5 * H, likes: ['DEMO002'] },
      { id: 'p2', tag: 'Announcement', title: 'Our new head office and warehouse are ready', text: 'Orders now ship from our Gandhinagar warehouse. Track every order, and download your Sales Order and Tax Invoice from My Orders.', image: 'img/feed-hero.jpg', link: { type: 'page', to: 'orders', label: 'Open My Orders' }, at: now - 2 * D, likes: [] },
      { id: 'p3', tag: 'Catalogue', title: '2026 brand catalogues are live', text: 'BOLT, ved, WHEYMILL, Eleone and Pureluxe catalogues are updated with the latest packs, flavours and MRPs. Browse them from Generate Order.', image: '', link: { type: 'order', brand: 'bolt', label: 'Browse products' }, at: now - 4 * D, likes: ['DEMO001', 'DEMO002'] }
    ]);
    set('invseq', 898);
    function line(pid, vid, flavour, qty, dealer) {
      var f = SEL.findProduct(pid), p = f.product, v = null; p.variants.forEach(function (x) { if (x.id === vid) v = x; });
      return { key: pid + '|' + vid + '|' + (flavour || ''), brand: f.brand, pid: pid, product: p.name, vid: vid, variant: v.label, flavour: flavour || '', mrp: v.mrp, price: dealer.prices[SEL.sku(pid, vid)] || v.mrp, qty: qty };
    }
    function mkOrder(dealer, daysAgo, status, items, seq, ship, paid) {
      var dt = new Date(now - daysAgo * D), iso = dt.toISOString();
      var id = 'SE-' + String(dt.getFullYear()).slice(2) + ('0' + (dt.getMonth() + 1)).slice(-2) + ('0' + dt.getDate()).slice(-2) + '-' + seq;
      var gj = DB.isGujarat(dealer.address, dealer.pincode);
      var o = { id: id, date: iso, status: status, payment: { method: 'UPI', status: paid ? 'Paid' : 'Pending', txn: paid ? 'DEMO' + seq + 'TXN' : '' }, items: items, totals: DB.calcTotals(items, null, gj),
        address: dealer.address, pin: dealer.pincode, phone: dealer.phone, gst: dealer.gst, note: '', shipment: null, history: [{ status: 'Placed', at: iso }],
        buyer: { name: dealer.name, gst: dealer.gst, address: dealer.address, pin: dealer.pincode, phone: dealer.phone }, ship: { address: dealer.address, pin: dealer.pincode, phone: dealer.phone }, createdBy: { code: dealer.code, name: dealer.name, role: 'dealer' }, attr: { emp: dealer.salesEmp || '' } };
      if (paid) o.invoice = DB.newInvoice(new Date(dt.getTime() + 3600000).toISOString());
      if (ship) {
        o.shipment = { partner: ship.partner, trackingId: ship.id, updatedAt: new Date(now - ship.dAgo * D).toISOString(), updatedBy: 'LOGISTICS' };
        o.history.push({ status: 'Processing', at: new Date(now - (daysAgo - 0.3) * D).toISOString() }); o.history.push({ status: 'Dispatched', at: new Date(now - ship.dAgo * D).toISOString() });
        if (status === 'Delivered') o.history.push({ status: 'Delivered', at: new Date(now - (ship.dAgo - 3) * D).toISOString() });
      } else if (status === 'Processing') o.history.push({ status: 'Processing', at: new Date(now - (daysAgo - 0.2) * D).toISOString() });
      return o;
    }
    dealers.forEach(function (d, i) {
      var ids = ['4821', '4822', '4823'], ids2 = ['3377', '3378', '3379'], ids3 = ['2096', '2097', '2098'];
      set('orders.' + d.code, [
        mkOrder(d, 2, 'Processing', [line('bolt-wp', '2lb', 'Piedmont Chocolate', 4, d), line('bolt-cr', '250g', 'Unflavoured', 6, d)], ids[i], null, true),
        mkOrder(d, 11, 'Dispatched', [line('pl-pb', 'p12', 'Cashew Caramel', 10, d), line('pl-pb', 'p12', 'Chocolate Dough', 10, d)], ids2[i], { partner: 'delhivery', id: 'DL' + (82145000 + i * 17 + 331) + 'IN', dAgo: 9 }, true),
        mkOrder(d, 34, 'Delivered', [line('ved-sa', 'c90', '', 8, d), line('el-ac', 'p2', 'Green Apple', 12, d)], ids3[i], { partner: 'bluedart', id: '7740' + (551200 + i * 41) + '2', dAgo: 31 }, true)
      ]);
    });
    /* employees (Host can create more), monthly brand targets, credited sales, warehouse attendance */
    var P = function (id, name, dept, des, mob, pw) { return { id: id, name: name, dept: dept, designation: des, email: name.toLowerCase().replace(/[^a-z]+/g, '.') + '@s-eleven.com', mobile: mob, password: pw, status: 'active', brands: [], createdAt: now, createdBy: 'SYSTEM' }; };
    set('employees', [P('ADMIN', 'S-ELEVEN Admin', 'host', 'Host', '9023812338', 'admin123'), P('SALES', 'Aarav Shah', 'sales', 'Sales Executive', '9825010001', 'sales123'), P('SALES2', 'Priya Patel', 'sales', 'Sales Executive', '9825010002', 'sales2123'),
      P('SALES3', 'Rohan Desai', 'sales', 'Sales Executive', '9825010003', 'sales3123'), P('SALES4', 'Neha Joshi', 'sales', 'Sales Executive', '9825010004', 'sales4123'),
      P('LOGISTICS', 'Logistics Operator', 'logistics', 'Logistics Executive', '9825020001', 'logi123'), P('WAREHOUSE', 'Warehouse Manager', 'warehouse', 'Warehouse Manager', '9825030001', 'wh123'), P('FINANCE', 'Finance Executive', 'finance', 'Accounts Executive', '9825040001', 'fin123')]);
    var mNow = DB.ym(now), MULT = { SALES: 1, SALES2: 0.8, SALES3: 1.2, SALES4: 0.6 }, BASE = { bolt: 300000, ved: 150000, wheymill: 100000, eleo1ne: 50000, pureluxe: 80000 }, tg = [];
    Object.keys(MULT).forEach(function (e) { Object.keys(BASE).forEach(function (b) { tg.push({ emp: e, brand: b, month: mNow, amount: Math.round(BASE[b] * MULT[e] / 1000) * 1000, by: 'ADMIN', at: now }); }); });
    set('targets', tg); set('ledger', []);
    dealers.forEach(function (d) { get('orders.' + d.code, []).forEach(function (o) { DB.creditOrder(o); }); });
    var att = [], nd = new Date(now), today = nd.getDate();
    for (var dy = today - 1; dy >= 1; dy--) {
      var dt = new Date(nd.getFullYear(), nd.getMonth(), dy); if (dt.getDay() === 0) continue;
      var o1 = new Date(nd.getFullYear(), nd.getMonth(), dy, 9, 20 + (dy * 7) % 25), c1 = new Date(nd.getFullYear(), nd.getMonth(), dy, 18, (dy * 11) % 45), ov = dy % 9 === 4;
      att.push({ openedBy: 'WAREHOUSE', openedAt: o1.toISOString(), closedBy: ov ? 'ADMIN' : 'WAREHOUSE', closedAt: c1.toISOString(), kind: ov ? 'HOST_OVERRIDE' : 'NORMAL', reason: ov ? 'Power cut at the warehouse, packing resumes tomorrow' : '', blockers: ov ? [{ id: 'SE-DEMO', dealer: 'Demo', status: 'Pending' }] : [] });
    }
    set('shiftlog', att); set('activity', []); set('staffnotifs', []);
    set('seeded', 3);
  }

  /* ---------- totals: prices are GST-inclusive; the base value and GST are split out ---------- */
  DB.couponAmount = function (cp, subtotal) { if (!cp) return 0; return r2(Math.min(cp.amount, subtotal)); };
  DB.calcTotals = function (items, cp, gujarat) {
    if (gujarat === undefined) gujarat = true;
    var sub = 0, base = 0; items.forEach(function (l) { sub += l.price * l.qty; base += r2(l.qty * l.price / 1.05); });
    sub = r2(sub); base = r2(base);
    var cd = DB.couponAmount(cp, sub), net = r2(sub - cd), taxable = r2(base - (cd ? r2(cd / 1.05) : 0)), gst = r2(net - taxable);
    var cgst = gujarat ? r2(gst / 2) : 0, sgst = gujarat ? r2(gst - cgst) : 0, igst = gujarat ? 0 : gst;
    return { subtotal: sub, couponCode: cp ? cp.code : '', couponDiscount: cd, taxable: taxable, gst: gst, cgst: cgst, sgst: sgst, igst: igst, total: net, gujarat: !!gujarat, rate: 5 };
  };

  /* ---------- dealers ---------- */
  function safe(d) { if (!d) return null; var o = {}; Object.keys(d).forEach(function (k) { if (k !== 'password') o[k] = d[k]; }); return o; }
  DB.listDealers = function () { ensureSeed(); return get('dealers', []).map(safe); };
  DB.getDealer = function (code) { ensureSeed(); var f = null; get('dealers', []).forEach(function (d) { if (d.code === String(code).toUpperCase()) f = d; }); return safe(f); };
  DB.verifyDealer = function (code, pw) {
    ensureSeed(); var c = String(code || '').trim().toUpperCase(), f = null;
    get('dealers', []).forEach(function (d) { if (d.code === c && pw && d.password === pw) f = d; });
    return safe(f);
  };
  DB.saveDealer = function (d) {
    ensureSeed(); var list = get('dealers', []), code = String(d.code).trim().toUpperCase(), idx = -1;
    list.forEach(function (x, i) { if (x.code === code) idx = i; });
    var rec = { code: code, password: d.password, name: d.name, person: d.person, city: d.city, phone: d.phone, gst: d.gst, regType: d.gst ? 'Registered' : 'Unregistered', freightApply: d.freightApply !== undefined ? d.freightApply : (idx > -1 && list[idx].freightApply !== undefined ? list[idx].freightApply : true), pincode: d.pincode || DB.pinFrom(d.address), address: d.address, prices: d.prices || {}, salesEmp: d.salesEmp !== undefined ? d.salesEmp : (idx > -1 ? list[idx].salesEmp : ''), createdBy: idx > -1 ? list[idx].createdBy : (d.createdBy || ''), brandPct: d.brandPct || (idx > -1 ? list[idx].brandPct : {}) || {}, createdAt: idx > -1 ? list[idx].createdAt : Date.now() };
    if (idx > -1) { if (!rec.password) rec.password = list[idx].password; ['active', 'statusBy', 'statusAt', 'statusReason', 'statusLog', 'pwChangedAt', 'pwChangedBy'].forEach(function (k) { if (rec[k] === undefined && list[idx][k] !== undefined) rec[k] = list[idx][k]; }); list[idx] = rec; } else list.push(rec);
    set('dealers', list); return safe(rec);
  };
  DB.findDealers = function (q) {
    var all = DB.listDealers(); q = String(q || '').trim().toLowerCase(); if (!q) return all;
    var exact = all.filter(function (d) { return d.code.toLowerCase() === q; }); if (exact.length) return exact;
    return all.filter(function (d) { return [d.name, d.person, d.city, d.phone, d.gst, d.code].join(' ').toLowerCase().indexOf(q) > -1; });
  };
  DB.deleteDealer = function (code) { var list = get('dealers', []).filter(function (d) { return d.code !== code; }); set('dealers', list); try { LS.removeItem(NS + 'orders.' + code); } catch (e) {} };
  DB.priceFor = function (dealer, pid, vid, mrp) {
    var p = dealer && dealer.prices && dealer.prices[SEL.sku(pid, vid)];
    return (typeof p === 'number' && p > 0) ? p : mrp;
  };

  /* ---------- offers ---------- */
  DB.listOffers = function () { ensureSeed(); return get('offers', []); };
  /* "Visible to": an offer is shown to every dealer ('All'), or only to dealers of one category (Distributor, Wholesaler, Retailer, Gym, Solo buyer) */
  DB.offerVisible = function (o, cat) { var v = o && o.visibleTo; return !v || v === 'All' || v === cat; };
  DB.offersFor = function (dealer) { var cat = dealer && dealer.category; return DB.listOffers().filter(function (o) { return DB.offerVisible(o, cat); }); };
  DB.saveOffer = function (o) {
    var list = get('offers', []), idx = -1;
    if (!o.id) o.id = uid('O'); if (!o.visibleTo || (o.visibleTo !== 'All' && DB.CATS.indexOf(o.visibleTo) < 0)) o.visibleTo = 'All';
    /* v31: normalise the variant fields so a bad value can never corrupt pricing */
    if (['flat', 'percent', 'bogo'].indexOf(o.offerType) < 0) o.offerType = 'flat';
    if (o.brand && !(SEL.brandById && SEL.brandById(o.brand))) o.brand = '';
    if (o.offerType === 'percent') { o.percent = Math.min(100, Math.max(1, parseInt(o.percent, 10) || 0)); o.cap = Math.max(0, parseInt(o.cap, 10) || 0); }
    if (o.offerType === 'bogo') { o.buyQty = Math.max(1, parseInt(o.buyQty, 10) || 0); o.freeQty = Math.max(1, parseInt(o.freeQty, 10) || 0); }
    list.forEach(function (x, i) { if (x.id === o.id) idx = i; });
    if (idx > -1) list[idx] = o; else list.unshift(o);
    set('offers', list); return o;
  };
  DB.deleteOffer = function (id) { set('offers', get('offers', []).filter(function (o) { return o.id !== id; })); };
  DB.offerState = function (o, now) {
    now = now || Date.now();
    if (!o.active) return 'paused';
    if (o.startsAt && now < o.startsAt) return 'scheduled';
    if (o.expiresAt && now >= o.expiresAt) return 'expired';
    return 'live';
  };
  DB.countdown = function (ms) {
    if (ms <= 0) return 'Ended';
    var s = Math.floor(ms / 1000), d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60), sec = s % 60;
    function p(n) { return ('0' + n).slice(-2); }
    return (d ? d + 'd ' : '') + p(h) + 'h ' + p(m) + 'm ' + p(sec) + 's';
  };
  /* lines: [{pid, qty}], subtotal: purchase-price subtotal */
  DB.validateCoupon = function (code, lines, subtotal, dealerCat) {
    var c = String(code || '').trim().toUpperCase();
    if (!c) return { error: 'Enter a coupon code.' };
    var o = null; DB.listOffers().forEach(function (x) { if (x.code && x.code.toUpperCase() === c) o = x; });
    if (!o) return { error: 'This coupon code is not valid.' };
    if (dealerCat !== undefined && !DB.offerVisible(o, dealerCat)) return { error: 'This coupon is not available for your account.' };
    var st = DB.offerState(o);
    if (st === 'expired') return { error: 'This offer has ended.' };
    if (st === 'scheduled') return { error: 'This offer has not started yet.' };
    if (st === 'paused') return { error: 'This offer is not active right now.' };
    /* v31: an offer may be scoped to one brand, so its minimum and discount look only at that brand's lines */
    var scopeSub = subtotal, brandName = '', scopeLines = lines || [];
    if (o.brand) {
      var bf = (SEL.brandById && SEL.brandById(o.brand)) || null; brandName = bf ? bf.name : o.brand;
      scopeLines = (lines || []).filter(function (l) { return l.brand === o.brand; });
      scopeSub = r2(scopeLines.reduce(function (a, l) { return a + (l.price || 0) * (l.qty || 0); }, 0));
      if (scopeSub <= 0) return { error: 'This offer applies to ' + brandName + ' products. Add ' + brandName + ' items to your cart to use ' + o.code + '.' };
    }
    if (o.min && scopeSub < o.min) return { error: 'Add ₹' + Math.ceil(o.min - scopeSub).toLocaleString('en-IN') + ' more' + (o.brand ? ' of ' + brandName : '') + ' to use ' + o.code + ' (minimum ₹' + o.min.toLocaleString('en-IN') + (o.brand ? ' of ' + brandName : '') + ').' };
    var missing = [];
    (o.requires || []).forEach(function (rq) {
      var have = 0; lines.forEach(function (l) { if (l.pid === rq.pid) have += l.qty; });
      if (have < rq.qty) { var f = SEL.findProduct(rq.pid); missing.push(rq.qty + ' × ' + (f ? f.product.name : rq.pid)); }
    });
    if (missing.length) return { error: 'This combo needs: ' + missing.join(' + ') + '.' };
    /* v31: three discount variants. flat (default) = fixed ₹ off; percent = % of the (brand) subtotal, optionally capped; bogo = buy N get M free (the free units are the cheapest qualifying units) */
    var type = o.offerType || 'flat', amt = o.amount;
    if (type === 'percent') { var pct = Math.max(0, +o.percent || 0); amt = r2(scopeSub * pct / 100); if (o.cap > 0) amt = Math.min(amt, o.cap); }
    else if (type === 'bogo') {
      var bq = Math.max(1, parseInt(o.buyQty, 10) || 0), fq = Math.max(1, parseInt(o.freeQty, 10) || 0), totQ = 0, minP = Infinity;
      scopeLines.forEach(function (l) { totQ += l.qty || 0; if ((l.price || 0) < minP && (l.qty || 0) > 0) minP = l.price || 0; });
      var freeU = Math.floor(totQ / bq) * fq;
      if (freeU <= 0 || !isFinite(minP)) return { error: 'Add at least ' + bq + ' ' + (o.brand ? brandName + ' ' : '') + 'unit(s) to use ' + o.code + ' (buy ' + bq + ', get ' + fq + ' free).' };
      amt = r2(freeU * minP);
    }
    amt = Math.min(amt, scopeSub);
    if (!(amt > 0)) return { error: 'This offer gives no discount on the current cart.' };
    return { coupon: { code: o.code, amount: amt, title: o.title, expiresAt: o.expiresAt, offerType: type } };
  };

  /* ---------- orders + shipments ---------- */
  DB.newOrderId = function () {
    var d = new Date();
    return 'SE-' + String(d.getFullYear()).slice(2) + ('0' + (d.getMonth() + 1)).slice(-2) + ('0' + d.getDate()).slice(-2) + '-' + (1000 + Math.floor(Math.random() * 9000));
  };
  function rawOrders(code) { ensureSeed(); return get('orders.' + code, []); }   /* the real stored orders: used by every function that saves orders back */
  DB.listOrders = function (code) { return rawOrders(code); };
  DB.addOrder = function (code, order) {
    var l = rawOrders(code), d = DB.getDealer(code);
    if (!order.attr) { var emp = (d && d.salesEmp) || ''; if (!emp && order.createdBy && order.createdBy.role === 'employee') emp = order.createdBy.code; var en = emp ? DB.getEmployee(emp) : null; order.attr = { emp: emp, name: en ? en.name : '', flagged: !emp }; }   /* who gets the sales target credit; never an arbitrary employee */
    l.unshift(order); set('orders.' + code, l); return order;
  };
  DB.allOrders = function () {
    ensureSeed(); var out = [];
    get('dealers', []).forEach(function (d) { DB.listOrders(d.code).forEach(function (o) { var c = JSON.parse(JSON.stringify(o)); c.dealerCode = d.code; c.dealerName = d.name; out.push(c); }); });
    out.sort(function (a, b) { return new Date(b.date) - new Date(a.date); });
    return out;
  };
  /* logistics operator / admin: set courier, tracking id and status */
  function shipPatch(dealerCode, orderId, patch, by) {
    var list = rawOrders(dealerCode), found = null;
    list.forEach(function (o) {
      if (o.id !== orderId) return;
      var now = new Date().toISOString();
      if (patch.partner !== undefined || patch.trackingId !== undefined) {
        o.shipment = o.shipment || {};
        if (patch.partner !== undefined) o.shipment.partner = patch.partner;
        if (patch.trackingId !== undefined) o.shipment.trackingId = String(patch.trackingId).trim();
        o.shipment.updatedAt = now; o.shipment.updatedBy = by || 'ADMIN';
      }
      if (patch.status && patch.status !== o.status) { o.status = patch.status; o.history = o.history || []; o.history.push({ status: patch.status, at: now }); }
      found = o;
    });
    set('orders.' + dealerCode, list); return found;
  }
  /* the public entry: Dispatched belongs to the Warehouse button only; Out for delivery and Delivered belong to Logistics only, after dispatch, with tracking and documents in place */
  DB.updateShipment = function (dealerCode, orderId, patch, by) {
    var o = DB.getOrder(dealerCode, orderId); if (!o) return null;
    if (patch.status && patch.status !== o.status) {
      if (patch.status === 'Dispatched') return { error: 'Only the Warehouse marks an order dispatched, with the Order dispatched button, after the invoice and e-way bill are uploaded.' };
      if (patch.status === 'Out for delivery' || patch.status === 'Delivered') { if (empRole(by) !== 'logistics') return { error: 'Only the Logistics department marks an order out for delivery or delivered.' }; var dp = DB.docsPending(o); if (dp) return { error: dp + '. The order cannot move on until it is uploaded.' }; if (!o.whDispatch) return { error: 'The Warehouse must mark the order dispatched first.' }; }
    }
    return shipPatch(dealerCode, orderId, patch, by);
  };

  /* sales order -> paid -> tax invoice */
  DB.markPaid = function (code, orderId, info) {
    info = info || {}; var list = rawOrders(code), found = null;
    list.forEach(function (o) {
      if (o.id !== orderId) return; var now = new Date().toISOString();
      o.payment = { method: info.method || (o.payment && o.payment.method) || '', status: 'Paid', txn: info.txn || '', paidAt: now, by: info.by || '' };
      DB.creditOrder(o);
      o.history = o.history || []; o.history.push({ status: 'Payment received', at: now }); found = o;
    });
    set('orders.' + code, list); return found;
  };
  DB.getOrder = function (code, id) { var f = null; DB.listOrders(code).forEach(function (o) { if (o.id === id) f = o; }); return f; };

  /* ---------- feed posts (created by the admin, shown on the dealer home page) ---------- */
  DB.listPosts = function () { ensureSeed(); return get('posts', []).sort(function (a, b) { return b.at - a.at; }); };
  DB.savePost = function (p) { var l = get('posts', []), idx = -1; if (!p.id) { p.id = uid('P'); p.at = Date.now(); p.likes = []; } l.forEach(function (x, i) { if (x.id === p.id) idx = i; }); if (idx > -1) l[idx] = p; else l.unshift(p); try { set('posts', l); } catch (e) { return null; } return p; };
  DB.deletePost = function (id) { set('posts', get('posts', []).filter(function (p) { return p.id !== id; })); };
  DB.toggleLike = function (id, code) { var l = get('posts', []), n = 0; l.forEach(function (p) { if (p.id !== id) return; var i = p.likes.indexOf(code); if (i > -1) p.likes.splice(i, 1); else p.likes.push(code); n = p.likes.length; }); set('posts', l); return n; };

  /* ---------- courier partners ---------- */
  DB.listCouriers = function () { ensureSeed(); return get('couriers', []); };
  DB.getCourier = function (id) { var f = null; DB.listCouriers().forEach(function (c) { if (c.id === id) f = c; }); return f; };
  DB.saveCourier = function (c) {
    var list = get('couriers', []), idx = -1;
    if (!c.id) c.id = c.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || uid('c');
    list.forEach(function (x, i) { if (x.id === c.id) idx = i; });
    if (idx > -1) list[idx] = c; else list.push(c);
    set('couriers', list); return c;
  };
  DB.deleteCourier = function (id) { set('couriers', get('couriers', []).filter(function (c) { return c.id !== id; })); };
  DB.trackUrl = function (partnerId, trackingId) {
    var c = DB.getCourier(partnerId); if (!c || !c.url || !trackingId) return '';
    return c.url.replace('{id}', encodeURIComponent(trackingId));
  };

  /* ---------- warehouse: packing + shift (the shift cannot close while ANY company order is unpacked) ---------- */
  DB.setPacking = function (dealerCode, orderId, state, by) {
    var list = rawOrders(dealerCode), found = null;
    list.forEach(function (o) { if (o.id !== orderId) return; var at = new Date().toISOString(); o.packing = { state: state, by: by, at: at }; o.history = o.history || []; o.history.push({ status: state === 'Packed' ? 'Packed' : 'Packing started', at: at }); found = o; });
    set('orders.' + dealerCode, list); return found;
  };
  DB.getShift = function () { return get('shift', null); };
  DB.openShift = function (by) { var s = { by: by, at: new Date().toISOString() }; set('shift', s); return s; };
  DB.closeShift = function (by, kind, reason, blockers) {
    var s = get('shift', null); if (!s) return null; var log = get('shiftlog', []);
    log.unshift({ openedBy: s.by, openedAt: s.at, closedBy: by, closedAt: new Date().toISOString(), kind: kind, reason: reason || '', blockers: blockers || [] }); set('shiftlog', log.slice(0, 1000)); set('shift', null); return log[0];
  };
  DB.shiftLog = function () { return get('shiftlog', []); };

  /* ---------- employees (created by the Host) ---------- */
  DB.DEPTS = { host: 'Host / Admin', sales: 'Sales', logistics: 'Logistics', warehouse: 'Warehouse', finance: 'Finance', branding: 'Branding', it: 'IT' };
  var ROLE_OF = { host: 'admin', sales: 'employee', logistics: 'logistics', warehouse: 'warehouse', finance: 'finance', branding: 'branding', it: 'it', hr: 'admin' };
  DB.ROLE_OF = ROLE_OF;
  DB.listEmployees = function (dept) { ensureSeed(); var l = get('employees', []); return dept ? l.filter(function (e) { return e.dept === dept; }) : l; };
  DB.getEmployee = function (id) { var f = null, k = String(id || '').trim().toUpperCase(); DB.listEmployees().forEach(function (e) { if (e.id === k) f = e; }); return f; };
  DB.saveEmployee = function (e) {
    ensureSeed(); var l = get('employees', []), id = String(e.id).trim().toUpperCase(), idx = -1; l.forEach(function (x, i) { if (x.id === id) idx = i; }); var old = idx > -1 ? l[idx] : null;
    var rec = { id: id, name: e.name, dept: e.dept, designation: e.designation || '', email: e.email, mobile: e.mobile, password: e.password || (old ? old.password : ''), status: e.status || (old ? old.status : 'active'), brands: (old && old.brands) || [], createdAt: old ? old.createdAt : Date.now(), createdBy: old ? old.createdBy : (e.createdBy || '') };
    if (idx > -1) l[idx] = rec; else l.push(rec); set('employees', l); return rec;
  };
  DB.verifyStaff = function (code, pw) {
    ensureSeed(); var c = String(code || '').trim().toUpperCase(), f = null;
    get('employees', []).forEach(function (e) { if (e.id === c && pw && e.password === pw && e.status === 'active') f = { code: e.id, role: ROLE_OF[e.dept], dept: e.dept, name: e.name }; });
    return f;
  };
  /* ---------- activity log: everything an employee does is recorded for the Host ---------- */
  DB.logActivity = function (by, action, detail, ref) { var l = get('activity', []); l.unshift({ at: Date.now(), by: by, action: action, detail: detail || '', ref: ref || '' }); set('activity', l.slice(0, 1500)); };
  DB.activity = function (by) { ensureSeed(); var l = get('activity', []); return by ? l.filter(function (x) { return x.by === by; }) : l; };
  /* ---------- sales targets (set by the Host) and the credit ledger (filled when payment is received) ---------- */
  DB.ym = function (ms) { var d = new Date(ms); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2); };
  DB.setTarget = function (emp, brand, month, amount, by) {
    var l = get('targets', []).filter(function (t) { return !(t.emp === emp && t.brand === brand && t.month === month); });
    if (amount > 0) l.push({ emp: emp, brand: brand, month: month, amount: Math.round(amount), by: by, at: Date.now() }); set('targets', l);
  };
  DB.listTargets = function (month, emp) { ensureSeed(); return get('targets', []).filter(function (t) { return (!month || t.month === month) && (!emp || t.emp === emp); }); };
  function allocateP(total, w) {            /* largest-remainder split in whole paise: parts always add up exactly */
    var sum = w.reduce(function (a, b) { return a + b; }, 0); if (sum <= 0) return w.map(function () { return 0; });
    var parts = w.map(function (x) { return Math.floor(total * x / sum); }), left = total - parts.reduce(function (a, b) { return a + b; }, 0);
    var order = w.map(function (x, i) { return i; }).sort(function (i, j) { var ri = (total * w[i]) % sum, rj = (total * w[j]) % sum; return rj - ri || i - j; });
    for (var k = 0; k < order.length && left > 0; k++, left--) parts[order[k]]++; return parts;
  }
  /* Payment received -> the tax-free merchandise value is split across the order's brands and credited to the assigned Sales employee (once per order+brand). */
  DB.creditOrder = function (o) {
    if (!o || !o.attr || !o.attr.emp || !o.payment || o.payment.status !== 'Paid') return 0;
    var led = get('ledger', []), keys = {}; led.forEach(function (x) { keys[x.key] = 1; });
    var by = {}; o.items.forEach(function (l) { by[l.brand] = (by[l.brand] || 0) + Math.round(l.qty * l.price * 100 / 1.05); });
    var brands = Object.keys(by).sort(), parts = allocateP(Math.round(o.totals.taxable * 100), brands.map(function (b) { return by[b]; })), n = 0;
    var at = o.payment.paidAt ? new Date(o.payment.paidAt).getTime() : (o.invoice ? new Date(o.invoice.date).getTime() : Date.now());
    brands.forEach(function (b, i) { var key = 'pay:' + o.id + ':' + b; if (keys[key] || !parts[i]) return; led.push({ key: key, emp: o.attr.emp, brand: b, month: DB.ym(at), paise: parts[i], orderId: o.id, at: at, kind: 'CREDIT' }); n++; });
    set('ledger', led); return n;
  };
  DB.ledger = function (emp, month) { ensureSeed(); return get('ledger', []).filter(function (x) { return (!emp || x.emp === emp) && (!month || x.month === month); }); };
  DB.achieved = function (emp, month) { var out = {}; DB.ledger(emp, month).forEach(function (x) { out[x.brand] = (out[x.brand] || 0) + x.paise; }); return out; };   /* paise per brand */
  /* ---------- alerts for staff (pending-work reminders) ---------- */
  DB.staffNotifs = function () { ensureSeed(); return get('staffnotifs', []); };
  DB.addStaffNotif = function (n) {
    var l = get('staffnotifs', []); if (l.some(function (x) { return x.key === n.key; })) return null;
    n.id = 'sn' + Date.now().toString(36) + Math.floor(Math.random() * 999); n.at = n.at || Date.now(); n.readBy = []; l.unshift(n); set('staffnotifs', l.slice(0, 300)); return n;
  };
  DB.readStaffNotifs = function (userId) { var l = get('staffnotifs', []); l.forEach(function (n) { if (n.readBy.indexOf(userId) < 0) n.readBy.push(userId); }); set('staffnotifs', l); };


  /* =====================================================================================================
     OPERATIONS MODULES (demo storage): inventory ledger, preorders, freebies, attendance, HR leave, samples,
     item-level packing, Branding tasks. The same rules are implemented and tested in the platform core.
     ===================================================================================================== */
  var OPSV = 1, inOps = false;
  function ymd(d) { d = new Date(d); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function hash(str) { var h = 0; for (var i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0; return Math.abs(h); }
  function eachSku(fn) { Object.keys(SEL.CATALOG).forEach(function (b) { SEL.CATALOG[b].forEach(function (p) { p.variants.forEach(function (v) { fn(SEL.sku(p.id, v.id), p, v, b); }); }); }); }
  function ensureOps() {
    if (inOps || get('ops', 0) >= OPSV) return; inOps = true;
    try {
      var now = Date.now(), emps = get('employees', []), have = {}; emps.forEach(function (e) { have[e.id] = 1; });
      function addEmp(id, name, dept, des, mob, pw) { if (have[id]) return; emps.push({ id: id, name: name, dept: dept, designation: des, email: name.toLowerCase().replace(/[^a-z]+/g, '.') + '@s-eleven.com', mobile: mob, password: pw, status: 'active', brands: [], createdAt: now, createdBy: 'SYSTEM', manager: 'ADMIN' }); }
      addEmp('BRANDING', 'Kavya Mehta', 'branding', 'Graphic Designer', '9825050001', 'brand123'); addEmp('BRANDING2', 'Dev Trivedi', 'branding', 'Video Editor', '9825050002', 'brand2123'); set('employees', emps);
      var inv = {}; eachSku(function (k) { inv[k] = { on: 150, res: 0, dmg: 0, rec: 150, open: 150 }; });
      ['bolt-mg', 'pl-pb', 'wm-wi'].forEach(function (pid) { var f = SEL.findProduct(pid); if (f) { var v = f.product.variants[f.product.variants.length - 1]; inv[SEL.sku(pid, v.id)] = { on: 0, res: 0, dmg: 0, rec: 0, open: 0 }; } });
      set('inv', inv); set('invlog', []); set('preorders', []);
      var fr = function (code, pid, val, qty, mx, desc) { var f = SEL.findProduct(pid); if (!f) return null; var v = f.product.variants[0]; return { id: 'F-' + code, code: code, name: f.product.name.split(' (')[0] + ' ' + v.label, pid: pid, vid: v.id, brand: f.brand, desc: desc, valuation: val, qty: qty, maxQty: mx, dealers: [], minCart: 0, maxAllow: 0, start: now - 864e5, end: now + 120 * 864e5, active: true, createdBy: 'SYSTEM' }; };
      set('freebies', [fr('FB-CR100', 'bolt-cr', 150, 60, 5, 'Micronized creatine trial pack'), fr('FB-PBAR', 'pl-pb', 200, 40, 3, 'Protein bar box to display at the counter'), fr('FB-OMEGA', 'ved-sa', 100, 50, 5, 'Omega-3 sample bottle'), fr('FB-ACV', 'el-ac', 90, 80, 6, 'ACV effervescent trial')].filter(Boolean));
      var sl = [[10000, 500], [20000, 1000], [30000, 1500], [40000, 2000], [50000, 2500], [70000, 3000], [90000, 3500], [110000, 4000], [130000, 4500], [150000, 5000], [200000, 6000], [250000, 7000], [300000, 8000], [350000, 9000], [400000, 10000]];
      set('fslabs', sl.map(function (x) { return { min: x[0], max: x[1] }; })); set('fexcl', []);
      var att = {}, d0 = new Date(), hol = [{ date: ymd(new Date(d0.getFullYear(), d0.getMonth(), 20)), name: 'Dussehra (sample)' }, { date: '2026-11-08', name: 'Diwali (sample)' }, { date: '2026-11-09', name: 'Diwali holiday (sample)' }, { date: '2026-12-25', name: 'Christmas (sample)' }, { date: '2027-01-26', name: 'Republic Day (sample)' }];
      set('holidays', hol); var hs = {}; hol.forEach(function (h) { hs[h.date] = 1; });
      emps.forEach(function (e) { if (e.dept === 'host') return; att[e.id] = []; for (var d = 1; d < d0.getDate(); d++) { var dt = new Date(d0.getFullYear(), d0.getMonth(), d), k = ymd(dt), h = hash(e.id + k); if (dt.getDay() === 0 || hs[k] || h % 14 === 0) continue;
        var i = new Date(d0.getFullYear(), d0.getMonth(), d, 9, 30 + (h % 26) - 4), o = new Date(d0.getFullYear(), d0.getMonth(), d, 18, 30 + ((h >> 3) % 70) - 20); att[e.id].push({ in: i.toISOString(), out: o.toISOString(), src: 'sample' }); } });
      set('att', att); set('attcorr', []);
      set('leavepolicy', { PAID: { name: 'Paid leave', paid: true, days: 12, carry: 5 }, SICK: { name: 'Sick leave', paid: true, days: 6, carry: 0 }, CASUAL: { name: 'Casual leave', paid: true, days: 6, carry: 0 }, UNPAID: { name: 'Unpaid leave', paid: false, days: 0, carry: 0, unlimited: true } });
      var nx = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate() + 7); while (nx.getDay() !== 1) nx = new Date(nx.getTime() + 864e5);
      set('leaves', [{ id: 'L1', emp: 'SALES2', type: 'PAID', from: ymd(nx), to: ymd(new Date(nx.getTime() + 864e5)), half: false, days: 2, reason: 'Family function (sample request)', status: 'PENDING', createdAt: now }]);
      var ss = {}; eachSku(function (k, p, v) { if (['bolt-wp', 'bolt-cr', 'pl-pb', 'ved-sa', 'el-ac'].indexOf(p.id) > -1) ss[k] = { on: 20, res: 0, disp: 0, dmg: 0 }; }); set('samplestock', ss); set('samples', []); set('btasks', [
        { id: 'T1', title: 'Diwali campaign banners (3 sizes)', assignee: 'BRANDING', due: ymd(new Date(d0.getFullYear(), d0.getMonth(), d0.getDate() + 5)), status: 'In progress', by: 'ADMIN' },
        { id: 'T2', title: 'Edit 30-second Whey Protein reel', assignee: 'BRANDING2', due: ymd(new Date(d0.getFullYear(), d0.getMonth(), d0.getDate() + 3)), status: 'To do', by: 'ADMIN' }]);
      set('ops', OPSV);
    } finally { inOps = false; }
  }
  function log(sku, kind, delta, before, after, reason, by, ref) { var l = get('invlog', []); l.unshift({ at: new Date().toISOString(), sku: sku, kind: kind, delta: delta, before: before, after: after, reason: reason || '', by: by || '', ref: ref || '' }); set('invlog', l.slice(0, 600)); }
  function patchOrder(code, id, fn) { var l = rawOrders(code), f = null; l.forEach(function (o) { if (o.id === id) { fn(o); f = o; } }); set('orders.' + code, l); return f; }

  /* ----- inventory ----- */
  DB.stock = function (sku) { ensureSeed(); var s = get('inv', {})[sku] || { on: 0, res: 0, dmg: 0, rec: 0 }; return { on: s.on, res: s.res, dmg: s.dmg, rec: s.rec || 0, ret: s.ret || 0, avail: Math.max(0, s.on - s.res) }; };
  DB.invAll = function () { ensureSeed(); return get('inv', {}); };
  DB.invLog = function (n) { ensureSeed(); return get('invlog', []).slice(0, n || 60); };
  DB.receiveStock = function (sku, qty, by, reason) {
    ensureSeed(); qty = parseInt(qty, 10); if (!(qty > 0)) return { error: 'Enter a quantity of at least 1.' }; var inv = get('inv', {}), s = inv[sku] || (inv[sku] = { on: 0, res: 0, dmg: 0, rec: 0 }), b = s.on; s.on += qty; s.rec = (s.rec || 0) + qty; set('inv', inv); log(sku, 'RECEIPT', qty, b, s.on, reason || 'Stock received', by);
    return { ok: true, allocated: DB.allocatePreorders(by) };
  };
  DB.adjustStock = function (sku, newOn, by, reason, override) {
    ensureSeed(); newOn = parseInt(newOn, 10); if (!(reason && reason.trim().length >= 5)) return { error: 'A reason is required for every stock adjustment.' }; var inv = get('inv', {}), s = inv[sku]; if (!s) return { error: 'No stock record.' };
    if (newOn < 0) return { error: 'Physical stock cannot be negative. The discrepancy has been flagged for reconciliation.', flag: true }; if (newOn < s.res) return { error: 'Cannot go below the ' + s.res + ' units reserved for orders.' };
    var b = s.on; s.on = newOn; set('inv', inv); log(sku, override ? 'HOST OVERRIDE' : 'ADJUST', newOn - b, b, newOn, reason, by); return { ok: true };
  };
  DB.markDamaged = function (sku, qty, by, reason) { ensureSeed(); qty = parseInt(qty, 10); var inv = get('inv', {}), s = inv[sku]; if (!s || !(qty > 0) || qty > s.on - s.res) return { error: 'Quantity must be between 1 and the available stock.' }; var b = s.on; s.on -= qty; s.dmg += qty; set('inv', inv); log(sku, 'DAMAGED', -qty, b, s.on, reason || 'Damaged / quarantined', by); return { ok: true }; };
  DB.reserveOrderStock = function (o) {
    var inv = get('inv', {}), fb = get('freebies', []), short = [];
    (o.items || []).forEach(function (l) { var k = SEL.sku(l.pid, l.vid), s = inv[k]; if (!s) return; if (s.on - s.res < l.qty) short.push(k); s.res = Math.min(s.on, s.res + l.qty); });
    (o.freebies || []).forEach(function (x) { fb.forEach(function (f) { if (f.id === x.fid) f.qty = Math.max(0, f.qty - x.qty); }); });
    set('inv', inv); set('freebies', fb); return short;
  };
  DB.consumeOrderStock = function (o) {
    var inv = get('inv', {}); (o.items || []).forEach(function (l) { var k = SEL.sku(l.pid, l.vid), s = inv[k]; if (!s) return; var b = s.on; s.on = Math.max(0, s.on - l.qty); s.res = Math.max(0, s.res - l.qty); log(k, 'SALE', -(b - s.on), b, s.on, 'Payment verified', 'SYSTEM', o.id); }); set('inv', inv);
  };
  var _addOrder = DB.addOrder; DB.addOrder = function (code, order) { var r = _addOrder(code, order); if (!order.noReserve) DB.reserveOrderStock(order); if (order.createdBy && order.createdBy.role !== 'system') DB.notifyAction(order.createdBy.code, 'Order placed', (order.createdBy.role === 'dealer' ? 'Dealer ' : '') + (order.createdBy.name || order.createdBy.code) + ' placed order ' + order.id + ' for ' + (order.buyer ? order.buyer.name : code) + ' (' + Math.round(order.totals.total) + ')', 'order'); return r; };
  var _markPaid = DB.markPaid; DB.markPaid = function (code, id, info) { var o = _markPaid(code, id, info); if (o && !o.stockConsumed) { patchOrder(code, id, function (x) { x.stockConsumed = true; }); DB.consumeOrderStock(o); } return o; };

  /* ----- preorders (pay later) ----- */
  DB.listPreorders = function (code) { ensureSeed(); var l = get('preorders', []); return code ? l.filter(function (p) { return p.dealer === code; }) : l; };
  DB.addPreorder = function (code, a) {
    ensureSeed(); var f = SEL.findProduct(a.pid), d = DB.getDealer(code); if (!f || !d) return { error: 'Product or dealer not found.' }; var v = null; f.product.variants.forEach(function (x) { if (x.id === a.vid) v = x; }); if (!v) return { error: 'Pack size not found.' };
    var st = DB.stock(SEL.sku(a.pid, a.vid)); if (st.avail >= a.qty) return { error: 'This product is in stock. Please use Order Now.' };
    var l = get('preorders', []), p = { id: 'PO-' + String(Date.now()).slice(-6) + Math.floor(10 + Math.random() * 89), dealer: code, dealerName: d.name, pid: a.pid, product: f.product.name, vid: a.vid, variant: v.label, flavour: a.flavour || '', qty: a.qty, mrp: v.mrp, price: DB.priceFor(d, a.pid, a.vid, v.mrp), salesEmp: d.salesEmp || null, status: 'Waiting for stock', createdAt: Date.now(), createdBy: a.by || code, orderId: null };
    l.push(p); set('preorders', l); return { ok: true, preorder: p };
  };
  DB.cancelPreorder = function (id) { var l = get('preorders', []), ok = false; l.forEach(function (p) { if (p.id === id && p.status === 'Waiting for stock') { p.status = 'Cancelled'; ok = true; } }); set('preorders', l); return ok; };
  /* oldest first; a preorder is served only when its full quantity can be reserved. Creates a payable order and (through the order snapshot) notifies the dealer. */
  DB.allocatePreorders = function (by) {
    var l = get('preorders', []), n = 0, WINDOW = 120 * 60000;
    l.filter(function (p) { return p.status === 'Waiting for stock'; }).sort(function (a, b) { return a.createdAt - b.createdAt; }).forEach(function (p) {
      var k = SEL.sku(p.pid, p.vid), st = DB.stock(k); if (st.avail < p.qty) return; var d = DB.getDealer(p.dealer); if (!d) return;
      var line = { key: p.pid + '|' + p.vid + '|' + p.flavour, brand: SEL.findProduct(p.pid).brand, pid: p.pid, product: p.product, vid: p.vid, variant: p.variant, flavour: p.flavour, mrp: p.mrp, price: p.price, qty: p.qty };
      var now = new Date().toISOString(), o = { id: DB.newOrderId(), date: now, status: 'Placed', payment: { method: 'Pending', status: 'Pending', txn: '' }, items: [line], freebies: [], totals: DB.calcTotals([line], null, DB.isGujarat(d.address, d.pincode)), address: d.address, pin: d.pincode, phone: d.phone, gst: d.gst, note: 'Preorder ' + p.id, shipment: null, history: [{ status: 'Placed', at: now }],
        buyer: { name: d.name, gst: d.gst, address: d.address, pin: d.pincode, phone: d.phone }, ship: { address: d.address, pin: d.pincode, phone: d.phone }, createdBy: { code: 'SYSTEM', name: 'S-ELEVEN (preorder stock ready)', role: 'system' }, source: 'PREORDER', preorderId: p.id, payBy: new Date(Date.now() + WINDOW).toISOString() };
      DB.addOrder(p.dealer, o); p.status = 'Stock reserved: pay now'; p.orderId = o.id; p.allocatedAt = Date.now(); p.payBy = o.payBy; n++;
      if (p.salesEmp) DB.addStaffNotif({ key: 'pre:' + p.id, kind: 'preorder', audience: ['employee', 'admin'], title: 'Preorder ' + p.id + ' now has stock', text: p.dealerName + ' can pay for ' + p.qty + ' x ' + p.product, count: 1, at: Date.now() });
    });
    if (n) set('preorders', l); return n;
  };
  /* unpaid preorder orders release their stock when the payment window ends, and the next waiting preorder is served */
  DB.expirePreorders = function () {
    var l = get('preorders', []), n = 0, changed = false, inv = get('inv', {}); l.forEach(function (p) {
      if (p.status !== 'Stock reserved: pay now' || !p.orderId) return; var o = DB.getOrder(p.dealer, p.orderId); if (o && o.payment.status === 'Paid') { p.status = 'Paid'; changed = true; return; } if (Date.now() < new Date(p.payBy).getTime() || !o) return;
      var k = SEL.sku(p.pid, p.vid); if (inv[k]) inv[k].res = Math.max(0, inv[k].res - p.qty); patchOrder(p.dealer, p.orderId, function (x) { x.cancelled = true; x.status = 'Placed'; x.payment.status = 'Expired'; }); p.status = 'Expired'; n++; changed = true;
    }); if (changed) { set('preorders', l); set('inv', inv); } if (n) DB.allocatePreorders('SYSTEM'); return n;
  };

  /* ----- freebies ----- */
  DB.freebies = function () { ensureSeed(); return get('freebies', []); };
  DB.saveFreebie = function (f) { var l = get('freebies', []), idx = -1; l.forEach(function (x, i) { if (x.id === f.id) idx = i; }); if (!f.id) { f.id = 'F-' + f.code; if (l.some(function (x) { return x.code === f.code; })) return { error: 'A freebie with this code already exists.' }; } if (idx > -1) l[idx] = f; else l.push(f); set('freebies', l); return { ok: true }; };
  DB.deleteFreebie = function (id) { set('freebies', get('freebies', []).filter(function (f) { return f.id !== id; })); };
  DB.fslabs = function () { ensureSeed(); return get('fslabs', []); };
  DB.saveSlabs = function (l) { set('fslabs', l.sort(function (a, b) { return a.min - b.min; })); };
  DB.fexcl = function () { ensureSeed(); return get('fexcl', []); };
  DB.saveExcl = function (l) { set('fexcl', l); };
  /* line-level eligibility: combo coupon lines, excluded products/brands and excluded dealers cannot receive freebies; the allowance comes from the highest slab the eligible value reaches */
  DB.freebieOptions = function (dealerCode, lines, couponCode) {
    ensureSeed(); var ex = DB.fexcl(), blocked = {}, reasons = [], comboPids = []; var off = couponCode ? DB.listOffers().filter(function (o) { return o.code === couponCode; })[0] : null;
    if (off && off.section === 'combo') (off.requires || []).forEach(function (r) { comboPids.push(r.pid); });
    var dealerBlocked = ex.some(function (x) { return x.type === 'dealer' && x.ref === dealerCode; }), q = 0;
    lines.forEach(function (l) {
      var why = null; if (dealerBlocked) why = 'This dealer is not eligible for freebies'; else if (comboPids.indexOf(l.pid) > -1) why = 'Part of a combo offer'; else if (ex.some(function (x) { return x.type === 'product' && x.ref === l.pid; })) why = 'Product excluded from freebies'; else if (ex.some(function (x) { return x.type === 'brand' && x.ref === l.brand; })) why = 'Brand excluded from freebies';
      if (why) { blocked[l.key] = why; reasons.push({ product: l.product, variant: l.variant, reason: why }); } else q += l.price * l.qty;
    });
    var allowance = 0; DB.fslabs().forEach(function (s) { if (q >= s.min && s.max >= allowance) allowance = s.max; }); var now = Date.now();
    var items = DB.freebies().filter(function (f) { return f.active && f.start <= now && f.end > now && f.qty > 0 && (!f.dealers.length || f.dealers.indexOf(dealerCode) > -1) && q >= (f.minCart || 0); });
    return { qualifying: q, allowance: allowance, blocked: blocked, reasons: reasons, items: items, dealerBlocked: dealerBlocked };
  };
  DB.validateFreebies = function (dealerCode, lines, couponCode, picks) {
    var o = DB.freebieOptions(dealerCode, lines, couponCode), used = 0, per = {}, out = [];
    for (var i = 0; i < picks.length; i++) { var p = picks[i], f = o.items.filter(function (x) { return x.id === p.fid; })[0]; if (!f) return { error: 'A selected freebie is not available for this order.' }; if (p.qty > f.maxQty || p.qty > f.qty) return { error: f.name + ': quantity above the limit or stock.' };
      var v = f.valuation * p.qty; used += v; per[f.id] = (per[f.id] || 0) + v; if (f.maxAllow > 0 && per[f.id] > f.maxAllow) return { error: f.name + ': scheme allowance exceeded.' }; out.push({ fid: f.id, code: f.code, name: f.name, pid: f.pid, vid: f.vid, qty: p.qty, valuation: f.valuation }); }
    if (used > o.allowance) return { error: 'Freebies worth ' + used + ' exceed your allowance of ' + o.allowance + '.' }; return { ok: true, used: used, remaining: o.allowance - used, list: out, allowance: o.allowance };
  };

  /* ----- attendance (every department except Host): 9:30-6:30, 1 hour lunch, 8 net hours ----- */
  var SCHED = { startH: 9, startM: 30, endH: 18, endM: 30, graceH: 10, graceM: 0, lunch: 60, standard: 480, lunchMinSpan: 300 };   /* office 9:30 to 6:30; no salary deduction until 10:00, then per minute */
  DB.SCHED = SCHED;
  DB.sessions = function (code) { ensureSeed(); return get('att', {})[code] || []; };
  DB.clockState = function (code) { var s = DB.sessions(code), last = s[s.length - 1]; return last && !last.out ? { state: 'in', since: last.in } : { state: 'out' }; };
  DB.clockIn = function (code) { ensureSeed(); var e = DB.getEmployee(code); if (!e || e.dept === 'host') return { error: 'Attendance does not apply to this account.' }; var a = get('att', {}); a[code] = a[code] || []; var last = a[code][a[code].length - 1]; if (last && !last.out) return { error: 'You are already clocked in.' }; a[code].push({ in: new Date().toISOString(), out: null, src: 'self' }); set('att', a); return { ok: true }; };
  DB.clockOut = function (code) { ensureSeed(); var a = get('att', {}), l = a[code] || [], last = l[l.length - 1]; if (!last || last.out) return { error: 'You are not clocked in.' }; if (Date.now() <= new Date(last.in).getTime()) return { error: 'Clock-out must be after clock-in.' }; last.out = new Date().toISOString(); set('att', a); return { ok: true }; };
  DB.dayCalc = function (inIso, outIso) {
    var a = new Date(inIso), ss = new Date(a.getFullYear(), a.getMonth(), a.getDate(), SCHED.startH, SCHED.startM), en = new Date(a.getFullYear(), a.getMonth(), a.getDate(), SCHED.endH, SCHED.endM), late = Math.max(0, Math.round((a - ss) / 60000)), lateDed = Math.max(0, Math.round((a - new Date(a.getFullYear(), a.getMonth(), a.getDate(), SCHED.graceH, SCHED.graceM)) / 60000));
    if (!outIso) return { open: true, late: late, lateDed: lateDed, span: 0, lunch: 0, net: 0, ot: 0, early: 0 }; var b = new Date(outIso), span = Math.round((b - a) / 60000), lunch = span >= SCHED.lunchMinSpan ? SCHED.lunch : 0, net = Math.max(0, span - lunch);
    return { open: false, lateDed: lateDed, span: span, lunch: lunch, net: net, ot: Math.max(0, net - SCHED.standard), late: late, early: Math.max(0, Math.round((en - b) / 60000)) };
  };
  DB.holidays = function () { ensureSeed(); return get('holidays', []).sort(function (a, b) { return a.date < b.date ? -1 : 1; }); };
  DB.addHoliday = function (date, name) { var l = get('holidays', []); if (l.some(function (h) { return h.date === date; })) return { error: 'A holiday already exists on this date.' }; l.push({ date: date, name: name }); set('holidays', l); return { ok: true }; };
  DB.delHoliday = function (date) { set('holidays', get('holidays', []).filter(function (h) { return h.date !== date; })); };
  DB.monthReport = function (code, ym) {
    ensureSeed(); var p = ym.split('-'), y = +p[0], m = +p[1] - 1, days = new Date(y, m + 1, 0).getDate(), ses = DB.sessions(code), hol = {}, today = ymd(Date.now()); DB.holidays().forEach(function (h) { hol[h.date] = h.name; });
    var lv = DB.leaves(code).filter(function (x) { return x.status === 'APPROVED'; }), rows = [], sum = { present: 0, absent: 0, leave: 0, holidays: 0, late: 0, early: 0, net: 0, ot: 0 };
    for (var d = 1; d <= days; d++) {
      var dt = new Date(y, m, d), k = ymd(dt), ds = ses.filter(function (s) { return ymd(s.in) === k; }), L = lv.filter(function (x) { return k >= x.from && k <= x.to; })[0], net = 0, ot = 0, late = 0, lateDed = 0, early = 0, st;
      ds.forEach(function (s, i) { var c = DB.dayCalc(s.in, s.out); net += c.net; ot += c.ot; if (i === 0) { late = c.late; lateDed = c.lateDed; } if (i === ds.length - 1 && s.out) early = c.early; });
      if (hol[k]) st = 'Holiday'; else if (L) st = L.half ? 'Half-day leave' : 'On leave'; else if (ds.length) st = 'Present'; else if (dt.getDay() === 0) st = 'Weekly off'; else if (k > today) st = ''; else st = 'Absent';
      if (st === 'Present') sum.present++; if (st === 'Half-day leave') sum.present += 0.5; if (st === 'Absent') sum.absent++; if (st === 'Holiday') sum.holidays++; if (L) sum.leave += L.half ? 0.5 : 1; if (ds.length && late > 0) sum.late++; if (early > 0) sum.early++; sum.net += net; sum.ot += ot;
      rows.push({ date: k, label: dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', weekday: 'short' }), status: st, holiday: hol[k] || '', leaveType: L ? L.type : '', in: ds[0] ? ds[0].in : null, out: ds.length ? ds[ds.length - 1].out : null, net: net, ot: ot, late: late, lateDed: lateDed, early: early, open: ds.length && !ds[ds.length - 1].out });
    }
    return { rows: rows, summary: sum };
  };
  DB.missingClockOuts = function () { var out = [], today = ymd(Date.now()), a = get('att', {}); Object.keys(a).forEach(function (c) { a[c].forEach(function (s) { if (!s.out && ymd(s.in) < today) out.push({ emp: c, in: s.in }); }); }); return out; };
  DB.requestCorrection = function (code, date, tin, tout, reason) { if (!reason || reason.trim().length < 5) return { error: 'Please give a reason.' }; var a = new Date(date + 'T' + tin), b = new Date(date + 'T' + tout); if (!(b > a)) return { error: 'End time must be after start time.' }; var l = get('attcorr', []); l.unshift({ id: 'C' + Date.now(), emp: code, date: date, in: a.toISOString(), out: b.toISOString(), reason: reason.trim(), status: 'PENDING', at: Date.now() }); set('attcorr', l); return { ok: true }; };
  DB.corrections = function () { ensureSeed(); return get('attcorr', []); };
  DB.decideCorrection = function (id, by, ok) { var l = get('attcorr', []), a = get('att', {}); l.forEach(function (c) { if (c.id !== id || c.status !== 'PENDING') return; if (c.emp === by) return; c.status = ok ? 'APPROVED' : 'REJECTED'; c.by = by; if (ok) { a[c.emp] = (a[c.emp] || []).filter(function (s) { return ymd(s.in) !== c.date; }); a[c.emp].push({ in: c.in, out: c.out, src: 'correction' }); a[c.emp].sort(function (x, y) { return new Date(x.in) - new Date(y.in); }); } }); set('attcorr', l); set('att', a); };

  /* ----- HR: leave policy, balances, requests (Host decides) ----- */
  DB.leavePolicy = function () { ensureSeed(); return get('leavepolicy', {}); };
  DB.setLeavePolicy = function (type, days, carry) { var p = get('leavepolicy', {}); if (p[type]) { p[type].days = days; p[type].carry = carry; set('leavepolicy', p); } };
  DB.leaves = function (code) { ensureSeed(); var l = get('leaves', []); return code ? l.filter(function (x) { return x.emp === code; }) : l; };
  DB.leaveDays = function (from, to, half) { if (half) return 0.5; var hol = {}; DB.holidays().forEach(function (h) { hol[h.date] = 1; }); var n = 0, a = new Date(from + 'T00:00:00'), b = new Date(to + 'T00:00:00'); for (var t = a.getTime(); t <= b.getTime(); t += 864e5) { var d = new Date(t); if (d.getDay() !== 0 && !hol[ymd(d)]) n++; } return n; };
  function usedIn(code, type, year, statuses) { var n = 0; DB.leaves(code).forEach(function (x) { if (x.type === type && statuses.indexOf(x.status) > -1 && +x.from.slice(0, 4) === year) n += x.days; }); return n; }
  DB.leaveBalance = function (code, year) {
    var pol = DB.leavePolicy(), out = {}; Object.keys(pol).forEach(function (t) { var p = pol[t]; if (p.unlimited) { out[t] = { name: p.name, unlimited: true, used: usedIn(code, t, year, ['APPROVED']), pending: usedIn(code, t, year, ['PENDING']) }; return; }
      var prevLeft = Math.max(0, p.days - usedIn(code, t, year - 1, ['APPROVED'])), carried = Math.min(p.carry, prevLeft), used = usedIn(code, t, year, ['APPROVED']), pend = usedIn(code, t, year, ['PENDING']);
      out[t] = { name: p.name, entitled: p.days, carried: carried, used: used, pending: pend, remaining: p.days + carried - used }; }); return out;
  };
  DB.requestLeave = function (code, a) {
    ensureSeed(); var e = DB.getEmployee(code); if (!e || e.dept === 'host') return { error: 'Leave requests apply to employees.' }; if (!a.from || !a.to || a.to < a.from) return { error: 'Choose valid dates.' }; if (a.from.slice(0, 4) !== a.to.slice(0, 4)) return { error: 'Please split a request that spans two years.' };
    if (a.half && a.from !== a.to) return { error: 'A half day must be a single date.' }; var days = DB.leaveDays(a.from, a.to, a.half); if (days <= 0) return { error: 'The selected dates are holidays or weekly offs.' };
    var clash = DB.leaves(code).some(function (x) { return (x.status === 'PENDING' || x.status === 'APPROVED') && !(a.to < x.from || a.from > x.to); }); if (clash) return { error: 'This overlaps another pending or approved leave.' };
    var b = DB.leaveBalance(code, +a.from.slice(0, 4))[a.type]; if (!b) return { error: 'Unknown leave type.' }; if (!b.unlimited && b.remaining - b.pending < days) return { error: 'Only ' + (b.remaining - b.pending) + ' day(s) of ' + b.name + ' are available.' };
    var l = get('leaves', []); l.unshift({ id: 'L' + Date.now(), emp: code, type: a.type, from: a.from, to: a.to, half: !!a.half, days: days, reason: a.reason || '', status: 'PENDING', createdAt: Date.now() }); set('leaves', l);
    DB.addStaffNotif({ key: 'leave:' + l[0].id, kind: 'leave', audience: ['admin'], title: 'Leave request from ' + (e.name), text: days + ' day(s) ' + a.from + (a.from !== a.to ? ' to ' + a.to : ''), count: 1, at: Date.now() }); return { ok: true };
  };
  /* a request can be decided only once, so a balance can never be deducted twice (balances are derived from approved requests) */
  DB.decideLeave = function (id, by, approve) {
    var l = get('leaves', []), res = { error: 'Request not found.' }; l.forEach(function (x) { if (x.id !== id) return; if (x.status !== 'PENDING') { res = { error: 'This request is already ' + x.status.toLowerCase() + '.' }; return; }
      if (approve) { var b = DB.leaveBalance(x.emp, +x.from.slice(0, 4))[x.type]; if (!b.unlimited && b.remaining < x.days) { res = { error: 'Balance is no longer sufficient.' }; return; } } x.status = approve ? 'APPROVED' : 'REJECTED'; x.by = by; x.decidedAt = Date.now(); res = { ok: true }; });
    set('leaves', l); return res;
  };
  DB.cancelLeave = function (id) { var l = get('leaves', []), ok = false; l.forEach(function (x) { if (x.id === id && (x.status === 'PENDING' || x.status === 'APPROVED')) { x.status = 'CANCELLED'; ok = true; } }); set('leaves', l); return ok; };

  /* ----- samples: free, separate stock, no payment, no target credit ----- */
  DB.sampleStock = function () { ensureSeed(); return get('samplestock', {}); };
  DB.listSamples = function () { ensureSeed(); return get('samples', []); };
  DB.receiveSampleStock = function (sku, qty, by) { qty = parseInt(qty, 10); if (!(qty > 0)) return { error: 'Enter a quantity of at least 1.' }; var s = get('samplestock', {}); s[sku] = s[sku] || { on: 0, res: 0, disp: 0, dmg: 0 }; s[sku].on += qty; set('samplestock', s); DB.allocateSamples(); return { ok: true }; };
  DB.createSample = function (a) {
    if (!a.lines.length) return { error: 'Add at least one sample product.' }; if (!a.name || (a.address || '').trim().length < 10) return { error: 'Enter the recipient and the full delivery address.' };
    var lines = a.lines.map(function (l) { return { brand: l.brand, product: String(l.product).trim(), qty: l.qty, value: l.value || 0 }; }), val = 0; lines.forEach(function (l) { val += l.value * l.qty; });
    var l = get('samples', []), s = { id: 'SMP-' + (9001 + l.length), dealer: a.dealer || '', name: a.name, address: a.address, lines: lines, valuation: val, shipCost: DB.SAMPLE_SHIP, shipBorneBy: 'S-ELEVEN (company)', status: 'Awaiting invoice', by: a.by, at: Date.now(), history: [{ s: 'Awaiting invoice', at: Date.now() }] }; l.unshift(s); set('samples', l);
    DB.addStaffNotif({ key: 'smp:' + s.id, kind: 'sample', audience: ['logistics', 'admin'], title: 'New sample order ' + s.id + ': attach the invoice', text: lines.map(function (x) { return x.product + ' (' + bn2(x.brand) + ') x' + x.qty; }).join(', ') + ' for ' + a.name, count: 1, at: Date.now() });
    DB.notifyAction(a.by, 'Sample order created', s.id + ' for ' + a.name, 'sample'); return { ok: true, sample: s };
  };
  function bn2(b) { var x = SEL.brandById(b); return x ? x.name : b; }
  DB.approveSample = function () { return 'Ready for packing'; }; DB.allocateSamples = function () { return 0; };
  var SNEXT = { 'Awaiting invoice': ['Cancelled'], 'Ready for packing': ['Cancelled'], 'Packing': [], 'Packed': ['Shipped'], 'Shipped': ['Delivered'] };
  DB.sampleNext = function (st) { return SNEXT[st] || []; };
  DB.SAMPLE_SHIP = 150;   /* flat shipping charge per sample shipment: borne by the company, never charged to or paid by anyone, counted in the Logistics analytics only */
  DB.advanceSample = function (id, to, by, role) { var l = get('samples', []), err = null; if (role !== undefined && to === 'Delivered' && role !== 'logistics') return { error: 'Only the Logistics department marks a sample delivered.' }; if (role !== undefined && to === 'Shipped' && ['logistics', 'warehouse'].indexOf(role) < 0) return { error: 'Only Logistics or the Warehouse ships a sample.' }; l.forEach(function (s) { if (s.id !== id) return; if ((SNEXT[s.status] || []).indexOf(to) < 0) { err = 'Cannot move from ' + s.status + ' to ' + to + '.'; return; } s.status = to; s.history.push({ s: to, at: Date.now() }); }); set('samples', l); return err ? { error: err } : { ok: true }; };

  /* ----- item-level packing: every quantity must be verified ----- */
  DB.startPacking = function (code, orderId, by) { var oo = DB.getOrder(code, orderId); if (oo && DB.diffPending(oo)) return { error: 'This order is on hold until the difference payment is made.' }; return DB.startPackingInner(code, orderId, by); };
  DB.startPackingInner = function (code, orderId, by) {
    var res = null; patchOrder(code, orderId, function (o) { if (o.packing && o.packing.items) { res = o; return; } var items = o.items.map(function (l, i) { return { key: 'i' + i, name: l.product + ' ' + l.variant + (l.flavour ? ' \u00B7 ' + l.flavour : ''), pid: l.pid, req: l.qty, ver: 0, src: 'Product' }; });
      (o.freebies || []).forEach(function (f, i) { items.push({ key: 'f' + i, name: f.name + ' (freebie)', pid: f.pid, req: f.qty, ver: 0, src: 'Freebie' }); }); var at = new Date().toISOString(); o.packing = { state: 'In progress', by: by, at: at, items: items, disc: [] }; o.history = o.history || []; o.history.push({ status: 'Packing started', at: at }); res = o; }); return res;
  };
  DB.verifyItem = function (code, orderId, key, qty, by) { var err = null; patchOrder(code, orderId, function (o) { var it = (o.packing && o.packing.items || []).filter(function (x) { return x.key === key; })[0]; if (!it) { err = 'Item not found.'; return; } if (!(qty >= 0 && qty <= it.req)) { err = 'Verified quantity must be between 0 and ' + it.req + '.'; return; } it.ver = qty; it.by = by; it.at = new Date().toISOString(); }); return err ? { error: err } : { ok: true }; };
  DB.reportDisc = function (code, orderId, key, kind, qty, note, by) {
    var id = 'D' + Date.now(), nm = ''; patchOrder(code, orderId, function (o) { var it = o.packing.items.filter(function (x) { return x.key === key; })[0]; nm = it ? it.name : ''; o.packing.disc.push({ id: id, key: key, name: nm, kind: kind, qty: qty, note: note || '', by: by, at: new Date().toISOString(), resolved: false }); });
    DB.addStaffNotif({ key: 'disc:' + id, kind: 'discrepancy', audience: ['admin', 'warehouse'], title: 'Packing discrepancy on ' + orderId, text: kind + ' x' + qty + ': ' + nm + (note ? ' (' + note + ')' : ''), count: 1, at: Date.now() }); return id;
  };
  DB.resolveDisc = function (code, orderId, id) { patchOrder(code, orderId, function (o) { (o.packing.disc || []).forEach(function (d) { if (d.id === id) d.resolved = true; }); }); };
  DB.packingGaps = function (o) { var p = o.packing || {}, miss = (p.items || []).filter(function (x) { return x.ver < x.req; }), open = (p.disc || []).filter(function (d) { return !d.resolved; }); return { miss: miss, open: open, ok: !!(p.items && p.items.length) && !miss.length && !open.length }; };
  DB.finishPacking = function (code, orderId, by) { var res = { error: 'Order not found.' }; patchOrder(code, orderId, function (o) { var g = DB.packingGaps(o); if (!g.ok) { res = { error: 'Every item must be fully verified and every discrepancy resolved before the order can be marked packed.' }; return; } o.packing.state = 'Packed'; o.packing.by = by; o.packing.at = new Date().toISOString(); o.history.push({ status: 'Packed', at: o.packing.at }); res = { ok: true }; }); return res; };

  /* ----- Branding tasks ----- */
  DB.tasks = function () { ensureSeed(); return get('btasks', []); };
  DB.addTask = function (t) { var l = get('btasks', []); t.id = 'T' + Date.now(); t.status = 'To do'; l.unshift(t); set('btasks', l); };
  DB.setTask = function (id, st) { var l = get('btasks', []); l.forEach(function (t) { if (t.id === id) t.status = st; }); set('btasks', l); };



  /* ===================== v2 additions ===================== */
  var OPS2 = 1, inOps2 = false;
  function ensureOps2() {
    if (inOps2 || get('ops2', 0) >= OPS2 || !get('ops', 0)) return; inOps2 = true;
    try {
      var emps = get('employees', []), have = {}, now = Date.now(); emps.forEach(function (e) { have[e.id] = 1; });
      [['IT', 'Arjun Nair', 'Software Developer', '9825060001', 'it123'], ['IT2', 'Sana Khan', 'Support Engineer', '9825060002', 'it2123']].forEach(function (x) { if (!have[x[0]]) emps.push({ id: x[0], name: x[1], dept: 'it', designation: x[2], email: x[1].toLowerCase().replace(/[^a-z]+/g, '.') + '@s-eleven.com', mobile: x[3], password: x[4], status: 'active', brands: [], createdAt: now, createdBy: 'SYSTEM', manager: 'ADMIN' }); }); set('employees', emps);
      var inv = get('inv', {}); Object.keys(inv).forEach(function (k) { inv[k].ret = inv[k].ret || 0; }); set('inv', inv);
      var t = get('btasks', []); t.forEach(function (x) { x.dept = x.dept || 'branding'; }); var d0 = new Date(); function dd(n) { var z = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate() + n); return z.getFullYear() + '-' + ('0' + (z.getMonth() + 1)).slice(-2) + '-' + ('0' + z.getDate()).slice(-2); }
      t.push({ id: 'T3', dept: 'it', title: 'Set up the live payment gateway keys (test mode first)', assignee: 'IT', due: dd(6), status: 'In progress', by: 'ADMIN' }, { id: 'T4', dept: 'it', title: 'Create nightly database backup and restore drill', assignee: 'IT2', due: dd(4), status: 'To do', by: 'ADMIN' }); set('btasks', t);
      var att = get('att', {}); emps.forEach(function (e) { if (e.dept !== 'it' || att[e.id]) return; att[e.id] = []; for (var d = 1; d < d0.getDate(); d++) { var dt = new Date(d0.getFullYear(), d0.getMonth(), d), h = hash(e.id + ymd(dt)); if (dt.getDay() === 0 || h % 13 === 0) continue; att[e.id].push({ in: new Date(d0.getFullYear(), d0.getMonth(), d, 9, 30 + (h % 20) - 3).toISOString(), out: new Date(d0.getFullYear(), d0.getMonth(), d, 18, 30 + ((h >> 3) % 50) - 15).toISOString(), src: 'sample' }); } }); set('att', att);
      DB.DEPTS.it = 'IT';
      /* invoices are now uploaded manually: sample orders keep no generated invoice */
      ['DEMO001', 'DEMO002', 'DEMO003'].forEach(function (c) { var l = get('orders.' + c, null); if (l) { l.forEach(function (o) { if (!o.invoiceFile) delete o.invoice; }); set('orders.' + c, l); } });
      get('dealers', []).forEach(function (dl) { var l = get('orders.' + dl.code, null); if (l) { l.forEach(function (o) { if (!o.invoiceFile) delete o.invoice; }); set('orders.' + dl.code, l); } });
      set('ops2', OPS2);
    } finally { inOps2 = false; }
  }
  /* every notable employee action is recorded and the Host is notified */
  DB.notifyAction = function (by, action, text, kind) {
    var e = DB.getEmployee ? null : null; try { DB.logActivity(by, action, text, ''); } catch (x) {}
    if (kind === 'signin' && String(by).toUpperCase() === 'ADMIN') return; DB.addStaffNotif({ key: 'act:' + Date.now() + ':' + Math.floor(Math.random() * 1e6), kind: kind || 'action', audience: ['admin'], title: action, text: text, count: 1, at: Date.now() });
  };
  DB.stockOut = function (sku, qty, by, reason) {
    ensureSeed(); qty = parseInt(qty, 10); if (!(reason && reason.trim().length >= 5)) return { error: 'A reason is required (for example: sent for display, internal use).' }; var inv = get('inv', {}), s = inv[sku];
    if (!s || !(qty > 0) || qty > s.on - s.res) return { error: 'Quantity must be between 1 and the available stock (' + (s ? s.on - s.res : 0) + ').' }; var b = s.on; s.on -= qty; set('inv', inv); log(sku, 'STOCK OUT', -qty, b, s.on, reason, by); return { ok: true };
  };
  DB.stockReturn = function (sku, qty, by, reason) {
    ensureSeed(); qty = parseInt(qty, 10); if (!(qty > 0)) return { error: 'Enter the quantity returned.' }; if (!(reason && reason.trim().length >= 5)) return { error: 'A reason is required (for example: returned by dealer, wrong item).' }; var inv = get('inv', {}), s = inv[sku] || (inv[sku] = { on: 0, res: 0, dmg: 0, rec: 0, ret: 0 }), b = s.on;
    s.on += qty; s.ret = (s.ret || 0) + qty; set('inv', inv); log(sku, 'RETURNED', qty, b, s.on, reason, by); return { ok: true, allocated: DB.allocatePreorders(by) };
  };
  [['receiveStock', function (sku, q, by) { DB.notifyAction(by, 'Stock in', sku + ' +' + q, 'inventory'); }], ['stockOut', function (sku, q, by) { DB.notifyAction(by, 'Stock out', sku + ' -' + q, 'inventory'); }], ['stockReturn', function (sku, q, by) { DB.notifyAction(by, 'Stock returned', sku + ' +' + q, 'inventory'); }],
    ['markDamaged', function (sku, q, by) { DB.notifyAction(by, 'Stock damaged', sku + ' -' + q, 'inventory'); }], ['adjustStock', function (sku, n, by) { DB.notifyAction(by, 'Stock adjusted', sku + ' set to ' + n, 'inventory'); }],
    ['clockIn', function (c) { DB.notifyAction(c, 'Clocked in', (DB.getEmployee(c) || {}).name + ' clocked in', 'attendance'); }], ['clockOut', function (c) { DB.notifyAction(c, 'Clocked out', (DB.getEmployee(c) || {}).name + ' clocked out', 'attendance'); }],
    ['finishPacking', function (c, id, by) { DB.notifyAction(by, 'Order packed', id + ' packed and ready', 'packing'); }]].forEach(function (p) { var o = DB[p[0]]; DB[p[0]] = function () { var r = o.apply(DB, arguments); if (r && r.ok) p[1].apply(null, arguments); return r; }; });

  /* ----- manual invoice + e-way bill upload (Logistics). E-way bill is required only for orders above 50,000 ----- */
  var EWAY_LIMIT = 50000; DB.EWAY_LIMIT = EWAY_LIMIT;
  function okPdf(f) { if (!f || !f.data) return 'Choose a PDF file.'; if (!/^data:application\/pdf;base64,/.test(String(f.data)) || !sniffOk(String(f.data))) return 'Only real PDF files are accepted: the file content must be a PDF, not just the file name.'; if (String(f.data).length > 1800000 || f.size > 1300000) return 'The file is too large for this demo (limit about 1.3 MB). The live platform accepts up to 10 MB.'; return ''; }
  DB.needsEway = function (o) { return o.payment.status === 'Paid' && o.totals.total > EWAY_LIMIT; };
  DB.attachInvoiceFile = function (code, id, f, by) {
    var er = okPdf(f); if (er) return { error: er }; if (!f.no || !String(f.no).trim()) return { error: 'Enter the invoice number.' }; var res = { error: 'Order not found.' };
    patchOrder(code, id, function (o) { if (o.status === 'Delivered') { res = { error: 'This order is delivered, so its documents, notes and details can no longer be changed.' }; return; } if (o.payment.status !== 'Paid') { res = { error: 'The invoice can be attached only after payment is received.' }; return; } var at = new Date().toISOString(); o.invoice = { no: String(f.no).trim(), date: at }; o.invoiceFile = { name: f.name, size: f.size, data: f.data, by: by, at: at, version: ((o.invoiceFile && o.invoiceFile.version) || 0) + 1 }; o.history = o.history || []; o.history.push({ status: 'Invoice uploaded', at: at }); res = { ok: true }; });
    if (res.ok) DB.notifyAction(by, 'Invoice uploaded', id + ' invoice ' + f.no, 'invoice'); return res;
  };
  DB.attachEwayFile = function (code, id, f, by) {
    var er = okPdf(f); if (er) return { error: er }; if (!f.no || !String(f.no).trim()) return { error: 'Enter the e-way bill number.' }; var res = { error: 'Order not found.' };
    patchOrder(code, id, function (o) { if (o.status === 'Delivered') { res = { error: 'This order is delivered, so its documents, notes and details can no longer be changed.' }; return; } if (!DB.needsEway(o)) { res = { error: 'An e-way bill is attached only for paid orders above ' + EWAY_LIMIT + '.' }; return; } var at = new Date().toISOString(); o.ewayFile = { no: String(f.no).trim(), name: f.name, size: f.size, data: f.data, by: by, at: at }; o.history = o.history || []; o.history.push({ status: 'E-way bill uploaded', at: at }); res = { ok: true }; });
    if (res.ok) DB.notifyAction(by, 'E-way bill uploaded', id + ' e-way ' + f.no, 'invoice'); return res;
  };
  /* ----- department tasks (Branding and IT) ----- */
  DB.tasks = function (dept) { ensureSeed(); return get('btasks', []).filter(function (t) { return !dept || (t.dept || 'branding') === dept; }); };
  DB.addTask = function (t) { var l = get('btasks', []); t.id = 'T' + Date.now(); t.status = 'To do'; t.dept = t.dept || 'branding'; l.unshift(t); set('btasks', l); DB.notifyAction(t.by, 'Task assigned', t.title + ' to ' + t.assignee, 'task'); };



  /* =========================== v8: batches, proofs, returns, ledger, auto attendance =========================== */
  var DEMO_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAWgAAADcCAIAAADSq6xVAAAZiUlEQVR42u3dd0AUx98G8O9eAan2AoKKIggqAgJ2DHZFscYK9hi7saBYEk2iBtSIilFjLyhW3vxQrGDB3lAQFAXFghQBhQMOuLbvH0su5xUExcTyfP66G2ZnZvd2n5vZ0zvG0nM/AQCUBw+HAAAQHACA4AAABAcAIDgAAMEBAIDgAAAEBwAgOAAAwQEACA4AAAQHACA4AADBAQAIDgBAcAAAKAnKVftR6KC7j16zLKsn4O079eRQRLKykKtw5trLLX89TAwdFHEjdZL/Fa5w7ZzWvdpaNB5wmIgGd7Ea3aexRKrQE/K2hz06HPlUrYv4AwOaDglVe6zsV8jn/bzlTkzia9VqWisQ0bDuDZdOatlq9NGsnKLG9Uw3zGvbfeopBcsSUfiabrMCrx8L7KprnFp3Kvph9pD551TH1qONxdi+NkTkal/j5v0sItp5NPH45RdE1KxR1fmjHQQCnlzOzllzIzVLPLx7Q59e1vmFsoIi2YL1t1KzxMqOGCJjA8HPW+5ci8vU7LqMg9HaqdqBUj7VfCFK2ReADwoOqVQx2O8sERlWEmz/sb24SBZ+6YWyUEkiVTS0MOHzGLmCZRiqX8dYIlUQUUfnOkO7NRy64JyoQGpqJNy52D09u/DS3Yyy99ukQeVVM9x6zzxTlgpd3My3hz3q5GJ2MCI58bno4bPc3h0sw6Ked3I1f5aW//BZrq5xqjaoulMCPq9N81pX771SFp68mnLyagp3QarVX/WD25ifL6ZliXu1s1g0zjHk9BOvjvX7+0YWSeQeLmarZ7oNXXhebeTr5rTpNvWkZtdlHIxmp5MDrmg9nlpfiFL2BaBiliriItmyHTHjvGx0VYhLetPCphoR2TesmvA0hyucOLDJsu13RQVSIhIVSJftiJk8yK5c/SY8zbWsY1yWCgb6fMNKgv2nn3R2M+f+tCYkftoQex7DTP3WLjAkrpRx6vL73rhZI5qVcag1KuvrC3lEdPp66s5jid8PsF2xO7ZIIieic7fSnqYXCARvHfyHz3LrVDco+6HQOhi1TnVt++EvBCA43tODp7kNzHVewxei0zs61+He3C5Ep3OF1pamcU/+uTjjHr9pXM+0XJ22a1H7/pM3ZanQ0dns/O30xyl5lrWNhAIeESW9ED1IzvltqsvLTHHic1Ep49TlSkwGEbV1qFWWoQbsvndkReeVM9zc7GvciM+0qVc57vE/I/cLuimTKVTruzvVuRKbUfZDoXUwap3q2vbDXwjAUuV9t+QxUpmCiIRC3kH/TiUn7s6Y2wnZRBR1J31U78aB++LbOdTaHZ6ktQWGiGXL1BfXBUOUJ5b6rrtZlgrdWte1b1ilVzuL2tUMWjevdfFOOhGt3R8fubFn50knlBvqGqfWnSKi1XvjZns3uxL77pn8oYjk09dedm9dd/EEp5NXXvJ5TCm7JuQzjSxMO08+obXrsg9GrdPAfXGq23KNf8gLAfChweFoUy3haa7WFTgR5eRJFArWvIYhEeWLpVxh4nNRs0ZVbz/I4p42s6766Hmu2oYKluVuOgj4jEzB6lrk67rHweHzGKu6Jj2mneKmEl1czbjgeJySVyCWPU7JK32cpfR49d4ruYJt26J26QenemX9BuYmtx9kHYxIjryZeuaPHo9T8po2rHrnYTYRMQytntlq5urrqh1NGtjk2y5WGw49KMs9Dq2D0ew0cF+c2rbxBwaU8YUAqPilSmVjvfljWmw6klBKnfO30+aObK5673PTkYSFY1qYGAmJyNRIuGB0i42H1VuISXzdwakOEbk7m8U8yn6/4bnY13iQXDIVvxGf6e5cp1zjLN3qvXGz33Wng2Vpo19bLo+qmOi/zBTvDk/y9WmuJ+QRkZd7PT2Nd/6ouxmONtXKu6eqg9HsVNdWZXkhACpsxsHNe7lPPTceTuBu6atOhqMfZPnviuUen72ZNnekQ7epJ1XXBWY1DA4u9yiWKvSEvB1HEy/HqF+uP22KDpjmOuVbOyKaF3Tz/faqW+u6ypYLi+VZOcXWlqZJL0RaK2uOs5SdIqLrcZlSqVxPWFrmvhYV+wXd3Di/bZFErlCwc9bcePgs16qu8fG13bJzi7NzihdtvK22yZMUkV2DKjyG0ey6jIPR7FTX8MryQgCUgsEPMgHAv7RUAQAEBwAAggMAEBwAgOAAAAQHACA4AAAQHACA4AAABAcAIDgAAMEBAIDgAAAEBwAgOAAAwQEACA4AAAQHACA4AADBAQAIDgD4UjASKX7DCwAw4wAABAcAIDgAAMEBAAgOAAAEBwAgOAAAwQEACA4AQHAAACA4AADBAQAIDgBAcADAl0qAQwBKFocnlF4hZdBmHCUgfB8HvDMsECKA4IAKiAzEByA4kBcVAwnyVcHNUaTGp94yYMYBX2BkYOqBGQcgNTD1AAQH/BdXMrIDwQFIDWQHIDiQGsgOQHDAp3zdIjsQHIDUQHYAggOpgewABAd8ylcpsgPBAQAIDsB0o4JkDN2MSQeCA5Aa5U4NZAeCA+B95hoZQzeXHh+A4AB4n2ULIDjga1+naM2I2vsnYLWC4ACogNQABAdguvGe6xFMOhAcAJhuIDgAsEgBBAcgNQDBAVr8+7cMPvyjVtzmQHAA5hqYbiA4AMoPqYHgACjfdAOpgeCAr3q5gdQABAeUdv2XNzvwf08AwYG5RsVkAaYbCA74GlcoZcwOLFIAwfH10nqpvzM7kBqA4EB2lC87cGsDEBxQvuzAv/UCBMcXK2VQuScFH3LlV0hqvMeYAcEBn+K8Q21+gVsbgOCA8mUHUgNKJ8AhgHdONAAw4/gCvfctg7JPIipwuoEbHAgO+AIXLFikAIIDk44PzY6KTQ1MNxAc8HXNOwAQHFCm7ECgAIIDq5UyZUft/ROUDz61EcIngpFIWRyFL8kn+z3ASA3MOAAAwQFYsGC6AQgOZAfGAwgO+IyvVaQGggOQHUgNQHAgO5AagOCAT+fqRWogOADZgdQABAeyA6kBHwb/cvTr8lH/XSkiAzMOwNQDqQGYccDHmX0gLxAcgPhAZACCAyo6RBAWgOAAgPeEm6MAgOAAAAQHACA4AADBAQAIDgAABAcAIDgAAMEBAAgOAEBwAAAgOOCdEp+8XLclVJQnLmP9M+dvS2XyjzESqUweGRWNV+STJcAheCdLxyHOzRszDCOVyZbOH+fU3Ppj97h2c+iMCQP+/T0dNfW3McN6CgTa304auY54fHOv8mlmds6RY1Fdv2mpeogkUtnIwV2H9u+kLOQq9+jkNmmMl0WLwd09XLet8eUKJ/kGHj19NSXmIBGFhEZuDT6uJxRIpLLvRvYe2s/jUNgFh6YNa1avgjMQwfFZ0hMK/rdnKRE9ePRs+oL1Zw6v/Ng9rtty5D8JjldZOd/5eJax8t7DEVxqqB4icWGR96TlhgaVvHq0VRYq6esJk5JT5XIFn89jWfbp83R9PSERnbt0J/hwROjOXyqbGuWKCoZPXGpWq1qXji33Hon8YcJAnIFYqnze7GzqP0/JSEh67jl8fofeMzbtDCMij/6zkp+nEVFevtit22SWZRu5jpi+YL1L14k795+a5BvYsstErmaOKH+Sb+DAMYv7eC+Mjk1Uvo0vC9zr5bOoY9+Z4WeuEVFAUEiBuOjbsUu4CluDwz36z+o0YPa5y3e5+qpTACJ6/UY0elpAX59F345dkpWdq/ZUs1PVBlUf7wg5mV9Q2NdnUYG4SLMXTZEX77g62qoVGhpUWuw76s/dR3UdQwf7hnfikogo7kGyvW0DrnD9tr+WzB1d2dSIiCqbGi3xHRW09f9cWticvXgHZx1mHJ+9qKuxzeystgUf/3GWj23jeh16T5842muAZ4fjEdenjO0XGRXdu1trhmGKiqWjhnSbO22Ic6fvTx4IWDDTu+eQeRNHey1ZsWu8t2fLFjYpaZnek5af/yuQiCRSWfWqJmF7lj57kdF35CLPrq3nTRu2efexQ9tLgmPVhoO3zmxKy3i95s/DHu0cNUf1U8BOrx5tB3h2CAmNDAgKKSySqD6VyuRqnao2GHkxWvn4j4AZS1fvUZsjlOJxcmpds5qa5fa2DZKfpevaqlN7p3MX77i0sDl76a5HB6e/TlwiokePUxzsGqqES6OHSS8s6tZ8nPwSZx2C43Mlkcr6+ixiiUyNDdcsnVK1isn/hV86ff5WXn4hEQ3w7DDRN3DK2H4nIm9MG9+fiHg8xrGZNZ/PEwoFjs2seTymsKiYm5AnP0vj2hSLi7kZu0LBDhvQmYjqW9bWeleyq3vLKfPWjhne84+AGWp/UihYLs5W/zqZiAb39fDs2qZ97+mqTzv0ma7WqWqD0/zW6WpcrRdNMpmMz9cyY5XL5EIhX3ncuMJFs3246ck37R237TvuO3XIpWuxY4f30Noyy7IMwwj4fKlUhtMPwfHZ3+PgDB7/S59ubcZ7e+4IOUlEdc1q8BgmLSP7xctXzeysuPrcFVVJX8jjMSpXmvzg1sX6+kKFgr1++z5XR08o4KboRMQwWnoP8p9+9Wb8n7uPHTkaFfTbNOVlnCsqkEhlRCSXy4lliYjP55maGKo91ez0rQbfblwzLJS9aKpaxSS/oNDYyECtPPpeop1Nfc3jVrJVZWMej/cyLYuITIwNuUJba8vY+49dnZpwT2PvP2libZmXL65axQSnH+5xfCFi4pL69mxXLJFIJFKupF+v9j/67+js7lz6hm7OduER14goMip6zeYjJS8Aj9H6Js9duqI8sZfPIhenJhtWzIiIuk1EpiaGCUnPiejw0SguaJwdbE5E3iCi4ENnlq7eo/ZUrVPVBs9cuKXWuJJmL5pcHG0fJD5XK8wR5f+yajc389K5WungtHzNXve2LZQlU8b1W7JyFzfhyhUV/Lxq19Tx/ROSXrho3EMBzDg+V2OG9+w1zK+pbQNTUyOJRKqnJ+zbo+3CZVsXzhxR+oZL54+d9dOGnftPCfi8wF+nlFKztYu99+Rl+zYtMjUx7PaNS4/BcxUsO3vyYCJavnD8+B9W1ahW2dmhMfeRxK9+Y2YsXL9t3wlTY8M/Ama8yclTfZpfUKjaqWqDc6YMKSqSqDaupNkLETWsb75m8xHlxxwDe7ufu1Ryf5RblXCfWE8b37+dWzO1pYqrk+2iWT7c424dWy4P3HshbI2yO492jmnp2f1G/ajPfRzr4+nexiEgKGRQH3ecb58mfFlxBXiZljV9QdCRHT9/VXvNsuwk3zVB/tOFAn6FNy6VyWcsCNqw4gecXQiOL9PJszcCgvavWza1uX1DHA1AcAAAaIebowCA4AAABAcAIDgAAMEBAAgOAAAEBwAgOAAAwQEACA4AQHAAAOiA/1ZPRDTF7/c//GerPo6OfXgm6iYRJT550bihJRF17uCyNTjMqr45y1JRcfGwfl1tretxm0z0XWFV35whRiaXd2zj2M7NQVnIVXBs1rj7N62+913h2LTxpNEl31WxeU/Y7diEP1fOJaJL12MjL94SCPgymbyLu2s7t+aFRcVb9x7NzxcbGxuOH9HHoJL+xyvRdViOR1zt1aXNO4+ermqqR/U9mi3j6wUIjk+Is4Ots4Mtd47Om+rNFe4ICecep6S92rw77Jd547lyPp/PlRdLpOu2HNLTE7o62ikL/znWfH76q2yFguXxGJalzOw3Aj6fiOISnly8dtd3ynBDg0riwqK1mw9WrWIcl5Bs08iy+zetTp27Hn7myqA+HkdPX/5IJboOQnjElbJc4WWs9t71AUuVL0TdOrXe5OZpluvrCb/16hRx4aauDetZ1El+nkpEL15mWJjX4gpPnr02uG9nQ4NKRGRoUOlbr07HI67du/+4lVNTInJzto+5n0REH69Eq79ORBVLJL9vDCkQF23eE7Zqwz7/dXu4wUdE3VqyctuSVdviE5KV1bitRHkF67Yc+m3dnm37Sr7o/GV65m9rd//ov+X0+RuqzaqVc3JFBYF/HvBftyfwzwO5ogIuuEPDz/sHBS9esTU69qHqCJes3PYq6w0RFRYV+y3dyOK/eSM4PnHxD5/YNa6v9U+W5rUyst7o2rBZk4ZxCU+4WUazJiXf35GakVWvbm1lnfoWdVIzMnPzCrjvIq1iaizKKyCij1eiVb+e7vp6erMnDTsYFtnF3WXO5OHf+fTdeeA4ER09fclvus/3Pv2u3r6nrMZtdeB/kW7OdvOn+zg1t5XKZEQUefH2wD4eftO9T5y9ptqsWvnfm0e0cm7qN92nlXPTA/+LJCK5XG5sZOg3zXvquEH7Qs+ojrCVc9Po2EdEdO/B45YtbHV9xSFgqfIfk8vlAeuD5XJFWkb2Ur8J2usoFNy3EHOVucJBvT0aNahLRM2aWJ29dLtvjw4PEp96tNf+HaUsEUP/wUUQGn4hMflFV3dXbo2mFJfw5NXfUVhcLFUoWAf7RluDwzzatxw/wkutkYSkZ2OGehKRY1NrHo9HRIO9Ol2Pvh8Tn1hUVKxaU2t5QtKzscN6E5Gbk93hY2eJSMGy7Vs5EFHN6lUK326hVUv7zbv/16NTqzv3Ent2bo3zE8Hxr8+7eAx360Hx92WvlfK2xYnIa5dvxGpdqCc/S7Uwq6VaWZWRoQHDMK9zRESkvCtpXrvms5R0aysL7umzlHRzsxo5Ofm5ooIqlY1zRPmmJkZEVNnE6COVcAZ4dtS61wqFYtb3Q4VCAcuyiU9e8HjMuOF9Hj1+fvrCzWu348cN7/1WbsoUJVuxLPdl6xt2hLZs0aRLB9dzl976LVit5ZrLDQGfzy3iNFWrYsrwmDe5eVmvc1SnbIClyr+kQT2z+IfJ3LurVT2zd9Zvamv15HmqZnmBuOjQ0bOlv/s1t2sYGn7e3sZKWdKzU+tDYWe5t1NxYdHhsLM9O7Vpbt/o+p14IroRfd/BvhERfbwSXViWZVnW2soy+t5DbkUQHnGlsKjYPyi4UQOL77y97t1/rKzGbWJtVffOvUdEFB37kCt6+iLNzclOKpPJ/v55aq6+ZjkR2TWufyvmARHdinnQxLo+ETGlrkDcnOz3/xXhYNcI5zBmHP+BEQO779x/PDziChGNHtrrnfXr1KqWkvqK+90g5aqEIUYul/fq3IY741WXKo0a1B3Uu+TDCwd769Dw87/M/e6fGGpi9TpXFLA+WCgQyGTyLu4u9jYNrOqZbd17NDrmIfehKRH16dbuI5XoYtPIcu2WQyMH99h14Pi5y3f4PN7oob0MKuk7NrVeGriTZdk+3dspq/0wYTARDe3XZeveo5EXb1lbWXCfGXm0b7lszS5L89qGBpVkMrlAwOfqa5YT0WCvzjv2Hzt/+Y6+vpBbs2hVu2a18Igrnl3aujo22Rd6eqDnNziH/2X4zlH4jL3OEW3fd2zO5OE4FJhxAJTJ3bjEv05ElTIxAcw4AOATgpujAIDgAAAEBwAgOAAAwQEACA4AAAQHACA4AADBAQAIDgBAcAAAIDgAAMEBAAgOAEBwAACCAwAAwQEACI5/QXIL57SRo5VPn7pq/yrznM1bK7ZftY4qvH1duyBJShKF7MfrDgiOD8Lo6bFyeeGNm++46rZ83Av7Y7ev7ELP2tp02FC87oDg+FBVp019E7RetUSelZU+YWKq98j0CRPlWVlvgtYrxOK0sSU/fSBJSkod7p3Su2/uzt1qk4jM+Qtz9wQrRKJXvvPSxoxL9R5ZHHuvlE04qu0rG9Hc5Klr69eBa1N9RqX07V9wJoKIcoP3pvQf+HLAoMLLV9Tqy9+8yZg2I9VndNrY7+TZr9W60NxHre0DggN0MmjdiogKr//zI8nZ/iuMPXuZB+829uyVHbCy6rSpPENDs+1buL+KgvdVmzXTfO/unG3bVdthJRJjz16VfbyzV6yq7D3CbMe2WisDMn9aXMomyuRStq9sRHMTVirlV61qvmdX7fVB2ct/I6KcDZvMg3fXWrUyL+yoWv3XASuNenQ337PTuHevN0Hr1XZBcx+1tg9fG/w8QvknHeuCDFqVvLcX3rhZc/lSIjLq2SP790C1ytV8ZxeEnxCfv6DIz387rnkGbdsQUeGlS9Jnz0uudnEhyeU6N9GS+SWNaNlEoTAZ0J+IhJYWirx8IjJ075A5b77p8KG1An5TFBSo1i+8eq3Grz8TkUlfL6OuXTT70bKPGu0DZhxQ6qTDzZXh8QqvXf978lDaj0tkzJhJRKbeIxjeW8eZEQiIxyMiViY32/qn+Z6d5ru211z2K/H5ujbRcs/l70Y0N2GEQp6pyd/1GCKq6b+88qiRopADmfMXqtVn5fKSveDzeSYmWnrS2EfN9gHBAeW402HQyq3g1GkiKjh12sDNlXs3JkXJDy9L4uKNenZnJcWsRKK1qUrOTgURkUQkjrqYs3lLWTZRbV9nL2+HjiIvL9VnlL6TY60V/uKoKLX6+g7NxZFniSjv0OHXqwM1u9CyjzycNliqQDlVcnVhhELuqqs+d07mwh9FBw7yDAy4+Xwll5bpk6fW2bSBiEyHD00dNkLP1pZnasJKJIyenlpT1ef7Zf20WLT/AMPn1/j1F62bCOvXy9m8pcqEkhuuqu1z3tkLz8TE8JuOqYOHsayi6uRJ8uxs1frV/eZlLvwxd18Iz9i4VoC/Zhea+wiAX3IDACxVAADBAQAIDgBAcAAAggMAAMEBAAgOAEBwAACCAwAQHAAACA4AQHAAAIIDABAcAIDgAABAcAAAggMAEBwAgOAAAAQHACA4AAAQHACA4AAABAcAIDgA4Ovz/yuIJGhfdrqJAAAAAElFTkSuQmCC', DEMO_PDF = 'data:application/pdf;base64,JVBERi0xLjQKMSAwIG9iajw8Pj5lbmRvYmoKdHJhaWxlcjw8Pj4KJSVFT0YK';
  function tod() { return new Date().toISOString().slice(0, 10); }
  function addDays(n) { return new Date(Date.now() + n * 864e5).toISOString().slice(0, 10); }
  DB.tod = tod;
  /* ---- batch inventory ---- */
  function batchesOf(all, sku) { return all[sku] || (all[sku] = []); }
  function saleable(b) { return !b.q && b.exp >= tod(); }
  DB.batchState = function (b) { if (b.exp < tod()) return 'Expired'; var d = (Date.parse(b.exp) - Date.now()) / 864e5; return d <= 60 ? 'Expiring soon' : 'OK'; };
  function syncOn(sku, all, inv) { var bs = all[sku]; if (!bs || !bs.length) return; var s = inv[sku] || (inv[sku] = { on: 0, res: 0, dmg: 0, rec: 0 }); s.on = bs.filter(saleable).reduce(function (a, b) { return a + b.qty; }, 0); s.dmg = bs.reduce(function (a, b) { return a + (b.dmg || 0); }, 0); s.ret = bs.reduce(function (a, b) { return a + (b.ret || 0); }, 0); }
  var _stock0 = DB.stock, _invAll0 = DB.invAll;
  DB.stock = function (sku) { ensureSeed(); var all = get('batches', {}), inv = get('inv', {}); if (all[sku] && all[sku].length) { syncOn(sku, all, inv); set('inv', inv); } return _stock0(sku); };
  DB.invAll = function () { ensureSeed(); var all = get('batches', {}), inv = get('inv', {}); Object.keys(all).forEach(function (k) { syncOn(k, all, inv); }); set('inv', inv); return inv; };
  DB.allBatches = function () { ensureSeed(); return get('batches', {}); };
  DB.batches = function (sku) { return (DB.allBatches()[sku] || []).slice().sort(function (a, b) { return a.exp < b.exp ? -1 : 1; }); };
  function bLog(sku, kind, delta, before, after, why, by, ref) { log(sku, kind, delta, before, after, why, by, ref); }
  DB.stockIn = function (sku, a, by) {
    ensureSeed(); var qty = parseInt(a.qty, 10), no = String(a.no || '').trim().toUpperCase();
    if (!no) return { error: 'Enter the batch number.' }; if (!(qty > 0)) return { error: 'Enter a quantity of at least 1.' }; if (!/^\d{4}-\d{2}-\d{2}$/.test(a.mfg || '') || !/^\d{4}-\d{2}-\d{2}$/.test(a.exp || '')) return { error: 'Enter the manufacturing and expiry dates.' };
    if (a.mfg > a.exp) return { error: 'The manufacturing date cannot be after the expiry date.' }; if (a.mfg > tod()) return { error: 'The manufacturing date cannot be in the future.' }; if (a.exp < tod()) return { error: 'This stock has already expired and cannot be received as saleable stock.' };
    var all = get('batches', {}), inv = get('inv', {}), bs = batchesOf(all, sku), b = bs.filter(function (x) { return x.no === no; })[0], before = (inv[sku] || { on: 0 }).on;
    if (b) { if (b.mfg !== a.mfg || b.exp !== a.exp) return { error: 'Batch ' + no + ' already exists with different manufacturing or expiry dates.' }; b.qty += qty; b.rec = (b.rec || 0) + qty; }
    else bs.push({ no: no, mfg: a.mfg, exp: a.exp, qty: qty, rec: qty, dmg: 0, ret: 0, qq: 0, q: false, unit: a.unit || 'PCS', supplier: a.supplier || '', ref: a.ref || '', by: by, at: Date.now() });
    inv[sku] = inv[sku] || { on: 0, res: 0, dmg: 0, rec: 0 }; inv[sku].rec = (inv[sku].rec || 0) + qty; syncOn(sku, all, inv); set('batches', all); set('inv', inv);
    bLog(sku, 'STOCK IN \u00B7 batch ' + no, qty, before, inv[sku].on, (a.reason || a.ref || 'Stock received') + ' \u00B7 mfg ' + a.mfg + ' exp ' + a.exp, by); return { ok: true, allocated: DB.allocatePreorders(by) };
  };
  DB.stockOutB = function (sku, a, by) {
    ensureSeed(); var qty = parseInt(a.qty, 10); if (!(a.reason && a.reason.trim().length >= 5)) return { error: 'Enter the destination or reason (at least 5 characters).' }; if (!(qty > 0)) return { error: 'Enter a quantity of at least 1.' };
    var all = get('batches', {}), inv = get('inv', {}), s = inv[sku]; if (!s) return { error: 'No stock record.' }; syncOn(sku, all, inv); if (qty > s.on - s.res) return { error: 'Only ' + Math.max(0, s.on - s.res) + ' units are available (the rest are reserved for orders).' };
    var bs = batchesOf(all, sku).filter(saleable).sort(function (x, y) { return x.exp < y.exp ? -1 : 1; }), left = qty, before = s.on, used = [];
    if (a.no) { var one = bs.filter(function (x) { return x.no === a.no; })[0]; if (!one) return { error: 'Batch ' + a.no + ' is expired, quarantined or does not exist, so it cannot be issued.' }; if (qty > one.qty) return { error: 'Batch ' + a.no + ' has only ' + one.qty + ' units.' }; bs = [one]; }
    bs.forEach(function (b) { if (!left) return; var t = Math.min(left, b.qty); b.qty -= t; left -= t; used.push(b.no + ' x' + t); }); if (left) return { error: 'Not enough saleable (unexpired) batch stock.' };
    syncOn(sku, all, inv); set('batches', all); set('inv', inv); bLog(sku, 'STOCK OUT', -qty, before, inv[sku].on, a.reason + ' \u00B7 ' + used.join(', ') + (a.ref ? ' \u00B7 ref ' + a.ref : ''), by); return { ok: true, used: used };
  };
  DB.damageB = function (sku, a, by) {
    ensureSeed(); var qty = parseInt(a.qty, 10), all = get('batches', {}), inv = get('inv', {}), b = batchesOf(all, sku).filter(function (x) { return x.no === a.no; })[0]; if (!b) return { error: 'Choose the batch.' }; if (!(qty > 0) || qty > b.qty) return { error: 'Quantity must be between 1 and the batch quantity (' + b.qty + ').' };
    var before = inv[sku].on; b.qty -= qty; b.dmg = (b.dmg || 0) + qty; syncOn(sku, all, inv); set('batches', all); set('inv', inv); bLog(sku, 'DAMAGED \u00B7 batch ' + b.no, -qty, before, inv[sku].on, a.reason || 'Damaged', by); return { ok: true };
  };
  DB.returnB = function (sku, a, by) {
    ensureSeed(); var qty = parseInt(a.qty, 10), all = get('batches', {}), inv = get('inv', {}), b = batchesOf(all, sku).filter(function (x) { return x.no === a.no; })[0]; if (!b) return { error: 'Choose the batch the goods came from.' }; if (!(qty > 0)) return { error: 'Enter the quantity returned.' };
    if (!(a.reason && a.reason.trim().length >= 5)) return { error: 'Enter the reason (at least 5 characters).' }; var before = (inv[sku] || { on: 0 }).on; b.qty += qty; b.ret = (b.ret || 0) + qty; syncOn(sku, all, inv); set('batches', all); set('inv', inv); bLog(sku, 'RETURNED \u00B7 batch ' + b.no, qty, before, inv[sku].on, a.reason, by); return { ok: true, allocated: DB.allocatePreorders(by) };
  };
  DB.setBatchQ = function (sku, no, flag, why, by) {
    ensureSeed(); if (!(why && why.trim().length >= 5)) return { error: 'Enter a reason.' }; var all = get('batches', {}), inv = get('inv', {}), b = batchesOf(all, sku).filter(function (x) { return x.no === no; })[0]; if (!b) return { error: 'Batch not found.' };
    var before = inv[sku].on; if (flag) { b.qq = (b.qq || 0) + b.qty; b.qty = 0; } else { b.qty += (b.qq || 0); b.qq = 0; if (b.exp < tod()) return { error: 'Expired stock cannot be released.' }; } syncOn(sku, all, inv); set('batches', all); set('inv', inv); bLog(sku, flag ? 'QUARANTINE \u00B7 batch ' + no : 'RELEASE \u00B7 batch ' + no, inv[sku].on - before, before, inv[sku].on, why, by); return { ok: true };
  };
  /* counts and adjustments are REQUESTS; another person (Finance or Host) approves, then one movement is posted */
  DB.countRequest = function (sku, a, by) {
    ensureSeed(); var all = get('batches', {}), b = batchesOf(all, sku).filter(function (x) { return x.no === a.no; })[0], n = parseInt(a.counted, 10); if (!b) return { error: 'Choose the batch.' }; if (!(n >= 0)) return { error: 'Enter the physically counted quantity.' };
    if (!(a.reason && a.reason.trim().length >= 5)) return { error: 'Record the reason for the variance.' }; var l = get('invreq', []), r = { id: 'CR-' + (l.length + 1001), sku: sku, no: b.no, system: b.qty, counted: n, reason: a.reason.trim(), by: by, at: Date.now(), status: 'Pending', kind: a.kind || 'Count' }; l.unshift(r); set('invreq', l); return { ok: true, req: r };
  };
  DB.listCountReqs = function () { ensureSeed(); return get('invreq', []); };
  DB.countDecide = function (id, approve, note, by, role) {
    ensureSeed(); if (role !== 'finance' && role !== 'admin') return { error: 'Only Finance or the Host can approve.' }; var l = get('invreq', []), r = l.filter(function (x) { return x.id === id; })[0]; if (!r) return { error: 'Request not found.' }; if (r.status !== 'Pending') return { ok: true, already: true };
    if (r.by === by && role !== 'admin') return { error: 'The person who requested a count cannot approve it.' }; if (!approve) { r.status = 'Rejected'; r.note = note; r.decidedBy = by; set('invreq', l); return { ok: true }; }
    var all = get('batches', {}), inv = get('inv', {}), b = batchesOf(all, r.sku).filter(function (x) { return x.no === r.no; })[0]; if (b.qty !== r.system) { r.status = 'Conflict'; r.note = 'Stock moved since the count. Recount.'; set('invreq', l); return { error: 'Stock moved since the request was made. Please recount.' }; }
    var after = Object.assign({}, b), d = r.counted - b.qty; var tmp = inv[r.sku].on - b.qty + r.counted; if (tmp < inv[r.sku].res) { r.status = 'Conflict'; r.note = 'Would drop below stock reserved for orders.'; set('invreq', l); return { error: 'This would leave less stock than is reserved for orders. Resolve the reserved orders first.' }; }
    var before = inv[r.sku].on; b.qty = r.counted; syncOn(r.sku, all, inv); set('batches', all); set('inv', inv); r.status = 'Approved'; r.note = note; r.decidedBy = by; r.decidedAt = Date.now(); set('invreq', l); bLog(r.sku, (r.kind === 'Count' ? 'COUNT ADJUST' : 'ADJUST') + ' \u00B7 batch ' + r.no, d, before, inv[r.sku].on, r.reason + ' (approved by ' + by + ')', by); return { ok: true };
  };
  var _consume0 = DB.consumeOrderStock;
  DB.consumeOrderStock = function (o) {
    var all = get('batches', {}); (o.items || []).forEach(function (l) { var k = SEL.sku(l.pid, l.vid), bs = all[k]; if (!bs || !bs.length) return; var left = l.qty; bs.filter(saleable).sort(function (x, y) { return x.exp < y.exp ? -1 : 1; }).forEach(function (b) { if (!left) return; var t = Math.min(left, b.qty); b.qty -= t; left -= t; }); }); set('batches', all); _consume0(o);
  };
  /* ---- payment proofs (screenshots): Sales and Finance upload; Finance verifies; Logistics only views ---- */
  function sniffOk(data) { var m = /^data:([a-z\/]+);base64,([A-Za-z0-9+\/=]{0,32})/.exec(data || ''); if (!m) return false; var s = m[2], b; s = s.slice(0, s.length - s.length % 4); try { b = atob(s); } catch (e) { return false; } var sig = { 'image/png': '\x89PNG', 'image/jpeg': '\xff\xd8\xff', 'application/pdf': '%PDF' }[m[1]]; return !!sig && b.indexOf(sig) === 0; }
  DB.addProof = function (code, orderId, p, by, role) {
    if (['employee', 'finance', 'admin'].indexOf(role) < 0) return { error: 'Only Sales and Finance can upload a payment screenshot.' }; var o = DB.getOrder(code, orderId); if (!o) return { error: 'Order not found.' }; if (o.payment.status === 'Paid' && !DB.diffPending(o)) return { error: 'This order is already paid.' };
    if (!/^data:(image\/png|image\/jpeg|application\/pdf)/.test(p.data || '')) return { error: 'Upload a PNG, JPEG or PDF file.' }; if (!sniffOk(p.data)) return { error: 'The file content does not match a PNG, JPEG or PDF.' }; if (p.size > 1300000) return { error: 'The file is too large for this demo (limit about 1.3 MB).' };
    if (!p.ref || String(p.ref).trim().length < 6) return { error: 'Enter the payment reference or UTR number (at least 6 characters).' }; var amt = parseFloat(p.amount); if (!(amt > 0)) return { error: 'Enter the amount paid.' }; if (!p.date || p.date > tod()) return { error: 'Enter the payment date (not in the future).' };
    var due = DB.dueOf(o); if (amt > due + 0.5) return { error: 'The amount is more than the balance due (' + due + ').' };
    var dup = false, ref = String(p.ref).trim().toLowerCase(); DB.allOrders().forEach(function (x) { (x.proofs || []).forEach(function (y) { if (y.status !== 'Rejected' && String(y.ref).toLowerCase() === ref) dup = true; }); }); if (dup) return { error: 'This payment reference has already been submitted.' };
    var res = null; patchOrder(code, orderId, function (x) { x.proofs = x.proofs || []; res = { id: 'PR-' + Date.now().toString(36).toUpperCase() + x.proofs.length, method: p.method || 'UPI', ref: String(p.ref).trim(), date: p.date, amount: amt, file: { name: p.name, size: p.size, data: p.data }, by: by, byRole: role, at: new Date().toISOString(), status: 'Awaiting verification' }; x.proofs.push(res); x.history = x.history || []; x.history.push({ status: 'Payment proof uploaded', at: res.at }); });
    DB.addStaffNotif({ key: 'proof:' + res.id, kind: 'proof', audience: ['finance', 'admin'], title: 'Payment proof to verify', text: orderId + ' \u00B7 ' + p.method + ' \u00B7 ' + amt + ' \u00B7 ref ' + res.ref, count: 1, at: Date.now() }); DB.notifyAction(by, 'Payment proof uploaded', orderId + ' ref ' + res.ref, 'payment'); return { ok: true, proof: res };
  };
  DB.verifyProof = function (code, orderId, pid, amount, note, by, role) {
    if (role !== 'finance' && role !== 'admin') return { error: 'Only Finance verifies payments.' }; if (!(note && note.trim().length >= 5)) return { error: 'Record how this was verified (for example the bank statement line).' };
    var o = DB.getOrder(code, orderId); if (!o) return { error: 'Order not found.' }; var pr = (o.proofs || []).filter(function (x) { return x.id === pid; })[0]; if (!pr) return { error: 'Proof not found.' }; if (pr.status === 'Verified') return { ok: true, already: true }; if (pr.status === 'Rejected') return { error: 'This proof was rejected.' };
    if (pr.by === by && role !== 'admin') return { error: 'You cannot verify a proof that you uploaded.' }; var amt = parseFloat(amount), due = Math.round((o.totals.total - (o.received || 0)) * 100) / 100; if (!(amt > 0) || amt > pr.amount + 0.001) return { error: 'The verified amount must be more than zero and not more than the claim.' }; if (amt > due + 0.5) return { error: 'This would pay more than the order total.' };
    var now = new Date().toISOString(), full = false; patchOrder(code, orderId, function (x) { x.received = Math.round(((x.received || 0) + amt) * 100) / 100; var q = x.proofs.filter(function (y) { return y.id === pid; })[0]; q.status = 'Verified'; q.verifiedAmount = amt; q.verifiedBy = by; q.verifiedAt = now; q.note = note.trim(); full = x.received >= x.totals.total - 0.5; x.history.push({ status: full ? 'Payment verified (full)' : 'Part payment verified', at: now }); });
    ledgerInvoice(code, o); postL(code, { type: 'Payment received', credit: amt, debit: 0, orderId: orderId, ref: pr.ref, desc: 'Verified ' + pr.method + ' payment', by: by }); if (full) DB.markPaid(code, orderId, { method: pr.method + ' (verified proof)', txn: pr.ref, by: by }); DB.notifyAction(by, 'Payment verified', orderId + ' ' + amt, 'payment'); return { ok: true, full: full };
  };
  DB.rejectProof = function (code, orderId, pid, reason, by, role) {
    if (role !== 'finance' && role !== 'admin') return { error: 'Only Finance verifies payments.' }; if (!(reason && reason.trim().length >= 5)) return { error: 'Give a reason for the rejection.' }; var done = false; patchOrder(code, orderId, function (x) { (x.proofs || []).forEach(function (y) { if (y.id === pid && y.status === 'Awaiting verification') { y.status = 'Rejected'; y.reason = reason.trim(); y.verifiedBy = by; done = true; } }); }); return done ? { ok: true } : { error: 'This proof is not awaiting verification.' };
  };
  /* ---- v32: the dealer pays by scanning the company QR / bank transfer and attaches the payment screenshot.
     It joins the same proof queue as a Sales upload, so Finance confirms it with one tap (verifyProof). ---- */
  DB.submitPayShot = function (code, orderId, p, by) {
    var o = DB.getOrder(code, orderId); if (!o) return { error: 'Order not found.' }; if (o.cancelled) return { error: 'This order has expired.' };
    if (o.payment.status === 'Paid' && !DB.diffPending(o)) return { error: 'This order is already paid.' };
    p = p || {}; if (!/^data:(image\/png|image\/jpeg|application\/pdf)/.test(p.data || '')) return { error: 'Attach the payment screenshot (PNG or JPEG).' }; if (!sniffOk(p.data)) return { error: 'The file content does not match a PNG, JPEG or PDF.' }; if (p.size > 1300000) return { error: 'The screenshot is too large (limit about 1.3 MB).' };
    if ((o.proofs || []).filter(function (x) { return x.status === 'Awaiting verification'; }).length >= 3) return { error: 'Your earlier screenshots are still being checked by our Finance team.' };
    var due = DB.dueOf(o); if (!(due > 0)) return { error: 'Nothing is due on this order.' };
    var res = null, ref = String(p.ref || '').trim() || ('SHOT-' + orderId);
    patchOrder(code, orderId, function (x) { x.proofs = x.proofs || []; res = { id: 'PR-' + Date.now().toString(36).toUpperCase() + x.proofs.length, method: 'UPI / bank transfer', ref: ref, date: tod(), amount: due, file: { name: p.name || 'payment-screenshot', size: p.size, data: p.data }, by: by, byRole: 'dealer', at: new Date().toISOString(), status: 'Awaiting verification' }; x.proofs.push(res); x.history = x.history || []; x.history.push({ status: 'Payment screenshot uploaded by dealer', at: res.at }); });
    DB.addStaffNotif({ key: 'proof:' + res.id, kind: 'proof', audience: ['finance', 'admin'], title: 'Payment screenshot to confirm', text: orderId + ' \u00B7 ' + due + ' \u00B7 from ' + code, count: 1, at: Date.now() }); DB.notifyAction(by, 'Payment screenshot uploaded', orderId + ' ' + due, 'payment'); return { ok: true, proof: res };
  };
  /* ---- v31: card / online payment link. Sales or Finance attach a link (from any card gateway or
     bank page); the dealer taps it to pay online. The order is still marked paid only when Finance
     verifies the screenshot/UTR proof afterwards, exactly like a manual payment. ---- */
  DB.addPayLink = function (code, orderId, url, label, by, role) {
    if (['employee', 'finance', 'admin'].indexOf(role) < 0) return { error: 'Only Sales and Finance can add a payment link.' };
    var o = DB.getOrder(code, orderId); if (!o) return { error: 'Order not found.' };
    if (o.payment.status === 'Paid' && !DB.diffPending(o)) return { error: 'This order is already paid.' };
    url = String(url || '').trim();
    if (!/^https:\/\/[^\s<>"']{6,400}$/i.test(url)) return { error: 'Enter a valid payment link that starts with https://' };
    var res = null, lab = String(label || '').trim().slice(0, 60) || 'Pay online (card / UPI)';
    patchOrder(code, orderId, function (x) {
      x.payLinks = x.payLinks || [];
      res = { id: 'PL-' + Date.now().toString(36).toUpperCase() + x.payLinks.length, url: url, label: lab, by: by, byRole: role, at: new Date().toISOString(), active: true };
      x.payLinks.push(res); x.history = x.history || []; x.history.push({ status: 'Card / online payment link shared with the dealer', at: res.at });
    });
    DB.addStaffNotif({ key: 'plink:' + res.id, kind: 'payment', audience: ['finance', 'admin'], title: 'Payment link shared', text: orderId + ' · ' + lab, count: 1, at: Date.now() });
    DB.notifyAction(by, 'Payment link shared', orderId + ' · ' + lab, 'payment');
    return { ok: true, link: res };
  };
  DB.removePayLink = function (code, orderId, plid, by, role) {
    if (['employee', 'finance', 'admin'].indexOf(role) < 0) return { error: 'Only Sales and Finance can change a payment link.' };
    var done = false; patchOrder(code, orderId, function (x) { (x.payLinks || []).forEach(function (l) { if (l.id === plid && l.active !== false) { l.active = false; l.removedBy = by; done = true; } }); });
    return done ? { ok: true } : { error: 'That payment link was not found.' };
  };
  DB.activePayLinks = function (o) { return ((o && o.payLinks) || []).filter(function (l) { return l && l.active !== false && /^https:\/\//i.test(l.url || ''); }); };

  /* ---- Warehouse "seen" (like a read receipt): only when a Warehouse employee opens the order ---- */
  DB.markSeen = function (code, id, by) { var ok = false; patchOrder(code, id, function (o) { if (o.payment.status !== 'Paid' || o.cancelled) return; var t = Date.now(), w = o.whSeen || (o.whSeen = { first: t, firstBy: by, count: 0, views: [] }); w.last = t; w.lastBy = by; w.count++; w.views.push({ by: by, at: t }); if (w.views.length > 20) w.views.shift(); ok = true; }); return ok; };
  DB.whState = function (o) { if (o.payment.status !== 'Paid' || o.cancelled) return ''; var pk = o.packing; if (['Dispatched', 'Out for delivery', 'Delivered'].indexOf(o.status) > -1 || (pk && pk.state === 'Packed')) return 'PACKED'; if (pk && (pk.state === 'Packing' || (pk.items || []).length)) return 'PACKING'; return o.whSeen ? 'SEEN' : 'NOT_SEEN'; };
  /* ---- dealer ledger (Debit = dealer owes us, Credit = dealer paid / we credited). Balance = debits - credits. Only Finance posts. Entries are never edited: corrections are reversal entries. ---- */
  function postL(code, e) { var all = get('dledger', {}), l = all[code] || (all[code] = []), n = get('dlseq', 1000) + 1; set('dlseq', n); e.no = 'LE-' + n; e.at = e.at || Date.now(); e.date = e.date || new Date(e.at).toISOString().slice(0, 10); e.status = 'Posted'; e.debit = e.debit || 0; e.credit = e.credit || 0; l.push(e); set('dledger', all); return e; }
  function ledgerInvoice(code, o) { var l = get('dledger', {})[code] || []; if (l.some(function (x) { return x.orderId === o.id && x.type === 'Invoice / debit'; })) return; postL(code, { type: 'Invoice / debit', debit: o.totals.total, credit: 0, orderId: o.id, ref: o.invoice ? o.invoice.no : o.id, desc: 'Order ' + o.id, by: 'SYSTEM', at: new Date(o.date).getTime() }); }
  var _markPaid2 = DB.markPaid; DB.markPaid = function (code, id, info) {
    var o = _markPaid2(code, id, info); if (o) { ledgerInvoice(code, o); var paid = 0; (get('dledger', {})[code] || []).forEach(function (x) { if (x.orderId === o.id && x.type === 'Payment received') paid += x.credit; }); var rest = Math.round((o.totals.total - paid) * 100) / 100; if (rest > 0.004) postL(code, { type: 'Payment received', credit: rest, debit: 0, orderId: o.id, ref: (info && info.txn) || '', desc: 'Payment for order ' + o.id, by: (info && info.by) || 'SYSTEM', at: o.payment.paidAt ? new Date(o.payment.paidAt).getTime() : Date.now() }); } return o;
  };
  DB.dlLedger = function (code) { ensureSeed(); return (get('dledger', {})[code] || []).slice(); };
  DB.balance = function (code) { var b = 0; DB.dlLedger(code).forEach(function (x) { b += x.debit - x.credit; }); return Math.round(b * 100) / 100; };
  DB.createNote = function (code, n, by, role) {
    if (role !== 'finance' && role !== 'admin') return { error: 'Only Finance can create debit or credit notes.' }; var amt = parseFloat(n.amount); if (n.kind !== 'Credit' && n.kind !== 'Debit') return { error: 'Choose credit note or debit note.' }; if (!(amt > 0)) return { error: 'Enter the amount.' }; if (!(n.reason && n.reason.trim().length >= 5)) return { error: 'Enter the reason (at least 5 characters).' };
    var seq = get('noteseq', 0) + 1, no = (n.kind === 'Credit' ? 'CN' : 'DN') + '/26-27/' + (100 + seq); if (n.ref) { var dup = DB.dlLedger(code).some(function (x) { return x.ref && x.ref === n.ref && /note/.test(x.type); }); if (dup) return { error: 'This reference has already been used for a note.' }; } set('noteseq', seq);
    var e = postL(code, { type: n.kind + ' note', debit: n.kind === 'Debit' ? amt : 0, credit: n.kind === 'Credit' ? amt : 0, orderId: n.orderId || '', returnId: n.returnId || '', ref: n.ref || '', noteNo: no, desc: n.reason.trim(), by: by, tax: n.tax || '' }); DB.notifyAction(by, n.kind + ' note ' + no, code + ' ' + amt, 'ledger'); return { ok: true, entry: e };
  };
  DB.recordRefund = function (code, amount, reason, ref, by, role, returnId) {
    if (role !== 'finance' && role !== 'admin') return { error: 'Only Finance can record refunds.' }; var amt = parseFloat(amount); if (!(amt > 0)) return { error: 'Enter the refund amount.' }; if (!(reason && reason.trim().length >= 5)) return { error: 'Enter the reason.' };
    var e = postL(code, { type: 'Refund', debit: amt, credit: 0, ref: ref || '', returnId: returnId || '', desc: reason.trim(), by: by }); if (returnId) { var l = get('returns', []); l.forEach(function (r) { if (r.id === returnId) { r.refund = 'Refunded'; r.history.push({ s: 'Refunded', at: Date.now(), by: by }); } }); set('returns', l); } return { ok: true, entry: e };
  };
  DB.reverseEntry = function (code, no, reason, by, role) {
    if (role !== 'finance' && role !== 'admin') return { error: 'Only Finance can correct the ledger.' }; if (!(reason && reason.trim().length >= 5)) return { error: 'Enter the reason.' }; var all = get('dledger', {}), l = all[code] || [], o = l.filter(function (x) { return x.no === no; })[0]; if (!o) return { error: 'Entry not found.' }; if (o.reversed || o.rev) return { error: 'This entry has already been reversed (or is itself a reversal).' };
    o.reversed = true; set('dledger', all); var e = postL(code, { type: 'Reversal', debit: o.credit, credit: o.debit, orderId: o.orderId, ref: o.no, rev: o.no, desc: 'Reversal of ' + o.no + ': ' + reason.trim(), by: by }); return { ok: true, entry: e };
  };
  /* ---- returns and inward ---- */
  DB.listReturns = function (code) { ensureSeed(); var l = get('returns', []); return code ? l.filter(function (r) { return r.dealer === code; }) : l; };
  DB.getReturn = function (id) { return DB.listReturns().filter(function (r) { return r.id === id; })[0]; };
  function saveReturn(r) { var l = get('returns', []); l.forEach(function (x, i) { if (x.id === r.id) l[i] = r; }); set('returns', l); }
  function rh(r, s, by, note) { r.status = s; r.history.push({ s: s, at: Date.now(), by: by || '', note: note || '' }); }
  /* Returns and replacements can be requested only within 21 days after the order was delivered */
  DB.RETURN_DAYS = 21;
  DB.deliveredAt = function (o) { var h = (o.history || []).filter(function (x) { return /^delivered/i.test(x.status); }).slice(-1)[0]; return (h && h.at) || (o.shipment && o.shipment.deliveredAt) || o.date; };
  DB.returnState = function (o, now) {
    if (!o) return { ok: false, why: 'Order not found.' }; if (o.payment.status !== 'Paid' || ['Dispatched', 'Out for delivery', 'Delivered'].indexOf(o.status) < 0) return { ok: false, why: 'Only dispatched or delivered orders can be returned.' };
    if (o.status !== 'Delivered') return { ok: true, daysLeft: null }; var left = DB.RETURN_DAYS - Math.floor(((now || Date.now()) - new Date(DB.deliveredAt(o)).getTime()) / 864e5);
    return left >= 0 ? { ok: true, daysLeft: left } : { ok: false, expired: true, why: 'The ' + DB.RETURN_DAYS + '-day return window after delivery has ended, so a return or replacement can no longer be requested for this order.' };
  };
  DB.requestReturn = function (code, orderId, lines, reason, by, role, images) {
    ensureSeed(); var o = DB.getOrder(code, orderId); if (!o) return { error: 'Order not found.' }; if (o.payment.status !== 'Paid' || ['Dispatched', 'Out for delivery', 'Delivered'].indexOf(o.status) < 0) return { error: 'Only dispatched or delivered orders can be returned.' };
    var rst = DB.returnState(o); if (!rst.ok) return { error: rst.why };
    if (!(reason && reason.trim().length >= 5)) return { error: 'Tell us why the goods are being returned.' };
    /* v31: a dealer must attach at least 3 photos of the goods so the team can verify the return */
    var imgs = Array.isArray(images) ? images.filter(function (d) { return typeof d === 'string' && /^data:image\/(png|jpeg|jpg|webp);base64,/i.test(d); }) : [];
    if (imgs.length > 8) imgs = imgs.slice(0, 8);
    var tooBig = imgs.some(function (d) { return d.length > 2200000; });
    if (tooBig) return { error: 'One of the photos is too large. Please use smaller images (they are compressed automatically on upload).' };
    if (role === 'dealer' && imgs.length < 3 && seedDepth === 0) return { error: 'Please attach at least 3 clear photos of the goods for verification.' };
    var prior = DB.listReturns(code).filter(function (r) { return r.orderId === orderId && r.status !== 'Rejected'; }), out = [];
    var bad = null; lines.forEach(function (x) { if (!(x.qty > 0)) return; var it = o.items.filter(function (i) { return SEL.sku(i.pid, i.vid) === x.sku; })[0]; if (!it) { bad = 'Product not in this order.'; return; } var used = 0; prior.forEach(function (r) { r.lines.forEach(function (l) { if (l.sku === x.sku) used += l.qty; }); }); if (x.qty > it.qty - used) bad = 'You can return at most ' + (it.qty - used) + ' of ' + it.product + '.'; out.push({ sku: x.sku, name: it.product + ' ' + it.variant, qty: x.qty, unit: it.price, batchNo: x.batchNo || '', recv: 0, acc: 0 }); });
    if (bad) return { error: bad }; if (!out.length) return { error: 'Choose at least one product and quantity.' }; var n = get('retseq', 100) + 1; set('retseq', n); var d = DB.getDealer(code), r = { id: 'RT-' + n, orderId: orderId, dealer: code, dealerName: d ? d.name : code, lines: out, reason: reason.trim(), status: '', history: [], by: by, byRole: role, at: Date.now(), inward: [], emp: o.attr ? o.attr.emp : '', refund: '', images: imgs };
    rh(r, 'Return requested', by); var l = get('returns', []); l.unshift(r); set('returns', l); DB.addStaffNotif({ key: 'ret:' + r.id, kind: 'return', audience: ['finance', 'admin'], title: 'Return requested ' + r.id, text: d ? d.name : code, count: 1, at: Date.now() }); return { ok: true, ret: r };
  };
  DB.decideReturn = function (id, approve, note, by, role) {
    if (role !== 'finance' && role !== 'admin') return { error: 'Only Finance approves returns.' }; var r = DB.getReturn(id); if (!r) return { error: 'Return not found.' }; if (r.status !== 'Return requested' && r.status !== 'Under review') return { error: 'This return has already been decided.' }; if (!(note && note.trim().length >= 3)) return { error: 'Add a note.' };
    r.notes = (r.notes || []).concat([{ by: by, at: Date.now(), text: note }]); rh(r, approve ? 'Approved: awaiting goods' : 'Rejected', by); saveReturn(r); return { ok: true };
  };
  DB.receiveReturn = function (id, a, by, role) {
    if (['warehouse', 'finance', 'admin', 'logistics'].indexOf(role) < 0) return { error: 'Only receiving staff or Finance can record a return receipt.' }; var r = DB.getReturn(id); if (!r) return { error: 'Return not found.' }; if (['Approved: awaiting goods', 'RTO booked', 'Picked up', 'In transit', 'Partly received', 'Inspection pending'].indexOf(r.status) < 0) return { error: 'This return is not awaiting goods.' };
    var ln = r.lines.filter(function (l) { return l.sku === a.sku; })[0]; if (!ln) return { error: 'Product not on this return.' }; var recv = parseInt(a.recv, 10), acc = parseInt(a.acc || 0, 10); if (!(recv > 0) || recv > ln.qty - ln.recv) return { error: 'Quantity received must be between 1 and ' + (ln.qty - ln.recv) + '.' };
    var cls = a.cls || 'Pending inspection'; if (['Saleable', 'Damaged', 'Expired', 'Quarantined', 'Pending inspection', 'Rejected'].indexOf(cls) < 0) return { error: 'Choose the classification.' }; if (cls === 'Rejected') acc = 0; else if (cls === 'Pending inspection' || cls === 'Quarantined') acc = recv; else if (!(acc >= 0 && acc <= recv)) return { error: 'Accepted quantity cannot be more than received.' };
    var no = String(a.no || ln.batchNo || '').trim().toUpperCase(), all = get('batches', {}), inv = get('inv', {}), bs = batchesOf(all, a.sku), b = bs.filter(function (x) { return x.no === no; })[0], before = (inv[a.sku] || { on: 0 }).on, note = '';
    if (acc > 0) {
      if (!b) { if (cls === 'Saleable' || cls === 'Damaged' || cls === 'Expired') { if (!a.mfg || !a.exp || !no || a.mfg > a.exp) return { error: 'This batch is not in stock. Enter the batch number and valid manufacturing / expiry dates, or classify as Quarantined until it is verified.' }; b = { no: no, mfg: a.mfg, exp: a.exp, qty: 0, rec: 0, dmg: 0, ret: 0, qq: 0, q: false, unit: 'PCS', supplier: 'Return ' + id, by: by, at: Date.now() }; bs.push(b); } else { b = { no: no || ('UNVERIFIED-' + id), mfg: a.mfg || '2000-01-01', exp: a.exp || addDays(365), qty: 0, rec: 0, dmg: 0, ret: 0, qq: 0, q: false, unit: 'PCS', supplier: 'Return ' + id, by: by, at: Date.now() }; bs.push(b); } }
      if (cls === 'Saleable') { if (b.exp < tod()) { cls = 'Expired'; note = ' (auto-classified Expired)'; } else { b.qty += acc; b.ret = (b.ret || 0) + acc; } } if (cls === 'Damaged' || cls === 'Expired') { b.dmg = (b.dmg || 0) + acc; if (cls === 'Expired') b.expd = (b.expd || 0) + acc; } if (cls === 'Quarantined' || cls === 'Pending inspection') b.qq = (b.qq || 0) + acc;
    }
    if (!all[a.sku]) all[a.sku] = bs; inv[a.sku] = inv[a.sku] || { on: 0, res: 0, dmg: 0, rec: 0 }; syncOn(a.sku, all, inv); set('batches', all); set('inv', inv);
    if (acc > 0 || cls === 'Rejected') bLog(a.sku, 'RETURN INWARD \u00B7 ' + cls + ' \u00B7 batch ' + no, cls === 'Saleable' ? acc : 0, before, inv[a.sku].on, id + ' order ' + r.orderId + ' \u00B7 received ' + recv + ', accepted ' + acc + (a.notes ? ' \u00B7 ' + a.notes : '') + note, by);
    ln.recv += recv; ln.acc += (cls === 'Rejected' ? 0 : acc); r.inward.push({ sku: a.sku, name: ln.name, batchOrig: ln.batchNo, batchActual: no, mfg: (b && b.mfg) || a.mfg || '', exp: (b && b.exp) || a.exp || '', recv: recv, acc: cls === 'Rejected' ? 0 : acc, rej: recv - (cls === 'Rejected' ? 0 : acc), cls: cls, cond: a.cond || '', notes: a.notes || '', by: by, at: Date.now() });
    var all2 = r.lines.every(function (l) { return l.recv >= l.qty; }), pend = r.inward.some(function (x) { return x.cls === 'Pending inspection'; }); rh(r, !all2 ? 'Partly received' : (pend ? 'Inspection pending' : (r.lines.every(function (l) { return l.acc >= l.qty; }) ? 'Accepted' : (r.lines.some(function (l) { return l.acc > 0; }) ? 'Partially accepted' : 'Rejected after inspection'))), by); if (['Accepted', 'Partially accepted', 'Rejected after inspection'].indexOf(r.status) > -1 && !r.verified) r.verified = { by: by, at: Date.now() }; saveReturn(r); if (['Accepted', 'Partially accepted', 'Rejected after inspection', 'Inspection pending'].indexOf(r.status) > -1) DB.addStaffNotif({ key: 'inw:' + id + ':' + r.status, kind: 'return', audience: ['finance', 'logistics', 'admin'], title: 'Return ' + id + ' inwarded: ' + r.status, text: r.dealerName + ' \u00B7 order ' + r.orderId + ' \u00B7 accepted value incl. GST ' + DB.returnValue(r) + '. Finance: issue a credit note or a replacement.', count: 1, at: Date.now() }); return { ok: true, cls: cls };
  };
  DB.resolveInward = function (id, idx, a, by, role) {
    if (['finance', 'admin', 'warehouse'].indexOf(role) < 0) return { error: 'Not allowed.' }; var r = DB.getReturn(id), e = r && r.inward[idx]; if (!e || (e.cls !== 'Pending inspection' && e.cls !== 'Quarantined')) return { error: 'Nothing to resolve.' };
    var cls = a.cls, acc = cls === 'Rejected' ? 0 : parseInt(a.acc, 10); if (['Saleable', 'Damaged', 'Expired', 'Rejected'].indexOf(cls) < 0) return { error: 'Choose the result.' }; if (!(acc >= 0 && acc <= e.recv)) return { error: 'Accepted cannot be more than received.' };
    var all = get('batches', {}), inv = get('inv', {}), b = (all[e.sku] || []).filter(function (x) { return x.no === e.batchActual; })[0]; if (!b) return { error: 'Batch not found.' }; var before = inv[e.sku].on, q = e.recv;
    b.qq = Math.max(0, (b.qq || 0) - q); if (cls === 'Saleable' && b.exp >= tod()) { b.qty += acc; b.ret = (b.ret || 0) + acc; } else if (cls === 'Damaged' || cls === 'Expired' || (cls === 'Saleable' && acc)) b.dmg = (b.dmg || 0) + acc;
    syncOn(e.sku, all, inv); set('batches', all); set('inv', inv); bLog(e.sku, 'INSPECTION \u00B7 ' + cls + ' \u00B7 batch ' + b.no, cls === 'Saleable' ? acc : 0, before, inv[e.sku].on, id + ' resolved by inspection', by);
    var ln = r.lines.filter(function (l) { return l.sku === e.sku; })[0]; ln.acc = ln.acc - e.acc + acc; e.cls = cls; e.acc = acc; e.rej = e.recv - acc; e.resolvedBy = by; var pend = r.inward.some(function (x) { return x.cls === 'Pending inspection'; });
    if (!pend) { rh(r, r.lines.every(function (l) { return l.acc >= l.qty; }) ? 'Accepted' : (r.lines.some(function (l) { return l.acc > 0; }) ? 'Partially accepted' : 'Rejected after inspection'), by); r.verified = { by: by, at: Date.now() }; } saveReturn(r); return { ok: true };
  };
  DB.returnValue = function (r) { var v = 0; r.lines.forEach(function (l) { v += l.acc * l.unit; }); return Math.round(v * 100) / 100; };
  DB.issueReturnCredit = function (id, amount, by, role) {
    if (role !== 'finance' && role !== 'admin') return { error: 'Only Finance can issue credit notes.' }; var r = DB.getReturn(id); if (!r) return { error: 'Return not found.' }; if (['Accepted', 'Partially accepted', 'Rejected after inspection'].indexOf(r.status) < 0) return { error: 'Finish receiving and inspection first.' };
    var amt = parseFloat(amount); if (r.status === 'Rejected after inspection') { rh(r, 'Closed', by, 'No credit: all goods rejected'); saveReturn(r); return { ok: true }; } if (!(amt > 0) || amt > DB.returnValue(r) + 0.5) return { error: 'Credit cannot be more than the accepted value (' + DB.returnValue(r) + ').' };
    var n = DB.createNote(r.dealer, { kind: 'Credit', amount: amt, reason: 'Sales return ' + r.id + ' (order ' + r.orderId + ')', orderId: r.orderId, returnId: r.id, ref: r.id }, by, role); if (n.error) return n; r.creditNote = n.entry.noteNo; r.creditAmt = amt; rh(r, 'Credit note issued', by); r.refund = DB.balance(r.dealer) < 0 ? 'Refund pending' : ''; if (!r.refund) rh(r, 'Closed', by); saveReturn(r); return { ok: true, note: n.entry.noteNo };
  };
  /* ---- Host can never create another Host; attendance follows portal login/logout ---- */
  var _saveEmp = DB.saveEmployee; DB.saveEmployee = function (e) { var d = String(e.dept || '').toLowerCase(); if (d === 'host' || /^\s*(host|super[\s_-]*admin)\s*$/i.test(e.designation || '')) return { error: 'The Host role cannot be created through employee management.' }; var old = DB.getEmployee(String(e.id).trim().toUpperCase()); if (old && old.dept === 'host') return { error: 'The Host account cannot be changed here.' }; return _saveEmp(e); };
  DB.portalLogin = function (code) {
    ensureSeed(); var e = DB.getEmployee(code); if (!e || e.dept === 'host') return { exempt: true }; var a = get('att', {}), l = a[code] || (a[code] = []), last = l[l.length - 1], now = new Date(), res = { resumed: false };
    if (last && !last.out) { if (String(last.in).slice(0, 10) !== now.toISOString().slice(0, 10) && new Date(last.in).toDateString() !== now.toDateString()) { var end = new Date(last.seen || (new Date(last.in).getTime() + 60000)); last.out = end.toISOString(); last.flag = 'Previous day was not signed out. End time is the last known activity. Please review.'; last.src = 'recovery'; l.push({ in: now.toISOString(), out: null, src: 'portal', seen: now.toISOString() }); DB.addStaffNotif({ key: 'rec:' + code + ':' + now.toDateString(), kind: 'attendance', audience: ['admin'], title: 'Attendance needs review', text: e.name + ' did not sign out on the previous day', count: 1, at: Date.now() }); } else { res.resumed = true; last.seen = now.toISOString(); } }
    else l.push({ in: now.toISOString(), out: null, src: 'portal', seen: now.toISOString() }); set('att', a); return res;
  };
  DB.portalSeen = function (code) { var e = DB.getEmployee(code); if (!e || e.dept === 'host') return; var a = get('att', {}), l = a[code] || [], last = l[l.length - 1]; if (last && !last.out) { last.seen = new Date().toISOString(); set('att', a); } };
  DB.portalLogout = function (code) { var e = DB.getEmployee(code); if (!e || e.dept === 'host') return; var st = DB.clockState(code); if (st && st.state === 'in') DB.clockOut(code); };


  /* =========================== v8 seed: erase old demo data, create three clearly labelled DEMO orders per scenario =========================== */
  var OPS3 = 1, inOps3 = false;
  function ensureOps3() {
    if (inOps3 || get('ops3', 0) >= OPS3 || !get('ops', 0) || !get('ops2', 0)) return; inOps3 = true;
    try {
      var dealers = get('dealers', []); dealers.forEach(function (d) { set('orders.' + d.code, []); });
      ['preorders', 'samples', 'invlog', 'activity', 'staffnotifs', 'ledger', 'returns', 'invreq'].forEach(function (k) { set(k, []); }); set('dledger', {}); set('batches', {}); set('invseq', 898);
      var inv = get('inv', {}), all = {}, i = 0; function mb(no, qty, ma, ed, sup) { return { no: no, mfg: addDays(-ma), exp: addDays(ed), qty: qty, rec: qty, dmg: 0, ret: 0, qq: 0, q: false, unit: 'PCS', supplier: sup || 'Opening stock (DEMO)', ref: 'OPENING', by: 'SYSTEM', at: Date.now() }; }
      Object.keys(inv).forEach(function (sku) { var s = inv[sku]; s.res = 0; s.dmg = 0; s.ret = 0; i++; var n = s.on; all[sku] = []; if (n <= 0) return; var sh = sku.replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, 6);
        if (n >= 12 && i % 3 === 0) { var a = Math.floor(n * 0.4); all[sku].push(mb(sh + '-A25', a, 200, 130), mb(sh + '-B26', n - a, 60, 540)); } else if (i % 7 === 0) all[sku].push(mb(sh + '-C25', n, 300, 45)); else all[sku].push(mb(sh + '-B26', n, 60, 540));
        if (i === 5) all[sku].push(mb(sh + '-OLD24', 3, 600, -10)); });
      set('batches', all); set('inv', inv);
      var cand = []; SEL.BRANDS.forEach(function (b) { (SEL.CATALOG[b.id] || []).forEach(function (p) { p.variants.forEach(function (v) { var sk = SEL.sku(p.id, v.id); if (inv[sk] && inv[sk].on >= 25) cand.push({ b: b.id, p: p, v: v, sku: sk }); }); }); });
      function brandsDiff() { var seen = {}, out = []; cand.forEach(function (c) { if (!seen[c.b] || seen[c.b] < 2) { seen[c.b] = (seen[c.b] || 0) + 1; out.push(c); } }); return out; } var pool = brandsDiff();
      function line(ci, qty, d) { var c = pool[ci % pool.length]; return { key: c.p.id + '|' + c.v.id + '|' + ci, brand: c.b, pid: c.p.id, product: c.p.name, vid: c.v.id, variant: c.v.label, flavour: (c.p.flavours && c.p.flavours[0]) || '', mrp: c.v.mrp, price: DB.priceFor(d, c.p.id, c.v.id, c.v.mrp), qty: qty }; }
      var DEMO = 'DEMO order. Test data only.';
      function mk(code, id, specs, o) {
        o = o || {}; var d = DB.getDealer(code), lines = specs.map(function (s) { return line(s[0], s[1], d); }), at = new Date(Date.now() - (o.hours || 3) * 36e5).toISOString(), gj = parseInt(d.pincode, 10) >= 360000 && parseInt(d.pincode, 10) <= 396999;
        var ord = { id: id, date: at, status: 'Placed', payment: { method: '', status: 'Pending', txn: '' }, items: lines, freebies: [], totals: DB.calcTotals(lines, null, gj), address: d.address, pin: d.pincode, phone: d.phone, gst: d.gst, note: DEMO, shipment: null, history: [{ status: 'Placed', at: at }], buyer: { name: d.name, gst: d.gst, address: d.address, pin: d.pincode, phone: d.phone }, ship: { address: d.address, pin: d.pincode, phone: d.phone }, demo: true,
          createdBy: o.by === 'dealer' || !o.by ? { code: d.code, name: d.name, role: 'dealer' } : { code: o.by, name: (DB.getEmployee(o.by) || {}).name || o.by, role: 'employee' } };
        DB.addOrder(code, ord); var emp = (DB.getOrder(code, id).attr || {}).emp || 'SALES', n = 0;
        if (o.paid) DB.markPaid(code, id, { method: 'UPI (demo)', txn: 'DEMO-TXN-' + id, by: 'FINANCE' });
        if (o.invoice) DB.attachInvoiceFile(code, id, { name: 'invoice-' + id + '.pdf', size: 90, data: DEMO_PDF, no: 'DEMO/26-27/' + (900 + (++invN)) }, 'LOGISTICS');
        if (o.eway) DB.attachEwayFile(code, id, { name: 'eway-' + id + '.pdf', size: 90, data: DEMO_PDF, no: 'DEMO-EW-' + id }, 'LOGISTICS');
        (o.proofs || []).forEach(function (p) { var r = DB.addProof(code, id, { method: p.method || 'UPI', ref: p.ref, date: addDays(-1), amount: p.amount === 'half' ? Math.round(ord.totals.total / 2) : (p.amount || ord.totals.total), name: 'payment-screenshot.png', size: 6594, data: DEMO_PNG }, emp, 'employee'); if (p.reject && r.proof) DB.rejectProof(code, id, r.proof.id, p.reject, 'FINANCE', 'finance'); if (p.verify && r.proof) DB.verifyProof(code, id, r.proof.id, p.verify === 'half' ? Math.round(ord.totals.total / 2) : ord.totals.total, 'Bank statement line verified (demo)', 'FINANCE', 'finance'); });
        if (o.seen) DB.markSeen(code, id, 'WAREHOUSE');
        if (o.pack) { DB.startPacking(code, id, 'WAREHOUSE'); var its = (DB.getOrder(code, id).packing || {}).items || []; its.forEach(function (it, k) { if (o.pack === 'done' || (o.pack === 'half' && k === 0)) DB.verifyItem(code, id, it.key, it.req, 'WAREHOUSE'); }); if (o.pack === 'done') DB.finishPacking(code, id, 'WAREHOUSE'); }
        if (o.ship) shipPatch(code, id, { partner: 'delhivery', trackingId: 'DEMOTRK' + id.replace(/\D/g, ''), status: o.ship }, 'LOGISTICS'); return id;
      }
      var invN = 0, D1 = 'DEMO001', D2 = 'DEMO002', D3 = 'DEMO003';
      /* 1. Warehouse packing view: three paid orders waiting to be packed (not seen / seen / packing started) */
      mk(D1, 'DEMO-W1', [[0, 4], [3, 6]], { paid: true, hours: 5, by: 'SALES' }); mk(D2, 'DEMO-W2', [[1, 3], [4, 5]], { paid: true, invoice: true, seen: true, hours: 4 }); mk(D3, 'DEMO-W3', [[2, 2], [5, 4]], { paid: true, invoice: true, seen: true, pack: 'half', hours: 2, by: 'SALES2' });
      /* 2. Logistics view: packed orders (no invoice yet / invoice uploaded / above 50,000 needing an e-way bill) */
      mk(D1, 'DEMO-L1', [[6, 3]], { paid: true, seen: true, pack: 'done', hours: 8 }); mk(D2, 'DEMO-L2', [[7, 4], [8, 2]], { paid: true, invoice: true, seen: true, pack: 'done', hours: 7 });
      var big = pool[9 % pool.length], bq = Math.min(Math.ceil(54000 / DB.priceFor(DB.getDealer(D3), big.p.id, big.v.id, big.v.mrp)), inv[big.sku].on - 2); mk(D3, 'DEMO-L3', [[9, bq]], { paid: true, invoice: true, seen: true, pack: 'done', hours: 6 });
      /* 3. Finance: payment screenshots awaiting verification (full / part / replacement after a rejection) */
      mk(D1, 'DEMO-F1', [[10, 3]], { proofs: [{ ref: 'DEMOUTR100001' }], hours: 20 }); mk(D2, 'DEMO-F2', [[11, 4], [0, 2]], { proofs: [{ ref: 'DEMOUTR100002', amount: 'half' }], hours: 18 }); mk(D3, 'DEMO-F3', [[2, 3]], { proofs: [{ ref: 'DEMOUTR100003', reject: 'Amount not found in the bank statement' }, { ref: 'DEMOUTR100004' }], hours: 16 });
      /* 4. Sales: orders needing attention (awaiting payment, awaiting payment, part paid) */
      mk(D1, 'DEMO-S1', [[4, 2]], { hours: 30 }); mk(D2, 'DEMO-S2', [[5, 3]], { hours: 26 }); mk(D3, 'DEMO-S3', [[6, 4]], { proofs: [{ ref: 'DEMOUTR100005', amount: 'half', verify: 'half' }], hours: 22 });
      /* 5. Returns and ledger: delivered orders with a return at three stages */
      [['DEMO-R1', D1, [[7, 4], [1, 2]]], ['DEMO-R2', D2, [[8, 4], [2, 3]]], ['DEMO-R3', D3, [[3, 5]]]].forEach(function (x, k) { mk(x[1], x[0], x[2], { paid: true, invoice: true, seen: true, pack: 'done', ship: 'Delivered', hours: 100 + k * 24 }); });
      function bat(sku) { return (DB.batches(sku)[0] || {}); }
      var o1 = DB.getOrder(D1, 'DEMO-R1'), it1 = o1.items[0]; DB.requestReturn(D1, 'DEMO-R1', [{ sku: SEL.sku(it1.pid, it1.vid), qty: 2 }], 'Two packs arrived with broken seals', D1, 'dealer');
      var o2 = DB.getOrder(D2, 'DEMO-R2'), a2 = o2.items[0], b2 = o2.items[1], r2 = DB.requestReturn(D2, 'DEMO-R2', [{ sku: SEL.sku(a2.pid, a2.vid), qty: 3 }, { sku: SEL.sku(b2.pid, b2.vid), qty: 2 }], 'Ordered the wrong flavour and some tubs were dented', D2, 'dealer').ret; DB.decideReturn(r2.id, true, 'Approved after photos were checked', 'FINANCE', 'finance');
      var ba = bat(SEL.sku(a2.pid, a2.vid)), bb = bat(SEL.sku(b2.pid, b2.vid)); DB.receiveReturn(r2.id, { sku: SEL.sku(a2.pid, a2.vid), no: ba.no, mfg: ba.mfg, exp: ba.exp, recv: 3, acc: 3, cls: 'Saleable', cond: 'Sealed and intact' }, 'WAREHOUSE', 'warehouse'); DB.receiveReturn(r2.id, { sku: SEL.sku(b2.pid, b2.vid), no: bb.no, mfg: bb.mfg, exp: bb.exp, recv: 2, acc: 2, cls: 'Damaged', cond: 'Dented and leaking' }, 'WAREHOUSE', 'warehouse');
      var o3 = DB.getOrder(D3, 'DEMO-R3'), a3 = o3.items[0], r3 = DB.requestReturn(D3, 'DEMO-R3', [{ sku: SEL.sku(a3.pid, a3.vid), qty: 2 }], 'Excess stock: dealer closing a counter', D3, 'dealer').ret; DB.decideReturn(r3.id, true, 'Approved', 'FINANCE', 'finance'); var bc = bat(SEL.sku(a3.pid, a3.vid));
      DB.receiveReturn(r3.id, { sku: SEL.sku(a3.pid, a3.vid), no: bc.no, mfg: bc.mfg, exp: bc.exp, recv: 2, acc: 2, cls: 'Saleable', cond: 'Sealed and intact' }, 'WAREHOUSE', 'warehouse'); DB.issueReturnCredit(r3.id, DB.returnValue(DB.getReturn(r3.id)), 'FINANCE', 'finance');
      /* preorders: three, visible to Finance, Sales and Logistics */
      [[D1, 'bolt-mg', '5lb'], [D2, 'pl-pb', 'p12'], [D3, 'wm-wi', '1kg']].forEach(function (x) { var f = SEL.findProduct(x[1]), fl = f && f.product.flavours ? f.product.flavours[0] : ''; try { DB.addPreorder(x[0], { pid: x[1], vid: x[2], qty: 2, flavour: fl }); } catch (e) {} });
      set('activity', []); set('staffnotifs', []); set('invlog', []); var at = get('att', {}); Object.keys(at).forEach(function (k) { var l = at[k]; if (l && l.length && !l[l.length - 1].out) l[l.length - 1].out = new Date(new Date(l[l.length - 1].in).getTime() + 8.5 * 36e5).toISOString(); }); set('att', at);
      set('ops3', OPS3);
    } finally { inOps3 = false; }
  }


  /* ---- incentive policy (Host configures; Finance reports). Estimates are never payable until the Host approves. ---- */
  DB.incPolicy = function () { ensureSeed(); return get('incpol', { basis: 'Verified collected payments, excluding GST, net of returns', defPct: 1, brand: {} }); };
  DB.saveIncPolicy = function (p, by) { set('incpol', p); set('incpolv', get('incpolv', 0) + 1); DB.notifyAction(by, 'Incentive policy changed', 'version ' + get('incpolv', 1), 'security'); return p; };
  DB.incApprovals = function () { ensureSeed(); return get('incappr', {}); };
  DB.approveInc = function (key, amount, by) { var a = get('incappr', {}); a[key] = { amount: amount, by: by, at: Date.now(), policy: get('incpolv', 0) }; set('incappr', a); DB.notifyAction(by, 'Incentive approved', key + ' ' + amount, 'ledger'); return a[key]; };


  /* =========================== v9: restructure (confirmation, Razorpay demo, RTO, sample packing, proof edits, incentives) =========================== */
  var OPS4 = 2, inOps4 = false;
  function ensureOps4() {
    if (inOps4 || get('ops4', 0) >= OPS4 || !get('ops3', 0)) return; inOps4 = true;
    try { get('dealers', []).forEach(function (d) { var l = get('orders.' + d.code, null); if (!l) return; l.forEach(function (o) { if (o.payment && o.payment.status === 'Paid' && !o.confirmed) { o.confirmed = { by: o.attr && o.attr.emp ? o.attr.emp : 'SYSTEM', at: o.payment.paidAt || o.date }; } }); set('orders.' + d.code, l); }); /* demo targets: Aarav meets his target (eligible), Priya misses hers (not eligible), the others have none */
      var m = DB.ym(Date.now()), led = {}; (get('ledger', [])).forEach(function (x) { if (x.month === m) { led[x.emp] = led[x.emp] || {}; led[x.emp][x.brand] = (led[x.emp][x.brand] || 0) + x.paise; } });
      Object.keys(led).forEach(function (emp) { var br = Object.keys(led[emp]), tot = br.reduce(function (a, b) { return a + led[emp][b]; }, 0) / 100; br.forEach(function (b) { var ach = led[emp][b] / 100; if (emp === 'SALES') DB.setTarget(emp, b, m, Math.max(100, Math.floor(ach * 0.6)), 'ADMIN'); else if (emp === 'SALES2') DB.setTarget(emp, b, m, Math.ceil(ach * 2.5) + 500, 'ADMIN'); }); });
      set('ops4', OPS4); } finally { inOps4 = false; }
  }
  /* a paid order reaches Logistics and Warehouse only after the Sales team confirms it */
  DB.confirmOrder = function (code, id, by) {
    var res = { error: 'Order not found.' }; patchOrder(code, id, function (o) { if (o.payment.status !== 'Paid') { res = { error: 'Only a paid order can be confirmed.' }; return; } if (o.confirmed) { res = { ok: true, already: true }; return; } var at = new Date().toISOString(); o.confirmed = { by: by, at: at }; o.history = o.history || []; o.history.push({ status: 'Confirmed by Sales', at: at }); res = { ok: true }; });
    if (res.ok && !res.already) { DB.addStaffNotif({ key: 'cf:' + id, kind: 'order', audience: ['logistics', 'warehouse', 'admin'], title: 'New confirmed order ' + id, text: 'Paid and confirmed by Sales. Ready for invoice and packing.', count: 1, at: Date.now() }); DB.notifyAction(by, 'Order confirmed', id, 'order'); } return res;
  };
  /* ---- Razorpay (DEMO simulation: the live platform uses Razorpay Orders, Payment Links and the verified webhook) ---- */
  function rnd(n) { var s = ''; while (s.length < n) s += Math.random().toString(36).slice(2).toUpperCase(); return s.slice(0, n); }
  DB.rzpCreate = function (code, id, kind, by, extra) {
    var o = DB.getOrder(code, id); if (!o) return { error: 'Order not found.' }; if (o.payment.status === 'Paid') return { error: 'This order is already paid.' }; if (['QR', 'LINK', 'UPI'].indexOf(kind) < 0) return { error: 'Choose a payment method.' };
    var due = Math.round((o.totals.total - (o.received || 0)) * 100) / 100; if (kind === 'UPI' && !/^[\w.\-]{2,}@[\w]{2,}$/.test((extra && extra.upi) || '')) return { error: 'Enter the dealer\u2019s UPI ID (for example name@bank).' };
    var short = rnd(8), r = { id: 'plink_DEMO' + short, kind: kind, amount: due, link: 'https://rzp.io/i/DEMO' + short, upi: (extra && extra.upi) || '', qr: kind === 'QR' ? 'upi://pay?pa=demo.razorpay@sbi&pn=S-ELEVEN%20NUTRITION&am=' + due + '&cu=INR&tn=' + encodeURIComponent(id) : 'https://rzp.io/i/DEMO' + short, status: 'created', by: by, at: new Date().toISOString() };
    patchOrder(code, id, function (x) { x.rzp = (x.rzp || []).concat([r]); x.history = x.history || []; x.history.push({ status: 'Razorpay ' + (kind === 'QR' ? 'QR' : kind === 'LINK' ? 'payment link' : 'UPI request') + ' created', at: r.at }); }); return { ok: true, rzp: r };
  };
  DB.rzpPaid = function (code, id, rid, by) {   /* DEMO ONLY: stands in for the Razorpay webhook */
    var o = DB.getOrder(code, id), r = o && (o.rzp || []).filter(function (x) { return x.id === rid; })[0]; if (!r) return { error: 'Payment request not found.' }; if (o.payment.status === 'Paid') return { ok: true, already: true };
    var n = get('rcseq', 0) + 1, pid = 'pay_DEMO' + rnd(10), at = new Date().toISOString(), meth = r.kind === 'QR' ? 'UPI QR' : (r.kind === 'LINK' ? 'Card / UPI link' : 'UPI request'); set('rcseq', n);
    var ref = DB.markPaid(code, id, { method: 'Razorpay (' + meth + ')', txn: pid, by: 'RAZORPAY' });
    patchOrder(code, id, function (x) { x.receipt = { no: 'RCPT/26-27/' + (100 + n), gateway: 'Razorpay', paymentId: pid, method: meth, amount: r.amount, at: at, linkId: r.id }; (x.rzp || []).forEach(function (y) { if (y.id === rid) y.status = 'paid'; }); x.history.push({ status: 'Razorpay payment received. Receipt ' + 'RCPT/26-27/' + (100 + n), at: at }); });
    DB.notifyAction(by, 'Razorpay payment received', id + ' ' + r.amount, 'payment'); return { ok: !!ref };
  };
  /* The Warehouse never sees payment details: no proofs, no receipt, no method, no date, and the payment lines of the status history are replaced */
  DB.maskOrderFor = function (role, o) {
    if (role !== 'warehouse' || !o) return o;
    var m = JSON.parse(JSON.stringify(o)), PAYH = /payment|paid|proof|utr|receipt|credit note|refund|settle|cheque|neft|upi|bank|ledger/i;
    m.proofs = []; m.payLinks = []; m.payment = { status: o.payment && o.payment.status, method: '', txn: '', masked: true }; delete m.received; delete m.receipt; if (m.diff) m.diff = { status: m.diff.status };
    m.history = (m.history || []).map(function (h) { return PAYH.test(h.status) ? { status: 'Payment details unavailable for you', at: h.at } : h; });
    return m;
  };
  DB.receiptOf = function (o) { if (o && o.payment && o.payment.masked) return null; if (o.receipt) return o.receipt; if (o.payment && o.payment.status === 'Paid' && !/proof/i.test(o.payment.method || '')) return { no: 'RCPT/' + o.id, gateway: 'Razorpay (demo checkout)', paymentId: o.payment.txn || '', method: o.payment.method || 'UPI', amount: o.totals.total, at: o.payment.paidAt }; return null; };
  /* ---- finance can correct payment details, including the proof photo; every edit is kept ---- */
  DB.editProof = function (code, id, pid, f, by, role) {
    if (role !== 'finance' && role !== 'admin') return { error: 'Only Finance can edit payment details.' }; var o = DB.getOrder(code, id), pr = o && (o.proofs || []).filter(function (x) { return x.id === pid; })[0]; if (!pr) return { error: 'Proof not found.' };
    var verified = pr.status === 'Verified', ch = [], upd = {}; if (f.ref != null && String(f.ref).trim() !== pr.ref) { if (String(f.ref).trim().length < 6) return { error: 'Enter the UTR / reference (at least 6 characters).' }; var dup = false, k = String(f.ref).trim().toLowerCase(); DB.allOrders().forEach(function (x) { (x.proofs || []).forEach(function (y) { if (y.id !== pid && y.status !== 'Rejected' && String(y.ref).toLowerCase() === k) dup = true; }); }); if (dup) return { error: 'This reference is already used on another proof.' }; upd.ref = String(f.ref).trim(); ch.push('reference ' + pr.ref + ' to ' + upd.ref); }
    if (f.method && f.method !== pr.method) { upd.method = f.method; ch.push('method ' + pr.method + ' to ' + f.method); } if (f.date && f.date !== pr.date) { if (f.date > tod()) return { error: 'The payment date cannot be in the future.' }; upd.date = f.date; ch.push('date ' + pr.date + ' to ' + f.date); }
    if (f.amount != null && parseFloat(f.amount) !== pr.amount) { if (verified) return { error: 'The amount of a verified payment cannot be edited. Post a ledger reversal instead.' }; var a = parseFloat(f.amount); if (!(a > 0)) return { error: 'Enter the amount.' }; upd.amount = a; ch.push('amount ' + pr.amount + ' to ' + a); }
    if (f.data) { if (!sniffOk(f.data)) return { error: 'The file content does not match a PNG, JPEG or PDF.' }; if (f.size > 1300000) return { error: 'The file is too large for this demo.' }; upd.file = { name: f.name, size: f.size, data: f.data }; ch.push('proof photo replaced'); }
    if (!ch.length) return { error: 'Nothing was changed.' }; if (!(f.why && f.why.trim().length >= 5)) return { error: 'Record the reason for the change.' };
    patchOrder(code, id, function (x) { x.proofs.forEach(function (y) { if (y.id === pid) { Object.assign(y, upd); y.audit = (y.audit || []).concat([{ by: by, at: new Date().toISOString(), changes: ch, why: f.why.trim() }]); } }); }); DB.notifyAction(by, 'Payment details edited', id + ': ' + ch.join('; '), 'payment'); return { ok: true };
  };
  /* ---- return orders: approval (Host or Finance), RTO booking by Logistics, receipt by Warehouse ---- */
  var _rq0 = DB.requestReturn; DB.requestReturn = function (code, orderId, lines, reason, by, role) { var r = _rq0.apply(DB, arguments); if (r.ok) { var l = get('returns', []); l.forEach(function (x) { if (x.id === r.ret.id) x.origin = role === 'dealer' ? 'Dealer' : 'Sales'; }); set('returns', l); r.ret.origin = role === 'dealer' ? 'Dealer' : 'Sales'; DB.addStaffNotif({ key: 'retap:' + r.ret.id, kind: 'return', audience: ['admin', 'finance'], title: 'Return order needs approval ' + r.ret.id, text: (r.ret.dealerName || code) + ' (' + (role === 'dealer' ? 'asked by the dealer' : 'created by Sales') + ')', count: 1, at: Date.now() }); } return r; };
  var PRE_APPROVAL = ['Return requested', 'Under review', 'Rejected'];
  DB.opsReturns = function () { return DB.listReturns().filter(function (r) { return PRE_APPROVAL.indexOf(r.status) < 0; }); };   /* Logistics and Warehouse see a return only after approval */
  DB.bookRTO = function (id, a, by, role) {
    if (role !== 'logistics' && role !== 'admin') return { error: 'Only Logistics books the return pickup.' }; var r = DB.getReturn(id); if (!r) return { error: 'Return not found.' }; if (['Approved: awaiting goods', 'RTO booked'].indexOf(r.status) < 0) return { error: 'The return must be approved first.' };
    if (!(a.partner && a.partner.trim())) return { error: 'Choose the logistics partner.' }; if (!(a.awb && a.awb.trim().length >= 4)) return { error: 'Enter the booking / tracking number.' }; if (!a.pickupDate) return { error: 'Enter the pickup date.' }; if (!(a.pickupAddr && a.pickupAddr.trim().length >= 10)) return { error: 'Enter the pickup address.' };
    r.rto = { partner: a.partner.trim(), awb: a.awb.trim(), url: (a.url || '').trim(), pickupDate: a.pickupDate, pickupAddr: a.pickupAddr.trim(), note: a.note || '', by: by, at: Date.now() }; rh(r, 'RTO booked', by, a.partner + ' ' + a.awb); saveReturn(r);
    DB.addStaffNotif({ key: 'rto:' + id, kind: 'return', audience: ['warehouse', 'finance', 'admin'], title: 'Return pickup booked for ' + id, text: r.rto.partner + ' \u00B7 ' + r.rto.awb + ' \u00B7 pickup ' + r.rto.pickupDate, count: 1, at: Date.now() }); return { ok: true };
  };
  DB.rtoUpdate = function (id, status, by, role) { if (role !== 'logistics' && role !== 'admin') return { error: 'Only Logistics updates the pickup.' }; var r = DB.getReturn(id); if (!r || !r.rto) return { error: 'Book the pickup first.' }; if (['Picked up', 'In transit'].indexOf(status) < 0) return { error: 'Choose a status.' }; if (['RTO booked', 'Picked up', 'In transit'].indexOf(r.status) < 0) return { error: 'This return is not in transit.' }; rh(r, status, by); saveReturn(r); return { ok: true }; };
  /* Replacement: Finance selects the products to send. Balance = value of the replacement minus the accepted value of the returned goods:
     above zero the dealer pays the difference (debit note), below zero the dealer gets the difference (credit note). */
  DB.replacementQuote = function (id, items) {
    var r = DB.getReturn(id); if (!r) return { error: 'Return not found.' }; var d = DB.getDealer(r.dealer), lines = [], inv = get('inv', {}), bad = null;
    (items || []).forEach(function (s) { var q = parseInt(s.qty, 10); if (!(q > 0)) return; var p = String(s.sku || '').split('|'), l = lineFor(d, p[0], p[1], s.flavour || '', q); if (!l) { bad = 'A product was not found.'; return; } var ex = lines.filter(function (x) { return x.key === l.key; })[0]; if (ex) ex.qty += q; else lines.push(l); });
    if (bad) return { error: bad }; if (!lines.length) return { error: 'Select at least one product to send.' };
    var short = null; lines.forEach(function (l) { var need = 0; lines.forEach(function (m) { if (m.pid === l.pid && m.vid === l.vid) need += m.qty; }); var s = inv[SEL.sku(l.pid, l.vid)]; if (!s || s.on - s.res < need) short = short || l.product + ' ' + l.variant + ' (only ' + (s ? Math.max(0, s.on - s.res) : 0) + ' available)'; });
    if (short) return { error: 'Not enough stock for ' + short + '.' };
    var value = 0; lines.forEach(function (l) { value += l.price * l.qty; }); value = Math.round(value * 100) / 100; var ret = DB.returnValue(r), bal = Math.round((value - ret) * 100) / 100;
    return { lines: lines, value: value, returnedValue: ret, balance: bal, dealerPays: bal > 0.5 ? bal : 0, credit: bal < -0.5 ? -bal : 0 };
  };
  DB.issueReplacement = function (id, note, by, role, items) {
    if (role !== 'finance' && role !== 'admin') return { error: 'Only Finance can issue a replacement.' }; var r = DB.getReturn(id); if (!r || ['Accepted', 'Partially accepted'].indexOf(r.status) < 0) return { error: 'The return must be inspected and accepted first.' };
    if (r.replacement) return { error: 'A replacement was already issued for this return.' };
    var q = null; if (items && items.length) { q = DB.replacementQuote(id, items); if (q.error) return q; } else if (!(note && note.trim().length >= 5)) return { error: 'Select the products to send, or describe the replacement.' };
    var names = q ? q.lines.map(function (l) { return l.qty + ' x ' + l.product + ' ' + l.variant + (l.flavour ? ' (' + l.flavour + ')' : ''); }).join(', ') : note.trim(), at = new Date().toISOString();
    if (q) {
      DB.consumeOrderStock({ id: 'RPL-' + id, items: q.lines.map(function (l) { return { pid: l.pid, vid: l.vid, qty: l.qty }; }) });
      var nres = null; if (q.dealerPays > 0) nres = DB.createNote(r.dealer, { kind: 'Debit', amount: q.dealerPays, reason: 'Replacement balance for return ' + r.id + ' (order ' + r.orderId + ')', orderId: r.orderId, returnId: r.id, ref: 'RPL-' + r.id }, by, role); else if (q.credit > 0) nres = DB.createNote(r.dealer, { kind: 'Credit', amount: q.credit, reason: 'Replacement balance for return ' + r.id + ' (order ' + r.orderId + ')', orderId: r.orderId, returnId: r.id, ref: 'RPL-' + r.id }, by, role);
      if (nres && nres.error) return nres;
      r.replacement = { items: q.lines.map(function (l) { return { sku: SEL.sku(l.pid, l.vid), name: l.product + ' ' + l.variant, flavour: l.flavour, qty: l.qty, price: l.price }; }), value: q.value, returnedValue: q.returnedValue, balance: q.balance, dealerPays: q.dealerPays, credit: q.credit, note: nres && nres.note ? nres.note : '', at: at, by: by };
      patchOrder(r.dealer, r.orderId, function (x) { x.replacement = { returnId: r.id, items: r.replacement.items, value: q.value, returnedValue: q.returnedValue, balance: q.balance, dealerPays: q.dealerPays, credit: q.credit, at: at }; x.history = x.history || []; x.history.push({ status: 'Replacement for return ' + r.id + ': ' + names + '. ' + (q.dealerPays > 0 ? 'Balance payable by the dealer: ' + q.dealerPays : q.credit > 0 ? 'Balance credited to the dealer: ' + q.credit : 'No balance'), at: at }); });
    }
    r.resolution = 'Replacement: ' + names; rh(r, 'Replacement approved', by, names); rh(r, 'Closed', by); saveReturn(r);
    DB.addStaffNotif({ key: 'repl:' + id, kind: 'return', audience: ['employee', 'logistics', 'warehouse', 'admin'], title: 'Send replacement for ' + id, text: r.dealerName + ': ' + names + (q && q.dealerPays > 0 ? ' (balance payable ' + q.dealerPays + ')' : ''), count: 1, at: Date.now() });
    return { ok: true, balance: q ? q.balance : 0, dealerPays: q ? q.dealerPays : 0, credit: q ? q.credit : 0 };
  };
  /* ---- sample orders: created by Sales -> Logistics attaches the invoice -> Warehouse packs with a checklist -> Logistics ships ---- */
  DB.attachSampleInvoice = function (id, f, by) {
    if (!f || !/^data:application\/pdf/.test(f.data || '') || !sniffOk(f.data)) return { error: 'Upload the invoice as a PDF.' }; if (f.size > 1300000) return { error: 'The file is too large for this demo.' }; if (!(f.no && String(f.no).trim())) return { error: 'Enter the invoice number.' };
    var l = get('samples', []), done = false, err = null; l.forEach(function (s) { if (s.id !== id) return; if (['Awaiting invoice', 'Ready for packing'].indexOf(s.status) < 0) { err = 'The invoice can only be changed before packing starts.'; return; } s.invoice = { no: String(f.no).trim(), at: new Date().toISOString() }; s.invoiceFile = { name: f.name, size: f.size, data: f.data, by: by }; if (s.status === 'Awaiting invoice') { s.status = 'Ready for packing'; s.history.push({ s: 'Ready for packing', at: Date.now() }); } done = true; });
    if (err) return { error: err }; if (!done) return { error: 'Sample order not found.' }; set('samples', l); DB.addStaffNotif({ key: 'smi:' + id, kind: 'sample', audience: ['warehouse', 'admin'], title: 'Sample ' + id + ' is ready to pack', text: 'Invoice attached by Logistics.', count: 1, at: Date.now() }); return { ok: true };
  };
  function sampleOp(id, fn) { var l = get('samples', []), res = { error: 'Sample order not found.' }; l.forEach(function (s) { if (s.id === id) res = fn(s) || { ok: true }; }); set('samples', l); return res; }
  DB.startSamplePacking = function (id, by) { return sampleOp(id, function (s) { if (s.status !== 'Ready for packing') return { error: 'The invoice must be attached by Logistics first.' }; s.status = 'Packing'; s.history.push({ s: 'Packing', at: Date.now() }); s.pack = { by: by, at: Date.now(), items: s.lines.map(function (l) { return { name: l.product, brand: l.brand, req: l.qty, ver: 0 }; }) }; }); };
  DB.verifySampleItem = function (id, idx, qty, by) { return sampleOp(id, function (s) { if (s.status !== 'Packing' || !s.pack) return { error: 'Start packing first.' }; var it = s.pack.items[idx], q = parseInt(qty, 10); if (!it || !(q >= 0) || q > it.req) return { error: 'Enter a quantity from 0 to ' + (it ? it.req : 0) + '.' }; it.ver = q; }); };
  DB.finishSamplePacking = function (id, by) { return sampleOp(id, function (s) { if (s.status !== 'Packing' || !s.pack) return { error: 'Start packing first.' }; if (s.pack.items.some(function (i) { return i.ver < i.req; })) return { error: 'Every item must be fully verified before the sample is marked packed.' }; s.status = 'Packed'; s.history.push({ s: 'Packed', at: Date.now() }); s.pack.doneAt = Date.now(); DB.addStaffNotif({ key: 'smp:' + id, kind: 'sample', audience: ['logistics', 'admin'], title: 'Sample ' + id + ' is packed', text: 'Ready for Logistics to ship.', count: 1, at: Date.now() }); }); };
  /* ---- preorder: Sales can create one; "move to pending" turns a preorder with stock into a payable order ---- */
  DB.addPreorderBy = function (code, a, by) { var r = DB.addPreorder(code, a); if (r.ok) { var l = get('preorders', []); l.forEach(function (p) { if (p.id === r.preorder.id) { p.createdByEmp = by; p.salesEmp = (DB.getDealer(code) || {}).salesEmp || by; } }); set('preorders', l); } return r; };
  DB.movePreorder = function (id, by) {
    var p = get('preorders', []).filter(function (x) { return x.id === id; })[0]; if (!p) return { error: 'Preorder not found.' }; if (p.status !== 'Waiting for stock') return { ok: true, already: true, orderId: p.orderId };
    if (DB.stock(SEL.sku(p.pid, p.vid)).avail < p.qty) return { error: 'There is not enough stock yet. It moves to pending as soon as stock arrives.' }; DB.allocatePreorders(by); var q = get('preorders', []).filter(function (x) { return x.id === id; })[0];
    return q.status === 'Stock reserved: pay now' ? { ok: true, orderId: q.orderId } : { error: 'An older preorder for this product is served first.' };
  };
  /* ---- incentive policy v2: brand-wise rates or target-total slabs; paid only when the target is met ---- */
  var _ip0 = DB.incPolicy; DB.incPolicy = function () { var p = _ip0(); p.mode = p.mode || 'brand'; p.slabs = p.slabs || [{ from: 100, pct: 1 }, { from: 120, pct: 1.5 }]; p.basis = 'Verified collected payments excluding GST, net of returns. Paid only when the target is met.'; return p; };


  /* =========================== v10: GST profile, order edits, verified RTO credit, purchase inward =========================== */
  function gstOk(g) { return /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(String(g || '').toUpperCase().trim()); }
  /* Registered dealers need a valid GSTIN whose state matches the pincode. No GSTIN = Unregistered profile. */
  DB.gstProfile = function (d) {
    var g = String(d.gst || '').toUpperCase().trim(), ps = DB.stateFromPin(d.pincode), r = { registered: !!g, type: g ? 'Registered' : 'Unregistered', gstState: g.slice(0, 2), pinState: ps, ok: true, msg: '' };
    if (g && !gstOk(g)) { r.ok = false; r.msg = 'The GST number is not valid. It must be 15 characters, for example 24ABCDE1234F1Z5. Leave it blank for an Unregistered profile.'; }
    else if (g && ps && g.slice(0, 2) !== ps.code) { r.ok = false; r.msg = 'This GSTIN is registered in state code ' + g.slice(0, 2) + ' but the pincode ' + d.pincode + ' is in ' + ps.name + ' (' + ps.code + '). Correct the GST number or the pincode so that GST is applied correctly.'; }
    return r;
  };
  var _isG0 = DB.isGujarat; DB.isGujarat = function (address, pin, gst) { var p = /^\d{6}$/.test(String(pin || '')) ? String(pin) : DB.pinFrom(address); if (!p && gstOk(gst)) return String(gst).toUpperCase().slice(0, 2) === '24'; return _isG0(address, pin); };
  var _sd0 = DB.saveDealer; DB.saveDealerAs = function (d, by, role) {
    var old = DB.getDealer(String(d.code).trim().toUpperCase()), pr = DB.gstProfile(d); if (!pr.ok) return { error: pr.msg };
    if (role !== 'admin') { if (old && old.salesEmp !== by) return { error: 'You can edit only dealers assigned to you.' }; d.salesEmp = old ? old.salesEmp : (d.salesEmp || by); }   /* when Sales creates a dealer for a consultant, the passed salesEmp is honoured */
    d.gst = String(d.gst || '').toUpperCase().trim(); d.regType = d.gst ? 'Registered' : 'Unregistered'; _sd0(d); return { ok: true };
  };
  /* ---- editing an order ---- */
  function lineFor(d, pid, vid, flav, qty) { var f = SEL.findProduct(pid), v = null; if (!f) return null; f.product.variants.forEach(function (x) { if (x.id === vid) v = x; }); if (!v) return null; return { key: pid + '|' + vid + '|' + (flav || ''), brand: f.brand, pid: pid, product: f.product.name, vid: vid, variant: v.label, flavour: flav || '', mrp: v.mrp, price: DB.priceFor(d, pid, vid, v.mrp), qty: qty }; }
  DB.__lineFor = lineFor;   /* the server prices order lines itself with this */
  DB.diffPending = function (o) { return !!(o.diff && o.diff.status === 'pending'); };
  DB.dueOf = function (o) { return DB.diffPending(o) ? Math.round((o.diff.amount - (o.diff.received || 0)) * 100) / 100 : Math.round((o.totals.total - (o.received || 0)) * 100) / 100; };
  DB.editState = function (o) {
    if (o.cancelled) return { ok: false, why: 'This order is cancelled.' }; if (o.status === 'Delivered') return { ok: false, why: 'This order is delivered, so its documents, notes and details can no longer be changed.' };
    if (o.locked) return { ok: false, mode: 'locked', why: 'The difference was paid, so this order is now locked.' }; if (o.payment.status !== 'Paid') return { ok: true, mode: 'pending', note: 'You can change the products until the order is paid.' };
    if (DB.diffPending(o)) return { ok: false, mode: 'diff', why: 'Pay the difference first, or cancel the change.' }; var left = 24 * 36e5 - (Date.now() - Date.parse(o.payment.paidAt || o.date));
    if (left <= 0) return { ok: false, mode: 'expired', why: 'The 24-hour edit window after payment has ended.' }; if ((o.packing && (o.packing.items || []).length) || ['Dispatched', 'Out for delivery', 'Delivered'].indexOf(o.status) > -1) return { ok: false, why: 'Packing has started, so the order can no longer be changed.' };
    return { ok: true, mode: 'paid', hoursLeft: Math.round(left / 36e4) / 10, note: 'Paid order: you can add products or increase quantities for ' + (Math.round(left / 36e4) / 10) + ' more hour(s). You pay only the difference, and then the order is locked.' };
  };
  /* an edited order keeps its coupon when it is still valid for the new items (freebies stay as originally applied) */
  DB.__recalc = function (d, o, lines, gj) {
    var cc = (o.totals && o.totals.couponCode) || '', cp = null, note = '';
    if (cc) { var sub = 0; lines.forEach(function (l) { sub += l.price * l.qty; }); var vc = DB.validateCoupon(cc, lines, sub, d.category); if (vc && vc.coupon) cp = vc.coupon; else note = 'Coupon ' + cc + ' no longer applies after this change: ' + ((vc && vc.error) || 'not valid') + '.'; }
    return { nt: DB.calcTotals(lines, cp, gj, DB.freightOpt(d, o)), note: note };
  };
  DB.editOrder = function (code, id, specs, by, role) {
    var o = DB.getOrder(code, id); if (!o) return { error: 'Order not found.' }; var es = DB.editState(o); if (!es.ok) return { error: es.why }; var d = DB.getDealer(code), lines = [];
    var bad = null; specs.forEach(function (s) { var q = parseInt(s.qty, 10); if (!(q > 0)) return; var l = lineFor(d, s.pid, s.vid, s.flavour, q); if (!l) bad = 'A product was not found.'; else { var ex = lines.filter(function (x) { return x.key === l.key; })[0]; if (ex) ex.qty += q; else lines.push(l); } }); if (bad) return { error: bad }; if (!lines.length) return { error: 'An order needs at least one product. To remove it completely, cancel the order.' };
    var gj = DB.isGujarat(o.address || d.address, o.pin || d.pincode, d.gst), rc = DB.__recalc(d, o, lines, gj), nt = rc.nt, inv = get('inv', {}), oldQ = {}, newQ = {}; (o.items || []).forEach(function (l) { var k = SEL.sku(l.pid, l.vid); oldQ[k] = (oldQ[k] || 0) + l.qty; }); lines.forEach(function (l) { var k = SEL.sku(l.pid, l.vid); newQ[k] = (newQ[k] || 0) + l.qty; });
    if (es.mode === 'pending') {
      Object.keys(oldQ).forEach(function (k) { if (inv[k]) inv[k].res = Math.max(0, inv[k].res - oldQ[k]); }); var short = null; Object.keys(newQ).forEach(function (k) { var s = inv[k]; if (!s || s.on - s.res < newQ[k]) short = short || k + ' (only ' + (s ? Math.max(0, s.on - s.res) : 0) + ' available)'; });
      if (short) return { error: 'Not enough stock for ' + short + '.' }; Object.keys(newQ).forEach(function (k) { inv[k].res += newQ[k]; }); set('inv', inv);
      patchOrder(code, id, function (x) { x.items = lines; x.totals = nt; x.edits = (x.edits || 0) + 1; x.history = x.history || []; x.history.push({ status: 'Order edited before payment by ' + by + (rc.note ? '. ' + rc.note : ''), at: new Date().toISOString() }); }); DB.notifyAction(by, 'Order edited', id, 'order'); return { ok: true, mode: 'pending', total: nt.total };
    }
    var dec = null; Object.keys(oldQ).forEach(function (k) { if ((newQ[k] || 0) < oldQ[k]) dec = k; }); if (dec) return { error: 'After payment you can only add products or increase quantities. For a reduction ask Finance for a credit note.' };
    var delta = [], diffAmt = Math.round((nt.total - o.totals.total) * 100) / 100; lines.forEach(function (l) { var k = SEL.sku(l.pid, l.vid), add = l.qty - (oldQ[k] || 0); if (add > 0) delta.push({ pid: l.pid, vid: l.vid, qty: add, sku: k }); });
    if (!delta.length || diffAmt <= 0.5) return { error: 'Nothing was added to the order.' }; var short2 = null; delta.forEach(function (x) { var s = inv[x.sku]; if (!s || s.on - s.res < x.qty) short2 = short2 || x.sku + ' (only ' + (s ? Math.max(0, s.on - s.res) : 0) + ' available)'; }); if (short2) return { error: 'Not enough stock for ' + short2 + '.' };
    delta.forEach(function (x) { inv[x.sku].res += x.qty; }); set('inv', inv);
    patchOrder(code, id, function (x) { x.diff = { status: 'pending', amount: diffAmt, items: lines, totals: nt, delta: delta, received: 0, by: by, at: new Date().toISOString() }; x.history = x.history || []; x.history.push({ status: 'Order change requested. Difference ' + diffAmt + ' to pay' + (rc.note ? '. ' + rc.note : ''), at: x.diff.at }); });
    DB.addStaffNotif({ key: 'diff:' + id + ':' + Date.now(), kind: 'order', audience: ['employee', 'finance', 'admin'], title: 'Difference payment pending on ' + id, text: 'Dealer or Sales changed a paid order. Difference to collect: ' + diffAmt + '. Dispatch is on hold until it is paid.', count: 1, at: Date.now() }); DB.notifyAction(by, 'Paid order changed', id + ' difference ' + diffAmt, 'order'); return { ok: true, mode: 'paid', diff: diffAmt };
  };
  DB.cancelDiff = function (code, id, by) { var o = DB.getOrder(code, id); if (!o || !DB.diffPending(o)) return { error: 'No pending change.' }; if (o.diff.received > 0) return { error: 'A part of the difference was already paid. Ask Finance.' }; var inv = get('inv', {}); (o.diff.delta || []).forEach(function (x) { if (inv[x.sku]) inv[x.sku].res = Math.max(0, inv[x.sku].res - x.qty); }); set('inv', inv); patchOrder(code, id, function (x) { x.diff = null; x.history.push({ status: 'Order change cancelled by ' + by, at: new Date().toISOString() }); }); return { ok: true }; };
  DB.applyDiff = function (code, id, by) {
    var o = DB.getOrder(code, id); if (!o || !DB.diffPending(o)) return { error: 'No pending change.' }; DB.consumeOrderStock({ id: id, items: o.diff.delta.map(function (x) { return { pid: x.pid, vid: x.vid, qty: x.qty }; }) }); var amt = o.diff.amount, at = new Date().toISOString();
    patchOrder(code, id, function (x) { x.items = x.diff.items; x.totals = x.diff.totals; x.received = x.totals.total; x.diff.status = 'paid'; x.diff.paidAt = at; x.locked = { at: at, by: by, reason: 'Difference paid' }; if (x.invoiceFile) x.invoiceStale = true; x.history.push({ status: 'Difference paid. Order updated and locked', at: at }); });
    postL(code, { type: 'Invoice / debit', debit: amt, credit: 0, orderId: id, ref: id + '-EDIT', desc: 'Order ' + id + ' changed: difference', by: by || 'SYSTEM' }); DB.addStaffNotif({ key: 'diffp:' + id, kind: 'order', audience: ['logistics', 'warehouse', 'admin'], title: 'Order ' + id + ' updated', text: 'Difference paid. The invoice must be re-attached before dispatch. Order is locked.', count: 1, at: Date.now() }); return { ok: true };
  };
  var _rc0 = DB.rzpCreate; DB.rzpCreate = function (code, id, kind, by, extra) { var o = DB.getOrder(code, id); if (o && o.payment.status === 'Paid' && DB.diffPending(o)) { var due = DB.dueOf(o); if (kind === 'UPI' && !/^[\w.\-]{2,}@[\w]{2,}$/.test((extra && extra.upi) || '')) return { error: 'Enter the dealer\u2019s UPI ID (for example name@bank).' }; var short = rnd(8), r = { id: 'plink_DEMO' + short, kind: kind, amount: due, link: 'https://rzp.io/i/DEMO' + short, upi: (extra && extra.upi) || '', qr: kind === 'QR' ? 'upi://pay?pa=demo.razorpay@sbi&pn=S-ELEVEN%20NUTRITION&am=' + due + '&cu=INR&tn=' + encodeURIComponent(id + ' difference') : 'https://rzp.io/i/DEMO' + short, status: 'created', by: by, at: new Date().toISOString() }; patchOrder(code, id, function (x) { x.rzp = (x.rzp || []).concat([r]); }); return { ok: true, rzp: r }; } return _rc0(code, id, kind, by, extra); };
  var _rp0 = DB.rzpPaid; DB.rzpPaid = function (code, id, rid, by) {
    var o = DB.getOrder(code, id); if (o && o.payment.status === 'Paid' && DB.diffPending(o)) { var r = (o.rzp || []).filter(function (x) { return x.id === rid; })[0]; if (!r) return { error: 'Payment request not found.' }; var n = get('rcseq', 0) + 1; set('rcseq', n); var pid = 'pay_DEMO' + rnd(10);
      postL(code, { type: 'Payment received', credit: o.diff.amount, debit: 0, orderId: id, ref: pid, desc: 'Razorpay payment of the order difference', by: 'RAZORPAY' }); DB.applyDiff(code, id, 'RAZORPAY'); patchOrder(code, id, function (x) { x.receipt = { no: 'RCPT/26-27/' + (100 + n), gateway: 'Razorpay', paymentId: pid, method: 'Difference payment', amount: r.amount, at: new Date().toISOString(), linkId: r.id }; (x.rzp || []).forEach(function (y) { if (y.id === rid) y.status = 'paid'; }); }); return { ok: true }; }
    return _rp0(code, id, rid, by);
  };
  var _vp0 = DB.verifyProof; DB.verifyProof = function (code, orderId, pid, amount, note, by, role) {
    var o = DB.getOrder(code, orderId); if (!(o && DB.diffPending(o))) return _vp0.apply(DB, arguments);
    if (role !== 'finance' && role !== 'admin') return { error: 'Only Finance verifies payments.' }; if (!(note && note.trim().length >= 5)) return { error: 'Record how this was verified (for example the bank statement line).' }; var pr = (o.proofs || []).filter(function (x) { return x.id === pid; })[0]; if (!pr) return { error: 'Proof not found.' }; if (pr.status === 'Verified') return { ok: true, already: true }; if (pr.status === 'Rejected') return { error: 'This proof was rejected.' };
    if (pr.by === by && role !== 'admin') return { error: 'You cannot verify a proof that you uploaded.' }; var amt = parseFloat(amount); if (!(amt > 0) || amt > pr.amount + 0.001) return { error: 'The verified amount must be more than zero and not more than the claim.' }; if (amt > DB.dueOf(o) + 0.5) return { error: 'This would pay more than the difference.' };
    var full = false, now = new Date().toISOString(); patchOrder(code, orderId, function (x) { x.diff.received = Math.round((x.diff.received + amt) * 100) / 100; var q = x.proofs.filter(function (y) { return y.id === pid; })[0]; q.status = 'Verified'; q.verifiedAmount = amt; q.verifiedBy = by; q.verifiedAt = now; q.note = note.trim(); full = x.diff.received >= x.diff.amount - 0.5; });
    postL(code, { type: 'Payment received', credit: amt, debit: 0, orderId: orderId, ref: pr.ref, desc: 'Verified payment of the order difference', by: by }); if (full) DB.applyDiff(code, orderId, by); return { ok: true, full: full };
  };
  /* ---- returns: credit only for goods the Warehouse verified as received ---- */
  DB.verifyReturnInward = function (id, rows, by, role, finalClose) {
    if (['warehouse', 'finance', 'admin', 'logistics'].indexOf(role) < 0) return { error: 'Not allowed.' }; var r = DB.getReturn(id); if (!r) return { error: 'Return not found.' }; var done = 0, err = null;
    rows.forEach(function (x) { if (err || !(parseInt(x.recv, 10) > 0)) return; var res = DB.receiveReturn(id, x, by, role); if (res.error) err = res.error; else done++; });
    if (err) return { error: err, done: done }; if (!done && !finalClose) return { error: 'Enter the received quantity for at least one product.' };
    if (finalClose) { var q = DB.getReturn(id); if (q.status === 'Partly received' || (q.status === 'RTO booked' || q.status === 'Picked up' || q.status === 'In transit') && q.inward.length) {
        if (q.inward.some(function (x) { return x.cls === 'Pending inspection'; })) return { error: 'Inspect the goods that are pending inspection first.' };
        rh(q, q.lines.some(function (l) { return l.acc > 0; }) ? 'Partially accepted' : 'Rejected after inspection', by, 'Warehouse closed the inward: received less than requested'); q.verified = { by: by, at: Date.now(), short: true }; saveReturn(q);
        DB.addStaffNotif({ key: 'inw:' + id + ':short', kind: 'return', audience: ['finance', 'logistics', 'admin'], title: 'Return ' + id + ' inwarded (short receipt): ' + q.status, text: q.dealerName + ' \u00B7 verified value incl. GST ' + DB.returnValue(q) + '. Issue the credit note for the verified goods only.', count: 1, at: Date.now() }); } else if (!done) return { error: 'Nothing to close yet. Enter what was received.' }; }
    return { ok: true, done: done, status: DB.getReturn(id).status };
  };
  var _ric0 = DB.issueReturnCredit; DB.issueReturnCredit = function (id, amount, by, role) {
    if (['finance', 'admin', 'logistics'].indexOf(role) < 0) return { error: 'Only Finance or Logistics can issue the credit note.' }; var r = DB.getReturn(id); if (!r) return { error: 'Return not found.' }; if (!r.verified) return { error: 'The Warehouse must verify the received stock first.' };
    if (r.creditNote) return { error: 'A credit note was already issued: ' + r.creditNote }; return _ric0(id, DB.returnValue(r), by, 'finance');   /* the amount is always the verified received value, GST included */
  };
  /* ---- purchase orders (PDF) inwarded brand by brand ---- */
  DB.listPurchases = function () { ensureSeed(); return get('purchases', []); };
  DB.checkStockIn = function (sku, a) { var qty = parseInt(a.qty, 10), no = String(a.no || '').trim().toUpperCase(); if (!no) return 'Enter the batch number.'; if (!(qty > 0)) return 'Enter a quantity of at least 1.'; if (!/^\d{4}-\d{2}-\d{2}$/.test(a.mfg || '') || !/^\d{4}-\d{2}-\d{2}$/.test(a.exp || '')) return 'Enter the manufacturing and expiry dates.'; if (a.mfg > a.exp) return 'The manufacturing date cannot be after the expiry date.'; if (a.exp < tod()) return 'This stock has already expired.'; var b = (get('batches', {})[sku] || []).filter(function (x) { return x.no === no; })[0]; if (b && (b.mfg !== a.mfg || b.exp !== a.exp)) return 'Batch ' + no + ' exists with different dates.'; return ''; };
  DB.addPurchase = function (po, lines, by) {
    ensureSeed(); if (!(po.no && String(po.no).trim())) return { error: 'Enter the purchase order number.' }; if (!lines.length) return { error: 'There are no products to inward.' }; var l = get('purchases', []); if (l.some(function (x) { return x.no === String(po.no).trim(); })) return { error: 'Purchase order ' + po.no + ' was already inwarded.' };
    for (var i = 0; i < lines.length; i++) { var e = DB.checkStockIn(lines[i].sku, lines[i]); if (e) return { error: 'Line ' + (i + 1) + ' (' + (lines[i].name || lines[i].sku) + '): ' + e }; }
    lines.forEach(function (x) { DB.stockIn(x.sku, { no: x.no, mfg: x.mfg, exp: x.exp, qty: x.qty, supplier: po.supplier || '', ref: 'PO ' + po.no }, by); });
    var byBrand = {}; lines.forEach(function (x) { byBrand[x.brand] = (byBrand[x.brand] || 0) + parseInt(x.qty, 10); }); l.unshift({ no: String(po.no).trim(), supplier: po.supplier || '', file: po.file ? { name: po.file.name, size: po.file.size, data: po.file.data } : null, lines: lines, byBrand: byBrand, by: by, at: Date.now() }); set('purchases', l); DB.notifyAction(by, 'Purchase order inwarded', 'PO ' + po.no + ': ' + lines.length + ' line(s)', 'inventory'); return { ok: true, byBrand: byBrand };
  };


  /* =========================== v11: freight, flavour stock, multi-line preorders, allowances, attendance, history =========================== */
  var OPS5 = 1, inOps5 = false;
  /* ---- freight (logistics) charge by order size; Host can change the slabs ---- */
  var FDEF = [[0, 199], [10000, 299], [15000, 399], [20000, 499], [30000, 599], [40000, 799], [50000, 899], [60000, 999], [75000, 1199], [100000, 1499]];
  DB.freightSlabs = function () { ensureSeed(); return get('freight', FDEF.map(function (x) { return { from: x[0], fee: x[1] }; })).slice().sort(function (a, b) { return a.from - b.from; }); };
  DB.saveFreightSlabs = function (slabs, by) { var l = slabs.map(function (s) { return { from: Math.max(0, parseFloat(s.from) || 0), fee: Math.max(0, parseFloat(s.fee) || 0) }; }).sort(function (a, b) { return a.from - b.from; }); if (!l.length || l[0].from !== 0) return { error: 'The first slab must start at 0.' }; set('freight', l); DB.notifyAction(by, 'Freight slabs changed', l.length + ' slabs', 'security'); return { ok: true }; };
  DB.freightFor = function (amount) { var fee = 0; DB.freightSlabs().forEach(function (s) { if (amount >= s.from) fee = s.fee; }); return fee; };
  var _ct0 = DB.calcTotals; DB.calcTotals = function (items, cp, gujarat, freight) { var t = _ct0(items, cp, gujarat), on = freight === true || !!(freight && freight.freight), amt = (freight && typeof freight === 'object' && freight.amount != null && freight.amount !== '' && +freight.amount >= 0) ? +freight.amount : null; t.itemsTotal = t.total; t.freightOn = on; t.freightManual = on && amt !== null; t.freight = on ? (amt !== null ? r2(amt) : DB.freightFor(t.total)) : 0; t.total = r2(t.total + t.freight); return t; };
  /* ---- flavour-level stock: batches carry the flavour; reserved = unpaid orders ---- */
  function fcode(f) { return String(f || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 4).toUpperCase(); } DB.fcode = fcode;
  DB.flavourMap = function () {
    ensureSeed(); var all = get('batches', {}), m = {}; function cell(k) { return m[k] || (m[k] = { on: 0, res: 0, dmg: 0, qq: 0, ret: 0 }); }
    Object.keys(all).forEach(function (sku) { all[sku].forEach(function (b) { var c = cell(sku + '|' + (b.flavour || '')); if (!b.q && b.exp >= tod()) c.on += b.qty; c.dmg += b.dmg || 0; c.qq += b.qq || 0; c.ret += b.ret || 0; }); });
    get('dealers', []).forEach(function (d) { (get('orders.' + d.code, []) || []).forEach(function (o) { if (o.cancelled || !o.payment || o.payment.status === 'Paid' || o.payment.status === 'Expired') return; (o.items || []).forEach(function (l) { cell(SEL.sku(l.pid, l.vid) + '|' + (l.flavour || '')).res += l.qty; }); }); });
    return m;
  };
  DB.flavourAvail = function (pid, vid, fl, map) { var r = (map || DB.flavourMap())[SEL.sku(pid, vid) + '|' + (fl || '')] || { on: 0, res: 0 }; return Math.max(0, r.on - r.res); };
  DB.flavourStock2 = function (pid, vid, fl) { var r = DB.flavourMap()[SEL.sku(pid, vid) + '|' + (fl || '')] || { on: 0, res: 0 }; return { on: r.on, res: r.res, avail: Math.max(0, r.on - r.res) }; };
  DB.flavourStatus = function (pid, vid, fl, map) { var a = DB.flavourAvail(pid, vid, fl, map); return a === 0 ? { avail: 0, text: 'Out of stock', k: 'out' } : (a <= 10 ? { avail: a, text: 'Low stock: ' + a + ' left', k: 'low' } : { avail: a, text: 'In stock: ' + a, k: 'in' }); };
  DB.validateLines = function (lines) { var m = DB.flavourMap(), need = {}, bad = null; lines.forEach(function (l) { var k = SEL.sku(l.pid, l.vid) + '|' + (l.flavour || ''); need[k] = (need[k] || 0) + l.qty; var a = Math.max(0, (m[k] || { on: 0, res: 0 }).on - (m[k] || { on: 0, res: 0 }).res); if (need[k] > a && !bad) bad = l.product.split(' (')[0] + (l.flavour ? ' (' + l.flavour + ')' : '') + ': only ' + a + ' in stock'; }); return bad; };
  var _si0 = DB.stockIn; DB.stockIn = function (sku, a, by) {
    var f = SEL.findProduct(String(sku).split('|')[0]), fl = String(a.flavour || '').trim(), fls = (f && f.product.flavours) || [], a2 = Object.assign({}, a);
    if (fls.length) { var hit = fls.filter(function (x) { return x.toLowerCase() === fl.toLowerCase(); })[0]; if (!hit) return { error: fl ? 'Unknown flavour for this product: ' + fl : 'Choose the flavour.' }; fl = hit; a2.no = String(a.no || '').trim().toUpperCase().split('/')[0] + '/' + fcode(fl); } else fl = '';
    var r = _si0(sku, a2, by); if (r.ok) { var all = get('batches', {}), b = (all[sku] || []).filter(function (x) { return x.no === String(a2.no).trim().toUpperCase(); })[0]; if (b) { b.flavour = fl; b.addedAt = Date.now(); b.addedQty = parseInt(a.qty, 10); b.src = a.src || 'MANUAL'; b.po = a.po || ''; set('batches', all); r.allocated = (r.allocated || 0) + DB.allocatePreorders(by); } } return r;
  };
  DB.isNewBatch = function (b) { return !!(b && b.addedAt && Date.now() - b.addedAt < 72 * 36e5); };
  DB.newLeft = function (b) { return Math.max(0, Math.ceil((72 * 36e5 - (Date.now() - b.addedAt)) / 36e5)); };
  var _cs0 = DB.checkStockIn; DB.checkStockIn = function (sku, a) { var f = SEL.findProduct(String(sku).split('|')[0]), fls = (f && f.product.flavours) || []; if (fls.length && !fls.filter(function (x) { return x.toLowerCase() === String(a.flavour || '').toLowerCase(); })[0]) return a.flavour ? 'Unknown flavour: ' + a.flavour : 'Choose the flavour.'; return _cs0(sku, a); };
  var _ap0 = DB.addPurchase; DB.addPurchase = function (po, lines, by) { lines.forEach(function (x) { x._src = 'PO'; }); var inner = DB.stockIn; DB.stockIn = function (sku, a, b) { var ln = lines.filter(function (x) { return x.sku === sku && String(x.no) === String(a.no); })[0]; return inner(sku, Object.assign({}, a, { flavour: ln ? ln.flavour : a.flavour, src: 'PO', po: po.no }), b); }; try { return _ap0(po, lines, by); } finally { DB.stockIn = inner; } };
  /* ---- preorders with several products, editable until stock is reserved ---- */
  function normPre(p) { if (!p.items) p.items = [{ pid: p.pid, vid: p.vid, flavour: p.flavour || '', qty: p.qty, product: p.product, variant: p.variant, mrp: p.mrp, price: p.price }]; if (!p.history) p.history = [{ s: 'Preorder created', at: p.createdAt, by: p.createdBy }]; return p; }
  function preSummary(p) { var f = p.items[0]; p.pid = f.pid; p.vid = f.vid; p.flavour = f.flavour; p.product = f.product + (p.items.length > 1 ? ' + ' + (p.items.length - 1) + ' more' : ''); p.variant = f.variant; p.qty = p.items.reduce(function (a, x) { return a + x.qty; }, 0); p.price = Math.round(p.items.reduce(function (a, x) { return a + x.price * x.qty; }, 0) / Math.max(1, p.qty)); p.value = Math.round(p.items.reduce(function (a, x) { return a + x.price * x.qty; }, 0) * 100) / 100; }
  DB.listPreorders = function (code) { ensureSeed(); var l = get('preorders', []).map(function (p) { normPre(p); preSummary(p); return p; }); return code ? l.filter(function (p) { return p.dealer === code; }) : l; };
  function buildItems(d, specs) {
    var out = [], m = DB.flavourMap(), short = false, err = null; specs.forEach(function (s) { var q = parseInt(s.qty, 10); if (!(q > 0) || err) return; var f = SEL.findProduct(s.pid), v = null; if (!f) { err = 'Product not found.'; return; } if (inactMap()[s.pid]) { err = f.product.name.split(' (')[0] + ' is not available right now.'; return; } f.product.variants.forEach(function (x) { if (x.id === s.vid) v = x; }); if (!v) { err = 'Pack size not found.'; return; }
      var fls = f.product.flavours || [], fl = fls.length ? (fls.filter(function (x) { return x.toLowerCase() === String(s.flavour || '').toLowerCase(); })[0] || '') : ''; if (fls.length && !fl) { err = 'Choose the flavour for ' + f.product.name.split(' (')[0] + '.'; return; }
      var ex = out.filter(function (x) { return x.pid === s.pid && x.vid === s.vid && x.flavour === fl; })[0]; if (ex) ex.qty += q; else out.push({ pid: s.pid, vid: s.vid, flavour: fl, qty: q, product: f.product.name, variant: v.label, mrp: v.mrp, price: s.price || DB.priceFor(d, s.pid, s.vid, v.mrp) }); });
    if (err) return { error: err }; if (!out.length) return { error: 'Add at least one product.' }; out.forEach(function (x) { if (DB.flavourAvail(x.pid, x.vid, x.flavour, m) < x.qty) short = true; }); return { items: out, short: short };
  }
  DB.createPreorder = function (code, specs, by) {
    ensureSeed(); var d = DB.getDealer(code); if (!d) return { error: 'Dealer not found.' }; var b = buildItems(d, specs); if (b.error) return b; if (!b.short) return { error: 'Everything in this preorder is in stock. Please use a normal order.' };
    var l = get('preorders', []), p = { id: 'PO-' + String(Date.now()).slice(-6) + Math.floor(10 + Math.random() * 89), dealer: code, dealerName: d.name, items: b.items, salesEmp: d.salesEmp || null, status: 'Waiting for stock', createdAt: Date.now(), createdBy: by || code, orderId: null, history: [{ s: 'Preorder created', at: Date.now(), by: by || code }] }; preSummary(p); l.push(p); set('preorders', l); return { ok: true, preorder: p };
  };
  DB.addPreorder = function (code, a) { return DB.createPreorder(code, [{ pid: a.pid, vid: a.vid, flavour: a.flavour, qty: a.qty }], a.by || code); };
  DB.editPreorder = function (id, specs, by) {
    var l = get('preorders', []), p = l.filter(function (x) { return x.id === id; })[0]; if (!p) return { error: 'Preorder not found.' }; normPre(p); if (p.status !== 'Waiting for stock') return { error: 'This preorder is no longer editable. Stock is reserved: pay for it, or cancel it.' };
    var d = DB.getDealer(p.dealer), b = buildItems(d, specs.map(function (s) { var old = p.items.filter(function (x) { return x.pid === s.pid && x.vid === s.vid && x.flavour === (s.flavour || ''); })[0]; return Object.assign({}, s, { price: old ? old.price : undefined }); })); if (b.error) return b; if (!b.short) return { error: 'Everything is now in stock. Cancel this preorder and place a normal order.' };
    p.items = b.items; p.history.push({ s: 'Preorder edited', at: Date.now(), by: by }); preSummary(p); set('preorders', l); return { ok: true };
  };
  DB.allocatePreorders = function (by) {
    var l = get('preorders', []), n = 0, WINDOW = 120 * 60000;
    l.map(normPre).filter(function (p) { return p.status === 'Waiting for stock'; }).sort(function (a, b) { return a.createdAt - b.createdAt; }).forEach(function (p) {
      var m = DB.flavourMap(), need = {}, ok = true; p.items.forEach(function (x) { var k = SEL.sku(x.pid, x.vid) + '|' + x.flavour; need[k] = (need[k] || 0) + x.qty; var c = m[k] || { on: 0, res: 0 }; if (need[k] > c.on - c.res) ok = false; if (DB.stock(SEL.sku(x.pid, x.vid)).avail < x.qty) ok = false; }); if (!ok) return; var d = DB.getDealer(p.dealer); if (!d) return;
      var lines = p.items.map(function (x) { return { key: x.pid + '|' + x.vid + '|' + x.flavour, brand: SEL.findProduct(x.pid).brand, pid: x.pid, product: x.product, vid: x.vid, variant: x.variant, flavour: x.flavour, mrp: x.mrp, price: x.price, qty: x.qty }; }), now = new Date().toISOString();
      var o = { id: DB.newOrderId(), date: now, status: 'Placed', payment: { method: 'Pending', status: 'Pending', txn: '' }, items: lines, freebies: [], totals: DB.calcTotals(lines, null, DB.isGujarat(d.address, d.pincode, d.gst), DB.freightOpt(d)), address: d.address, pin: d.pincode, phone: d.phone, gst: d.gst, note: 'Preorder ' + p.id, shipment: null, history: [{ status: 'Placed', at: now }],
        buyer: { name: d.name, gst: d.gst, address: d.address, pin: d.pincode, phone: d.phone }, ship: { address: d.address, pin: d.pincode, phone: d.phone }, createdBy: { code: 'SYSTEM', name: 'S-ELEVEN (preorder stock ready)', role: 'system' }, source: 'PREORDER', preorderId: p.id, payBy: new Date(Date.now() + WINDOW).toISOString() };
      DB.addOrder(p.dealer, o); p.status = 'Stock reserved: pay now'; p.orderId = o.id; p.allocatedAt = Date.now(); p.payBy = o.payBy; p.history.push({ s: 'Stock reserved. Order ' + o.id + ' ready to pay', at: Date.now(), by: 'SYSTEM' }); n++;
      if (p.salesEmp) DB.addStaffNotif({ key: 'pre:' + p.id, kind: 'preorder', audience: ['employee', 'admin'], title: 'Preorder ' + p.id + ' now has stock', text: p.dealerName + ' can pay for ' + p.qty + ' item(s)', count: 1, at: Date.now() }); set('preorders', l);
    }); if (n) set('preorders', l); return n;
  };
  DB.expirePreorders = function () {
    var l = get('preorders', []).map(normPre), n = 0, changed = false, inv = get('inv', {}); l.forEach(function (p) {
      if (p.status !== 'Stock reserved: pay now' || !p.orderId) return; var o = DB.getOrder(p.dealer, p.orderId); if (o && o.payment.status === 'Paid') { p.status = 'Paid'; p.history.push({ s: 'Paid', at: Date.now() }); changed = true; return; } if (Date.now() < new Date(p.payBy).getTime() || !o) return;
      p.items.forEach(function (x) { var k = SEL.sku(x.pid, x.vid); if (inv[k]) inv[k].res = Math.max(0, inv[k].res - x.qty); }); patchOrder(p.dealer, p.orderId, function (x) { x.cancelled = true; x.status = 'Placed'; x.payment.status = 'Expired'; }); p.status = 'Expired'; p.history.push({ s: 'Payment window ended: stock released', at: Date.now() }); n++; changed = true;
    }); if (changed) { set('preorders', l); set('inv', inv); } if (n) DB.allocatePreorders('SYSTEM'); return n;
  };
  DB.cancelPreorder = function (id, by) { var l = get('preorders', []).map(normPre), ok = false; l.forEach(function (p) { if (p.id === id && p.status === 'Waiting for stock') { p.status = 'Cancelled'; p.history.push({ s: 'Cancelled', at: Date.now(), by: by || '' }); ok = true; } }); set('preorders', l); return ok; };
  /* ---- attendance: automatic with the portal tab; HR can sign anyone in or out ---- */
  var STALE = 6 * 60000;   /* a locked computer keeps the portal signed in: browsers slow a hidden tab to about one beat a minute, so allow 6 minutes without a beat before treating the computer as off */
  DB.reconcileAttendance = function () {
    var a = get('att', {}), ch = false, now = Date.now(); Object.keys(a).forEach(function (c) { var l = a[c], last = l[l.length - 1]; if (!last || last.out || last.hr) return; var seen = last.seen ? new Date(last.seen).getTime() : new Date(last.in).getTime(); if (now - seen > STALE) { last.out = new Date(Math.max(seen, new Date(last.in).getTime() + 1000)).toISOString(); last.src = (last.src || 'portal') + ' (tab closed)'; ch = true; } }); if (ch) set('att', a); return ch;
  };
  var _pl0 = DB.portalLogin; DB.portalLogin = function (code) { DB.reconcileAttendance(); return _pl0(code); };
  DB.hrSign = function (code, action, by) {
    ensureSeed(); var e = DB.getEmployee(code); if (!e || e.dept === 'host') return { error: 'Attendance does not apply to this account.' }; var a = get('att', {}), l = a[code] || (a[code] = []), last = l[l.length - 1], now = new Date();
    if (action === 'in') { if (last && !last.out) return { error: e.name + ' is already signed in.' }; l.push({ in: now.toISOString(), out: null, src: 'hr:' + by, hr: true }); }
    else { if (!last || last.out) return { error: e.name + ' is not signed in.' }; var inT = new Date(last.in).getTime(); last.out = new Date(Math.max(now.getTime(), inT + 1000)).toISOString(); last.src = (last.src || '') + ' / signed out by ' + by; last.hr = true; }
    set('att', a); DB.notifyAction(by, action === 'in' ? 'HR signed an employee in' : 'HR signed an employee out', e.name, 'attendance'); return { ok: true };
  };
  /* ---- allowances: petrol (rate per km) and reimbursements ---- */
  DB.petrolRate = function () { ensureSeed(); return get('petrolrate', 3.5); };
  DB.addPetrol = function (emp, a) {
    var s = parseFloat(a.startKm), e = parseFloat(a.endKm); if (!a.date || a.date > tod()) return { error: 'Enter the date (not in the future).' }; if (!(a.from && a.from.trim()) || !(a.to && a.to.trim())) return { error: 'Enter where you went from and to.' }; if (!(s >= 0) || !(e > s)) return { error: 'Enter the start and end kilometre readings (end must be more than start).' };
    if (!(a.reason && a.reason.trim().length >= 5)) return { error: 'Enter the reason for the trip.' }; var km = Math.round((e - s) * 10) / 10, l = get('allow', []), r = { id: 'AL-' + (l.length + 1001), kind: 'petrol', emp: emp, date: a.date, from: a.from.trim(), to: a.to.trim(), startKm: s, endKm: e, km: km, rate: DB.petrolRate(), amount: Math.round(km * DB.petrolRate() * 100) / 100, reason: a.reason.trim(), status: 'Pending', at: Date.now() };
    l.unshift(r); set('allow', l); DB.addStaffNotif({ key: 'al:' + r.id, kind: 'allowance', audience: ['admin'], title: 'Petrol allowance request', text: (DB.getEmployee(emp) || {}).name + ': ' + km + ' km, Rs ' + r.amount, count: 1, at: Date.now() }); return { ok: true, req: r };
  };
  DB.addReimb = function (emp, a) {
    if (!a.date || a.date > tod()) return { error: 'Enter the date (not in the future).' }; if (!(a.place && a.place.trim())) return { error: 'Enter the place.' }; if (!a.time) return { error: 'Enter the time.' }; if (!(a.reason && a.reason.trim().length >= 5)) return { error: 'Enter the reason for the expense.' }; var amt = parseFloat(a.amount); if (!(amt > 0)) return { error: 'Enter the amount you spent.' };
    var rc = null; if (a.data) { if (!/^data:(image\/png|image\/jpeg|application\/pdf)/.test(a.data) || !sniffOk(a.data)) return { error: 'The receipt must be a PNG, JPEG or PDF.' }; if (a.size > 1300000) return { error: 'The receipt is too large for this demo (limit about 1.3 MB).' }; rc = { name: a.name, size: a.size, data: a.data }; }
    var l = get('allow', []), r = { id: 'AL-' + (l.length + 1001), kind: 'reimb', emp: emp, date: a.date, place: a.place.trim(), time: a.time, reason: a.reason.trim(), amount: Math.round(amt * 100) / 100, receipt: rc, status: 'Pending', at: Date.now() }; l.unshift(r); set('allow', l);
    DB.addStaffNotif({ key: 'al:' + r.id, kind: 'allowance', audience: ['admin'], title: 'Reimbursement request', text: (DB.getEmployee(emp) || {}).name + ': Rs ' + r.amount + ' (' + r.reason.slice(0, 40) + ')', count: 1, at: Date.now() }); return { ok: true, req: r };
  };
  DB.listAllow = function (emp) { ensureSeed(); var l = get('allow', []); return emp ? l.filter(function (x) { return x.emp === emp; }) : l; };
  DB.decideAllow = function (id, ok, note, by, role) { if (role !== 'admin') return { error: 'Only the Host approves allowances and reimbursements.' }; var l = get('allow', []), r = l.filter(function (x) { return x.id === id; })[0]; if (!r) return { error: 'Request not found.' }; if (r.status !== 'Pending') return { ok: true, already: true }; if (!ok && !(note && note.trim().length >= 3)) return { error: 'Give a reason for rejecting.' }; r.status = ok ? 'Approved' : 'Rejected'; r.note = note || ''; r.by = by; r.decidedAt = Date.now(); set('allow', l); return { ok: true }; };
  DB.allowDays = function (emp, ym) { var m = {}; DB.listAllow(emp).forEach(function (r) { if (r.date.slice(0, 7) === ym) (m[r.date] = m[r.date] || []).push(r); }); return m; };
  /* ---- migration: flavour-wise batches, freight option, demo sales history for the analytics ---- */
  function ensureOps5() {
    if (inOps5 || get('ops5', 0) >= OPS5 || get('ops4', 0) < 2) return; inOps5 = true;
    try {
      var all = get('batches', {}); Object.keys(all).forEach(function (sku) { var f = SEL.findProduct(sku.split('|')[0]), fls = (f && f.product.flavours) || []; if (!fls.length) return; var out = [];
        all[sku].forEach(function (b) { if (b.flavour !== undefined) { out.push(b); return; } var n = fls.length, base = Math.floor(b.qty / n), rem = b.qty - base * n; fls.forEach(function (fl, i) { var c = Object.assign({}, b); c.flavour = fl; c.no = b.no + '/' + fcode(fl); c.qty = base + (i < rem ? 1 : 0); c.rec = c.qty; c.dmg = i === 0 ? (b.dmg || 0) : 0; c.qq = i === 0 ? (b.qq || 0) : 0; c.ret = i === 0 ? (b.ret || 0) : 0; out.push(c); }); }); all[sku] = out; }); set('batches', all);
      var ds = get('dealers', []); ds.forEach(function (d) { if (d.freightApply === undefined) d.freightApply = true; }); set('dealers', ds);
      seedHistory(); set('ops5', OPS5);
    } finally { inOps5 = false; }
  }
  function seedHistory() {
    var now = new Date(), dealers = get('dealers', []), pool = [], seed = 11; SEL.BRANDS.forEach(function (b) { (SEL.CATALOG[b.id] || []).forEach(function (p) { p.variants.forEach(function (v) { pool.push({ b: b.id, p: p, v: v }); }); }); });
    function rnd() { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; } var emps = get('employees', []).filter(function (e) { return e.dept === 'sales'; }).map(function (e) { return e.id; });
    for (var m = 5; m >= 1; m--) dealers.forEach(function (d, di) {
      var cnt = 2 + Math.floor((6 - m) * 0.8) + Math.floor(rnd() * 2); for (var k = 0; k < cnt; k++) {
        var lines = [], nl = 1 + Math.floor(rnd() * 3); for (var j = 0; j < nl; j++) { var c = pool[Math.floor(rnd() * pool.length)], qty = 2 + Math.floor(rnd() * 10); if (lines.some(function (x) { return x.pid === c.p.id && x.vid === c.v.id; })) continue; lines.push({ key: c.p.id + '|' + c.v.id + '|h' + j, brand: c.b, pid: c.p.id, product: c.p.name, vid: c.v.id, variant: c.v.label, flavour: (c.p.flavours && c.p.flavours[0]) || '', mrp: c.v.mrp, price: DB.priceFor(d, c.p.id, c.v.id, c.v.mrp), qty: qty }); }
        var dt = new Date(now.getFullYear(), now.getMonth() - m, 1 + Math.floor(rnd() * 26), 10 + Math.floor(rnd() * 6), Math.floor(rnd() * 59)), t0 = dt.getTime(), H = function (h) { return new Date(t0 + h * 36e5).toISOString(); }, emp = d.salesEmp || emps[di % emps.length], en = DB.getEmployee(emp) || {}, byDealer = rnd() < 0.5;
        var gj = parseInt(d.pincode, 10) >= 360000 && parseInt(d.pincode, 10) <= 396999, tot = DB.calcTotals(lines, null, gj, d.freightApply !== false), id = 'H' + String(dt.getFullYear()).slice(2) + ('0' + (dt.getMonth() + 1)).slice(-2) + '-' + (di + 1) + (k + 1), disp = 20 + Math.floor(rnd() * 28);
        var o = { id: id, date: H(0), status: 'Delivered', payment: { method: 'UPI (demo)', status: 'Paid', txn: 'DEMO-H-' + id, paidAt: H(2) }, items: lines, freebies: [], totals: tot, address: d.address, pin: d.pincode, phone: d.phone, gst: d.gst, note: 'DEMO history for analytics', shipment: { partner: 'delhivery', trackingId: 'DEMOH' + id.replace(/\D/g, ''), status: 'Delivered', dispatchedAt: H(2 + disp) }, demo: true, hist: true,
          history: [{ status: 'Placed', at: H(0) }, { status: 'Payment received', at: H(2) }, { status: 'Confirmed by Sales', at: H(3) }, { status: 'Packed', at: H(3 + 6 + Math.floor(rnd() * 14)) }, { status: 'Dispatched', at: H(2 + disp) }, { status: 'Delivered', at: H(2 + disp + 72) }], buyer: { name: d.name, gst: d.gst, address: d.address, pin: d.pincode, phone: d.phone }, ship: { address: d.address, pin: d.pincode, phone: d.phone },
          createdBy: byDealer ? { code: d.code, name: d.name, role: 'dealer' } : { code: emp, name: en.name || emp, role: 'employee' }, attr: { emp: emp, name: en.name || '', flagged: false }, confirmed: { by: emp, at: H(3) }, invoice: { no: 'DEMO/H/' + id, date: H(5) } };
        var ol = get('orders.' + d.code, []); ol.push(o); set('orders.' + d.code, ol); DB.creditOrder(o); postL(d.code, { type: 'Invoice / debit', debit: tot.total, credit: 0, orderId: id, ref: id, desc: 'Order ' + id, by: 'SYSTEM', at: t0 + 36e5 }); postL(d.code, { type: 'Payment received', credit: tot.total, debit: 0, orderId: id, ref: o.payment.txn, desc: 'Payment for order ' + id, by: 'SYSTEM', at: t0 + 2 * 36e5 });
      }
    });
    emps.forEach(function (e) { for (var m = 5; m >= 0; m--) { var ym = DB.ym(new Date(now.getFullYear(), now.getMonth() - m, 15).getTime()), ach = DB.achieved(e, ym); Object.keys(ach).forEach(function (b) { var v = ach[b] / 100; if (v > 0) DB.setTarget(e, b, ym, Math.max(500, Math.round(v * (0.75 + rnd() * 0.6) / 100) * 100), 'ADMIN'); }); } });
    var att = get('att', {}), al = get('allow', []); get('employees', []).filter(function (e) { return e.dept !== 'host'; }).forEach(function (e) { var l = att[e.id] || (att[e.id] = []); for (var m = 5; m >= 1; m--) { var base = new Date(now.getFullYear(), now.getMonth() - m, 1), dim = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate(); for (var dd = 1; dd <= dim; dd++) { var dt = new Date(base.getFullYear(), base.getMonth(), dd); if (dt.getDay() === 0 || rnd() < 0.07) continue; var inM = 570 + Math.round((rnd() - 0.35) * 40), outM = 1110 + Math.round((rnd() - 0.4) * 60); l.push({ in: new Date(base.getFullYear(), base.getMonth(), dd, 0, inM).toISOString(), out: new Date(base.getFullYear(), base.getMonth(), dd, 0, outM).toISOString(), src: 'sample' }); } } l.sort(function (a, b) { return a.in < b.in ? -1 : 1; });
      if (e.dept === 'sales') for (var mm = 3; mm >= 1; mm--) { var dday = new Date(now.getFullYear(), now.getMonth() - mm, 12), s0 = 12000 + mm * 400, km = 60 + Math.round(rnd() * 200); al.push({ id: 'AL-H' + e.id + mm, kind: 'petrol', emp: e.id, date: dday.toISOString().slice(0, 10), from: 'Office, Ahmedabad', to: 'Dealer visit', startKm: s0, endKm: s0 + km, km: km, rate: 3.5, amount: Math.round(km * 3.5 * 100) / 100, reason: 'Dealer visit (demo history)', status: 'Approved', at: dday.getTime() }); } }); set('att', att); set('allow', al);
  }


  /* =========================== v12: HR role, salary and slips, order stages, alerts, revision credit, freebie wallet =========================== */
  DB.DEPTS.hr = 'HR';
  var OPS6 = 1, inOps6 = false;
  function pad2(n) { return ('0' + n).slice(-2); }
  function isHRrole(r) { return r === 'admin' || r === 'hr'; }
  /* ---- allowances can be approved by HR or Admin ---- */
  var _da0 = DB.decideAllow; DB.decideAllow = function (id, ok, note, by, role) { return _da0(id, ok, note, by, isHRrole(role) ? 'admin' : role); };
  /* ---- salary: set by HR or Admin only ---- */
  DB.salaryOf = function (emp) { ensureSeed(); var s = get('salary', {})[emp]; return s ? s.amount : 0; };
  DB.salaryInfo = function (emp) { ensureSeed(); return get('salary', {})[emp] || null; };
  DB.setSalary = function (emp, amount, by, role) {
    if (!isHRrole(role)) return { error: 'Only HR or the Host can set a salary.' }; var e = DB.getEmployee(emp); if (!e || e.dept === 'host') return { error: 'Choose an employee (not the Host account).' }; var a = Math.round(parseFloat(amount) * 100) / 100; if (!(a >= 0) || a > 10000000) return { error: 'Enter a monthly salary between 0 and 1,00,00,000.' };
    var s = get('salary', {}), old = s[emp] ? s[emp].amount : 0, hist = (s[emp] && s[emp].history) || []; hist.unshift({ from: old, to: a, by: by, at: Date.now() }); s[emp] = { amount: a, by: by, at: Date.now(), history: hist.slice(0, 20) }; set('salary', s); DB.notifyAction(by, 'Salary updated', e.name + ': ' + old + ' to ' + a, 'security'); return { ok: true };
  };
  var PDEF = { warehouse: { otAfter: '19:00', otRate: 80, holidayMult: 1.5 } };
  DB.salaryPolicy = function () { ensureSeed(); var p = get('salpolicy', null); if (!p) return JSON.parse(JSON.stringify(PDEF)); return p; };
  DB.policyOf = function (dept) { var p = DB.salaryPolicy()[dept] || {}; return { otAfter: p.otAfter || '', otRate: +p.otRate || 0, holidayMult: +p.holidayMult || 0 }; };
  DB.savePolicy = function (dept, pol, by, role) { if (!isHRrole(role)) return { error: 'Only HR or the Host can change salary rules.' }; if (pol.otAfter && !/^\d{2}:\d{2}$/.test(pol.otAfter)) return { error: 'Overtime start time must look like 19:00.' }; var p = DB.salaryPolicy(); p[dept] = { otAfter: pol.otAfter || '', otRate: Math.max(0, parseFloat(pol.otRate) || 0), holidayMult: Math.max(0, parseFloat(pol.holidayMult) || 0) }; set('salpolicy', p); DB.notifyAction(by, 'Salary rules changed', dept, 'security'); return { ok: true }; };
  function r2s(x) { return Math.round(x * 100) / 100; }
  /* the pay of every day of a month, from attendance. Daily salary = monthly / days in month, so full attendance pays exactly the monthly salary.
     Lateness is deducted per minute (daily salary / 480 minutes). Absent days are unpaid. Overtime and holiday work follow the department's rule. */
  DB.salaryMonth = function (emp, ym) {
    ensureSeed(); var e = DB.getEmployee(emp), monthly = DB.salaryOf(emp), pol = DB.policyOf(e ? e.dept : ''), p = ym.split('-'), dim = new Date(+p[0], +p[1], 0).getDate(), daily = monthly / dim, perMin = daily / DB.SCHED.standard, rep = DB.monthReport(emp, ym), ses = DB.sessions(emp), today = ymd(Date.now()), rows = [], T = { base: 0, lateMin: 0, lateDed: 0, otMin: 0, ot: 0, holidayDays: 0, holiday: 0, absent: 0, paidDays: 0 };
    rep.rows.forEach(function (r) {
      var row = { date: r.date, status: r.status, base: 0, lateMin: 0, lateDed: 0, otMin: 0, ot: 0, holiday: 0, total: 0, note: '' }; if (r.date > today || !r.status) { row.future = true; rows.push(row); return; }
      var ds = ses.filter(function (s) { return ymd(s.in) === r.date; });
      if (r.status === 'Absent') { row.base = 0; T.absent++; row.note = 'Absent: unpaid'; }
      else { row.base = r2s(daily); T.paidDays++; }
      if (r.status === 'Present' && r.lateDed > 0) { row.lateMin = r.lateDed; row.lateDed = r2s(Math.min(row.base, r.lateDed * perMin)); row.note = 'In after 10:00 by ' + r.lateDed + ' min: -' + row.lateDed.toFixed(2); }
      if (pol.otAfter && ds.length) { var st = new Date(r.date + 'T' + pol.otAfter + ':00').getTime(), mins = 0; ds.forEach(function (s) { var a = Math.max(new Date(s.in).getTime(), st), b = s.out ? new Date(s.out).getTime() : (r.date === today ? Date.now() : a); if (b > a) mins += Math.floor((b - a) / 60000); }); row.otMin = mins; row.ot = r2s(mins / 60 * pol.otRate); if (mins) row.note += (row.note ? ' · ' : '') + 'Overtime ' + mins + ' min: +' + row.ot.toFixed(2); }
      if (r.holiday && ds.length && pol.holidayMult) { row.holiday = r2s(daily * pol.holidayMult); T.holidayDays++; row.note += (row.note ? ' · ' : '') + 'Worked on holiday (' + pol.holidayMult + 'x): +' + row.holiday.toFixed(2); }
      row.total = r2s(row.base - row.lateDed + row.ot + row.holiday); T.base += row.base; T.lateMin += row.lateMin; T.lateDed += row.lateDed; T.otMin += row.otMin; T.ot += row.ot; T.holiday += row.holiday; rows.push(row);
    });
    var net = r2s(T.base - T.lateDed + T.ot + T.holiday); ['base', 'lateDed', 'ot', 'holiday'].forEach(function (k) { T[k] = r2s(T[k]); });
    return { emp: emp, ym: ym, monthly: monthly, dim: dim, daily: r2s(daily), perMin: Math.round(perMin * 10000) / 10000, policy: pol, rows: rows, totals: T, net: net };
  };
  DB.releaseDate = function (ym) { var p = ym.split('-'), d = new Date(+p[0], +p[1], 2, 0, 0, 0); return d.getTime(); };   /* 2nd of the NEXT month */
  DB.listSlips = function (emp) { ensureSeed(); var l = get('slips', []); return (emp ? l.filter(function (s) { return s.emp === emp; }) : l).sort(function (a, b) { return a.ym < b.ym ? 1 : -1; }); };
  /* releases every due slip exactly once (a month's slip is released on the 2nd of the following month) */
  DB.releaseSlips = function (nowMs) {
    ensureSeed(); nowMs = nowMs || Date.now(); var l = get('slips', []), have = {}, n = 0; l.forEach(function (s) { have[s.emp + '|' + s.ym] = 1; });
    get('employees', []).filter(function (e) { return e.dept !== 'host' && e.status === 'active'; }).forEach(function (e) {
      if (!(DB.salaryOf(e.id) > 0)) return; var ses = DB.sessions(e.id); if (!ses.length) return; var months = {}; ses.forEach(function (s) { months[DB.ym(new Date(s.in).getTime())] = 1; });
      Object.keys(months).sort().forEach(function (ym) { var rel = DB.releaseDate(ym); if (rel > nowMs || have[e.id + '|' + ym]) return; var c = DB.salaryMonth(e.id, ym); l.push({ id: 'SL-' + e.id + '-' + ym, emp: e.id, name: e.name, dept: e.dept, ym: ym, issuedAt: rel, by: 'SYSTEM', calc: c }); have[e.id + '|' + ym] = 1; n++; if (rel > nowMs - 35 * 864e5) DB.addAlert({ key: 'slip:' + e.id + ':' + ym, to: { users: [e.id] }, kind: 'salary', title: 'Salary slip for ' + ym + ' is ready', text: 'Net pay ' + c.net.toFixed(2) + '. Open My attendance to view or print it.', at: rel }); });
    }); if (n) set('slips', l); return n;
  };
  /* ---- alerts: stay until "Task completed"; reminders are shown again every 10 minutes ---- */
  DB.addAlert = function (a) { var l = get('alerts', []); if (l.some(function (x) { return x.key === a.key; })) return null; a.id = 'al' + Date.now().toString(36) + Math.floor(Math.random() * 999); a.at = a.at || Date.now(); a.done = {}; a.actions = a.actions || []; l.unshift(a); set('alerts', l.slice(0, 400)); return a; };
  DB.alertsFor = function (user, role) { var l = get('alerts', []); return l.filter(function (a) { var t = a.to || {}; return ((t.users || []).indexOf(user) > -1 || (t.roles || []).indexOf(role) > -1) && !a.done[user]; }); };
  DB.alertDone = function (id, user) { var l = get('alerts', []); l.forEach(function (a) { if (a.id === id) a.done[user] = Date.now(); }); set('alerts', l); };
  DB.alertDoneKey = function (key, user) { var l = get('alerts', []); l.forEach(function (a) { if (a.key === key) a.done[user] = Date.now(); }); set('alerts', l); };
  /* ---- one process, one format: the stage of an order, the same for every department and the dealer ---- */
  DB.stageSteps = function (o) {
    var paid = o.payment && o.payment.status === 'Paid', needE = DB.needsEway(o), inv = !!o.invoiceFile && (!needE || !!o.ewayFile), wh = DB.whState(o), disp = ['Dispatched', 'Out for delivery', 'Delivered'].indexOf(o.status) > -1;
    var packedAt = (o.history || []).filter(function (h) { return /^packed/i.test(h.status); }).map(function (h) { return h.at; })[0] || (o.packing && o.packing.doneAt ? new Date(o.packing.doneAt).toISOString() : null);
    return [{ key: 'placed', label: 'Order placed', done: true, at: o.date }, { key: 'paid', label: 'Payment confirmed', done: !!paid, at: paid ? (o.payment.paidAt || o.date) : null }, { key: 'pushed', label: 'Pushed to Logistics and Finance', done: !!o.confirmed, at: o.confirmed ? o.confirmed.at : null },
      { key: 'invoiced', label: needE ? 'Invoice and e-way bill uploaded' : 'Invoice uploaded', done: inv && !!o.confirmed, at: inv && o.invoice ? o.invoice.date : null }, { key: 'packing', label: 'Warehouse packing', done: wh === 'PACKING' || wh === 'PACKED' || disp, at: null }, { key: 'packed', label: 'Packed: ready for pickup', done: wh === 'PACKED' || disp, at: packedAt },
      { key: 'dispatched', label: 'Dispatched', done: disp, at: o.shipment && o.shipment.dispatchedAt }, { key: 'delivered', label: 'Delivered', done: o.status === 'Delivered', at: null }];
  };
  DB.stageOf = function (o) { var s = DB.stageSteps(o), cur = s.filter(function (x) { return !x.done; })[0]; return { steps: s, current: cur ? cur.key : 'delivered', label: o.cancelled ? 'Cancelled' : (cur ? 'Next: ' + cur.label : 'Delivered'), doneCount: s.filter(function (x) { return x.done; }).length }; };
  DB.invoiceReady = function (o) { return !!o.invoiceFile; };   /* the invoice is enough to push the order to the Warehouse; an e-way bill (above 50,000) is needed only before it is DISPATCHED */
  /* '' when the invoice (and, above the limit, the e-way bill) is uploaded; otherwise what is missing. No order can be dispatched or in transit while this is not empty. */
  DB.docsPending = function (o) { if (o && (o.hist || o.status === 'Delivered')) return ''; if (!o || !o.invoiceFile) return 'Invoice pending'; if (DB.needsEway(o) && !o.ewayFile) return 'E-way bill pending'; return ''; };
  function empRole(by) { var e = by ? DB.getEmployee(by) : null; return e ? ROLE_OF[e.dept] : ''; }
  /* turns every stage change into alerts for the right people, exactly once, and updates the order status when it is packed */
  DB.stageEvents = function () {
    ensureSeed(); var seen = get('stgseen', {}), base = !get('stgbase', 0), emit = function (a) { if (seen[a.key]) return false; seen[a.key] = 1; if (base) return false; return !!DB.addAlert(a); }; var n = 0, recent = Date.now() - 3 * 864e5; get('dealers', []).forEach(function (d) { (get('orders.' + d.code, []) || []).forEach(function (o) {
      if (o.cancelled || o.hist || !o.payment) return; var paid = o.payment.status === 'Paid', emp = o.attr && o.attr.emp, id = o.id, c = d.code, when = o.payment.paidAt ? new Date(o.payment.paidAt).getTime() : new Date(o.date).getTime(); if (when < recent && !o.demo) return;
      if (paid && !o.confirmed && emit({ key: 'st:paid:' + id, to: { users: emp ? [emp] : [], roles: emp ? [] : ['admin'] }, kind: 'order', orderId: id, code: c, title: 'Payment confirmed on ' + id, text: d.name + ' paid. Push the order to Logistics and Finance, or revise it first.', actions: [{ id: 'push', label: 'Push to Logistics and Finance' }, { id: 'revise', label: 'Revise order' }], at: when })) n++;
      if (o.confirmed && emit({ key: 'st:pushed:' + id, to: { roles: ['logistics', 'finance'] }, kind: 'order', popup: 'neworder', orderId: id, code: c, title: 'Order ' + id + ' pushed to you', text: d.name + ': upload the invoice' + (DB.needsEway(o) ? ' and the e-way bill (order above 50,000)' : ' (and the e-way bill if applicable)') + '. The Warehouse sees the order only after that.', actions: [{ id: 'open', label: 'Open order' }], at: new Date(o.confirmed.at).getTime() })) n++;
      if (o.confirmed && DB.invoiceReady(o) && !o.whPush && emit({ key: 'st:verify:' + id, to: { roles: ['logistics', 'finance'] }, kind: 'order', orderId: id, code: c, popup: DB.needsEway(o) ? undefined : 'pushnow', title: 'Invoice uploaded for ' + id + ': verify and push to the Warehouse', text: d.name + ': check the invoice, then use Verify and push to warehouse.' + (DB.needsEway(o) ? ' The e-way bill (above \u20B950,000) can follow: the Warehouse cannot dispatch until it is uploaded.' : ''), actions: [{ id: 'open', label: 'Open order' }], at: Date.now() })) n++;
      if (o.confirmed && o.whPush && DB.needsEway(o) && o.ewayFile && emit({ key: 'st:eway:' + id, to: { roles: ['warehouse'] }, kind: 'order', orderId: id, code: c, title: 'E-way bill uploaded for ' + id, text: d.name + ': the e-way bill is uploaded. Order dispatched is now enabled for this order.', actions: [{ id: 'open', label: 'Open order' }], at: Date.now() })) n++;
      if (o.confirmed && o.whPush && DB.invoiceReady(o) && emit({ key: 'st:invoiced:' + id, to: { roles: ['warehouse'] }, kind: 'order', popup: 'neworder', orderId: id, code: c, title: 'New order to pack: ' + id, text: d.name + ': invoice uploaded. Please pack it.' + (DB.needsEway(o) && !o.ewayFile ? ' The e-way bill is still pending: you can pack, but the order cannot be dispatched until Logistics or Finance uploads it.' : ''), actions: [{ id: 'open', label: 'Open order' }], at: Date.now() })) n++;
      if (o.whDispatch && emit({ key: 'st:transit:' + id, to: { roles: ['logistics', 'finance'] }, kind: 'order', orderId: id, code: c, title: 'Order in transit: add tracking for ' + id, text: d.name + ': the Warehouse dispatched it. Add the courier partner and tracking ID, then mark it delivered.', actions: [{ id: 'open', label: 'Open order' }], at: Date.now() })) n++;
      if (DB.whState(o) === 'PACKED') { if (['Placed'].indexOf(o.status) > -1) patchOrder(c, id, function (x) { x.status = 'Processing'; }); if (!(o.history || []).some(function (h) { return /^packed/i.test(h.status); })) patchOrder(c, id, function (x) { x.history = x.history || []; x.history.push({ status: 'Packed: ready for pickup', at: new Date().toISOString() }); });
        if (emit({ key: 'st:packed:' + id, to: { roles: ['logistics', 'finance'], users: emp ? [emp] : [] }, kind: 'order', popup: 'readypick', orderId: id, code: c, title: 'Order ready to be picked up: ' + id, text: d.name + ': the Warehouse has packed this order. It is ready to be picked up — book the pickup and add tracking.', actions: [{ id: 'open', label: 'Open order' }], at: Date.now() })) n++; }
    }); }); set('stgseen', seen); if (base) set('stgbase', 1); return n;
  };
  /* ---- revising a paid order before it is pushed: a lower total returns the extra as a credit note once the dealer or Sales confirms ---- */
  DB.proposeRevision = function (code, id, specs, by, role) {
    var o = DB.getOrder(code, id); if (!o) return { error: 'Order not found.' }; if (!(o.payment.status === 'Paid' && !o.confirmed)) return { error: 'A paid order can be revised only before it is pushed to Logistics and Finance.' }; if (o.revision && o.revision.status === 'awaiting') return { error: 'A revision is already waiting for confirmation.' };
    var d = DB.getDealer(code), lines = [], bad = null; specs.forEach(function (s) { var q = parseInt(s.qty, 10); if (!(q > 0)) return; var f = SEL.findProduct(s.pid), v = null; if (!f) { bad = 'A product was not found.'; return; } f.product.variants.forEach(function (x) { if (x.id === s.vid) v = x; }); if (!v) { bad = 'A pack size was not found.'; return; } var ex = lines.filter(function (x) { return x.pid === s.pid && x.vid === s.vid && x.flavour === (s.flavour || ''); })[0]; if (ex) ex.qty += q; else lines.push({ key: s.pid + '|' + s.vid + '|' + (s.flavour || ''), brand: f.brand, pid: s.pid, product: f.product.name, vid: s.vid, variant: v.label, flavour: s.flavour || '', mrp: v.mrp, price: DB.priceFor(d, s.pid, s.vid, v.mrp), qty: q }); }); if (bad) return { error: bad }; if (!lines.length) return { error: 'An order needs at least one product. Cancel the order instead.' };
    var gj = DB.isGujarat(o.address || d.address, o.pin || d.pincode, d.gst), rc = DB.__recalc(d, o, lines, gj), nt = rc.nt, credit = r2s(o.totals.total - nt.total);
    if (credit <= 0.5) return { error: 'The new total is not lower than the amount paid. To add products, use Edit order: you pay the difference.' };
    var oldQ = {}, newQ = {}; (o.items || []).forEach(function (l) { var k = l.pid + '|' + l.vid + '|' + l.flavour; oldQ[k] = (oldQ[k] || 0) + l.qty; }); lines.forEach(function (l) { var k = l.pid + '|' + l.vid + '|' + l.flavour; newQ[k] = (newQ[k] || 0) + l.qty; }); var up = Object.keys(newQ).some(function (k) { return newQ[k] > (oldQ[k] || 0); }); if (up) return { error: 'A revision that lowers the total cannot also add quantity. Do one change at a time.' };
    var back = []; Object.keys(oldQ).forEach(function (k) { var dq = oldQ[k] - (newQ[k] || 0); if (dq > 0) { var p = k.split('|'); back.push({ pid: p[0], vid: p[1], flavour: p[2], qty: dq }); } });
    patchOrder(code, id, function (x) { x.revision = { status: 'awaiting', items: lines, totals: nt, credit: credit, back: back, by: by, at: new Date().toISOString() }; x.history = x.history || []; x.history.push({ status: 'Revision proposed by ' + by + ': credit ' + credit + ' once confirmed' + (rc.note ? '. ' + rc.note : ''), at: new Date().toISOString() }); });
    DB.addAlert({ key: 'rev:' + id + ':' + Date.now(), to: { users: [o.attr && o.attr.emp].filter(Boolean), roles: ['admin'] }, kind: 'order', orderId: id, code: code, title: 'Confirm the revision of ' + id, text: 'The dealer or Sales must confirm. Extra paid ' + credit.toFixed(2) + ' will be returned as a credit note.', actions: [{ id: 'open', label: 'Open order' }] }); return { ok: true, credit: credit };
  };
  DB.cancelRevision = function (code, id, by) { var o = DB.getOrder(code, id); if (!o || !o.revision || o.revision.status !== 'awaiting') return { error: 'No revision is waiting.' }; patchOrder(code, id, function (x) { x.revision.status = 'cancelled'; x.history.push({ status: 'Revision cancelled by ' + by, at: new Date().toISOString() }); }); return { ok: true }; };
  DB.confirmRevision = function (code, id, by, role) {
    if (['dealer', 'employee', 'admin'].indexOf(role) < 0) return { error: 'Only the dealer or the Sales employee confirms a revision.' }; var o = DB.getOrder(code, id); if (!o || !o.revision || o.revision.status !== 'awaiting') return { error: 'No revision is waiting.' }; if (o.confirmed) return { error: 'The order was already pushed.' }; var rv = o.revision, err = null;
    rv.back.forEach(function (b) { if (err) return; var sku = SEL.sku(b.pid, b.vid), bs = DB.batches(sku).filter(function (x) { return (x.flavour || '') === (b.flavour || '') && !x.q; }).sort(function (a, c) { return a.exp < c.exp ? 1 : -1; })[0]; if (!bs) { err = 'No batch of ' + sku + ' to return the stock to. Ask Finance.'; return; } var r = DB.stockIn(sku, { no: 'REV-' + id, mfg: bs.mfg, exp: bs.exp, qty: b.qty, flavour: b.flavour, supplier: 'Order revision ' + id, ref: 'Revision of ' + id, src: 'REVISION' }, by); if (r.error) err = r.error; });
    if (err) return { error: err };
    var cn = 'CN/REV/' + id + '/' + Date.now().toString(36).slice(-4).toUpperCase(); patchOrder(code, id, function (x) { x.items = rv.items; x.totals = rv.totals; x.revision.status = 'confirmed'; x.revision.confirmedBy = by + ' (' + role + ')'; x.revision.cn = cn; x.revision.confirmedAt = new Date().toISOString(); x.history.push({ status: 'Revision confirmed by ' + by + ': credit note ' + cn + ' for ' + rv.credit.toFixed(2), at: new Date().toISOString() }); });
    postL(code, { type: 'Credit note', credit: rv.credit, debit: 0, orderId: id, ref: cn, desc: 'Order ' + id + ' revised: extra amount paid', by: 'SYSTEM (revision confirmed by ' + by + ')' }); return { ok: true, cn: cn, credit: rv.credit };
  };
  /* ---- freebie wallet: an unused part of the allowance is carried to the dealer's next order ---- */
  DB.freebieWallet = function (code) { ensureSeed(); return get('fwallet', {})[code] || 0; };
  var _fo0 = DB.freebieOptions; DB.freebieOptions = function (code, lines, coupon) { var o = _fo0(code, lines, coupon), w = o.allowance > 0 || o.qualifying > 0 ? DB.freebieWallet(code) : 0; o.base = o.allowance; o.wallet = w; o.allowance = o.allowance + w; return o; };
  var _ao0 = DB.addOrder; DB.addOrder = function (code, o) {
    if (o && o.totals && !o.freightPolicy && !o.hist) o.freightPolicy = { on: !!o.totals.freightOn, amount: o.totals.freightManual ? o.totals.freight : null };
    var r = _ao0.apply(DB, arguments); try { if (o && o.items && !o.hist && !o.demo) { var fo = DB.freebieOptions(code, o.items, (o.totals && o.totals.couponCode) || null), used = o.freebieValue || 0; if (fo.base > 0) { var w = get('fwallet', {}), before = w[code] || 0, after = Math.max(0, Math.round((fo.base + before - used) * 100) / 100); w[code] = after; set('fwallet', w); patchOrder(code, o.id, function (x) { x.freebieSettle = { base: fo.base, walletBefore: before, used: used, walletAfter: after }; }); } } } catch (e) {} return r;
  };
  function ensureOps6() {
    if (inOps6 || get('ops6', 0) >= OPS6 || get('ops5', 0) < 1) return; inOps6 = true;
    try { var sal = get('salary', {}), base = { warehouse: 18000, sales: 28000, logistics: 22000, finance: 30000, branding: 26000, it: 32000, hr: 27000 }; get('employees', []).filter(function (e) { return e.dept !== 'host'; }).forEach(function (e) { if (!sal[e.id]) sal[e.id] = { amount: base[e.dept] || 20000, by: 'ADMIN', at: Date.now(), history: [] }; }); set('salary', sal);
      var ords = get('dealers', []); ords.forEach(function (d) { var l = get('orders.' + d.code, []); l.forEach(function (o) { if (o.id === 'DEMO-W1' || o.id === 'DEMO-W2' || o.id === 'DEMO-W3') { if (!o.invoiceFile) { o.invoiceFile = { name: 'invoice-' + o.id + '.pdf', size: 90, data: 'data:application/pdf;base64,JVBERi0xLjQKJSVFT0YK' }; o.invoice = o.invoice || { no: 'DEMO/INV/' + o.id, date: new Date().toISOString() }; } } }); set('orders.' + d.code, l); });
      set('ops6', OPS6); } finally { inOps6 = false; }
  }


  /* =========================== v13: zones and dealer categories, freight by Sales, 8-step order status =========================== */
  var OPS7 = 1, inOps7 = false;
  DB.ZONES = ['North', 'South', 'East', 'West']; DB.CATS = ['Distributor', 'Wholesaler', 'Retailer', 'Gym', 'Solo buyer'];
  var ZSTATES = {
    North: ['Jammu and Kashmir', 'Ladakh', 'Himachal Pradesh', 'Punjab', 'Haryana', 'Uttarakhand', 'Uttar Pradesh', 'Rajasthan', 'Delhi', 'Chandigarh'],
    South: ['Andhra Pradesh', 'Telangana', 'Karnataka', 'Kerala', 'Tamil Nadu', 'Puducherry', 'Lakshadweep'],
    East: ['Bihar', 'Jharkhand', 'Odisha', 'West Bengal', 'Sikkim', 'Assam', 'Arunachal Pradesh', 'Meghalaya', 'Manipur', 'Mizoram', 'Nagaland', 'Tripura', 'Chhattisgarh', 'Andaman and Nicobar Islands'],
    West: ['Gujarat', 'Maharashtra', 'Goa', 'Madhya Pradesh', 'Dadra and Nagar Haveli and Daman and Diu']
  };
  DB.ZSTATES = ZSTATES;
  function zk(s) { return String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/\(.*?\)/g, ' ').replace(/[^a-z ]/g, ' ').replace(/\band\b/g, ' ').replace(/\s+/g, ' ').trim(); }
  var ZMAP = { orissa: 'East', uttaranchal: 'North', pondicherry: 'South', 'nct of delhi': 'North', 'new delhi': 'North', 'daman diu': 'West', 'dadra nagar haveli': 'West', 'andaman nicobar': 'East' };
  Object.keys(ZSTATES).forEach(function (z) { ZSTATES[z].forEach(function (s) { ZMAP[zk(s)] = z; }); });
  DB.zoneOfState = function (name) { var k = zk(name); if (!k) return ''; if (ZMAP[k]) return ZMAP[k]; var hit = ''; Object.keys(ZMAP).forEach(function (key) { if (!hit && k.length > 4 && (k.indexOf(key) > -1 || key.indexOf(k) > -1)) hit = ZMAP[key]; }); return hit; };
  DB.dealerState = function (d) { d = d || {}; var s = DB.stateFromPin(d.pincode || DB.pinFrom(d.address)); if (s && s.name) return s.name; if (d.state) return d.state; var parts = String(d.city || '').split(','); return parts.length > 1 ? parts[parts.length - 1].trim() : ''; };
  DB.zoneOf = function (d) { return DB.zoneOfState(DB.dealerState(d)); };
  DB.zoneMatrix = function () { var m = {}; DB.ZONES.forEach(function (z) { m[z] = { total: 0 }; DB.CATS.forEach(function (c) { m[z][c] = 0; }); }); m.Unassigned = { total: 0 }; DB.CATS.forEach(function (c) { m.Unassigned[c] = 0; }); m.Unassigned.None = 0; get('dealers', []).forEach(function (d) { var z = DB.zoneOf(d) || 'Unassigned', c = d.category; var row = m[z]; row.total++; if (DB.CATS.indexOf(c) > -1) row[c]++; else row.None = (row.None || 0) + 1; }); return m; };
  var _sda1 = DB.saveDealerAs; DB.saveDealerAs = function (d, by, role) {
    if (!d.category || DB.CATS.indexOf(d.category) < 0) return { error: 'Select the dealer category (Distributor, Wholesaler, Retailer, Gym or Solo buyer).' };
    if (d.freightFixed !== undefined && d.freightFixed !== '' && !(parseFloat(d.freightFixed) >= 0)) return { error: 'The fixed freight amount must be a number (or leave it empty to use the slabs).' };
    var r = _sda1.apply(DB, arguments); if (r && r.error) return r; var l = get('dealers', []), x = l.filter(function (y) { return y.code === String(d.code).trim().toUpperCase(); })[0]; if (x) { x.category = d.category; x.freightFixed = parseFloat(d.freightFixed) > 0 ? parseFloat(d.freightFixed) : 0; x.state = DB.dealerState(x); x.zone = DB.zoneOf(x); set('dealers', l); } return r;
  };
  /* ---- freight: slab amount, or an amount the Sales employee typed; the dealer cannot change either ---- */
  DB.freightOpt = function (d, o) { if (o && o.freightPolicy) return { freight: !!o.freightPolicy.on, amount: o.freightPolicy.amount == null ? null : +o.freightPolicy.amount }; d = d || {}; return { freight: d.freightApply !== false, amount: +d.freightFixed > 0 ? +d.freightFixed : null }; };
  /* ---- the 8 statuses every department and the dealer see ---- */
  var STAGE_LABELS = ['Order generated', 'Payment confirmed', 'Waiting for invoice', 'Warehouse preparing your order', 'Order being packed', 'Ready to be picked up', 'Order in transit', 'Delivered'], STAGE_KEYS = ['generated', 'paid', 'invoice', 'prep', 'packing', 'ready', 'transit', 'delivered'];
  DB.STAGE_LABELS = STAGE_LABELS;
  DB.stageIdx = function (o) {
    if (o.cancelled) return 0; var paid = o.payment && o.payment.status === 'Paid', wh = DB.whState(o), disp = (['Dispatched', 'Out for delivery'].indexOf(o.status) > -1 || !!o.whDispatch) && !DB.docsPending(o);
    if (o.status === 'Delivered') return 8; if (disp) return 7; if (wh === 'PACKED') return 6; if (wh === 'PACKING') return 5; if (paid && o.confirmed && DB.invoiceReady(o) && o.whPush) return 4; if (paid && o.confirmed) return 3; if (paid) return 2; return 1;
  };
  DB.stageSteps = function (o) {
    var i = DB.stageIdx(o), packedAt = (o.history || []).filter(function (h) { return /^packed/i.test(h.status); }).map(function (h) { return h.at; })[0] || (o.packing && o.packing.at) || null, ats = [o.date, o.payment && o.payment.paidAt, o.confirmed && o.confirmed.at, o.invoice && o.invoice.date, null, packedAt, (o.whDispatch && o.whDispatch.at) || (o.shipment && o.shipment.dispatchedAt), null];
    return STAGE_LABELS.map(function (l, k) { return { key: STAGE_KEYS[k], label: l, done: (k + 1 < i) || (i === 8), cur: k + 1 === i && i < 8, at: ats[k] && (k + 1 <= i) ? ats[k] : null }; });
  };
  DB.stageOf = function (o) {
    var i = DB.stageIdx(o), s = DB.stageSteps(o), sub = '', sh = o.shipment || {};
    if (i === 2) sub = 'Sales pushes it to Logistics and Finance'; else if (i === 3) sub = DB.invoiceReady(o) ? 'Invoice uploaded: Logistics or Finance verifies it and pushes the order to the Warehouse' : 'Logistics or Finance uploads the invoice'; else if (i === 4) sub = 'Waiting for the Warehouse to start packing'; else if (i === 6 && DB.docsPending(o)) sub = DB.docsPending(o) + ': Logistics or Finance uploads it, then the Warehouse can mark the order dispatched'; else if (i === 7) sub = sh.trackingId ? 'Tracking ' + (sh.partner ? sh.partner + ' ' : '') + sh.trackingId : 'Logistics adds the tracking details';
    return { idx: i, steps: s, current: i ? STAGE_KEYS[i - 1] : 'cancelled', label: o.cancelled ? 'Cancelled' : STAGE_LABELS[i - 1], sub: sub, doneCount: i === 8 ? 8 : Math.max(0, i - 1), canDeliver: i === 7 && !!sh.trackingId && !!sh.partner, canOut: i === 7 && !!sh.trackingId && !!sh.partner && o.status !== 'Out for delivery', needsTracking: i === 7 && !(sh.trackingId && sh.partner), canDispatch: i === 6 && !DB.docsPending(o), dispatchBlocked: i === 6 ? DB.docsPending(o) : '' };
  };
  DB.warehouseDispatch = function (code, id, by, role) {
    if (role !== 'warehouse') return { error: 'Only the Warehouse marks an order dispatched.' }; var o = DB.getOrder(code, id); if (!o) return { error: 'Order not found.' }; var dp = DB.docsPending(o); if (dp) return { error: dp + '. Logistics or Finance must upload ' + (!o.invoiceFile ? 'the invoice' : 'the e-way bill') + ' first. The order cannot be dispatched until then.' }; if (o.whDispatch) return { ok: true, already: true }; if (DB.whState(o) !== 'PACKED') return { error: 'Pack the order first. It can be dispatched only after it is marked packed.' };
    patchOrder(code, id, function (x) { var now = new Date().toISOString(); x.whDispatch = { at: now, by: by }; if (['Placed', 'Processing'].indexOf(x.status) > -1) x.status = 'Dispatched'; x.shipment = x.shipment || { partner: '', trackingId: '', status: 'Dispatched', dispatchedAt: now }; x.history = x.history || []; x.history.push({ status: 'Order dispatched by the Warehouse (' + by + '): order in transit', at: now }); }); DB.stageEvents(); return { ok: true };
  };
  DB.markDelivered = function (code, id, by, role) {
    if (role !== 'logistics') return { error: 'Only the Logistics department marks an order delivered.' }; var o = DB.getOrder(code, id); if (!o) return { error: 'Order not found.' }; var dp = DB.docsPending(o); if (dp) return { error: dp + '. The order cannot move on until it is uploaded.' }; if (DB.stageIdx(o) < 7) return { error: 'Only a dispatched order can be marked delivered. The Warehouse dispatches it first.' }; var sh = o.shipment || {}; if (!sh.partner || !sh.trackingId) return { error: 'Add the courier partner and tracking ID before marking the order delivered.' };
    shipPatch(code, id, { partner: sh.partner, trackingId: sh.trackingId, status: 'Delivered' }, by); return { ok: true };
  };
  DB.markOutForDelivery = function (code, id, by, role) {
    if (role !== 'logistics') return { error: 'Only the Logistics department marks an order out for delivery.' }; var o = DB.getOrder(code, id); if (!o) return { error: 'Order not found.' }; var dp = DB.docsPending(o); if (dp) return { error: dp + '. The order cannot move on until it is uploaded.' }; if (DB.stageIdx(o) !== 7) return { error: 'Only a dispatched order can be marked out for delivery.' }; var sh = o.shipment || {}; if (!sh.partner || !sh.trackingId) return { error: 'Add the courier partner and tracking ID before marking the order out for delivery.' };
    if (o.status === 'Out for delivery') return { ok: true, already: true }; shipPatch(code, id, { status: 'Out for delivery' }, by); return { ok: true };
  };
  function ensureOps7() {
    if (inOps7 || get('ops7', 0) >= OPS7 || get('ops6', 0) < 1) return; inOps7 = true;
    try { var cat = { DEMO001: 'Retailer', DEMO002: 'Gym', DEMO003: 'Wholesaler' }, l = get('dealers', []); l.forEach(function (d) { if (!d.category) d.category = cat[d.code] || 'Retailer'; d.freightFixed = d.freightFixed || 0; d.state = DB.dealerState(d); d.zone = DB.zoneOf(d); }); set('dealers', l); set('ops7', OPS7); } finally { inOps7 = false; }
  }


  /* =========================== v14: start from zero (erase all demo data) =========================== */
  var CLEAN_CHECKED = false;
  function cleanId() { return (window.SEL_CONFIG && window.SEL_CONFIG.CLEAN_START_ID) || ''; }
  var KEEP_KEYS = ['cbrands', 'boff', 'bover', 'busy', 'epoch', 'seeded', 'ops', 'ops2', 'ops3', 'ops4', 'ops5', 'ops6', 'ops7', 'ops8', 'ops9', 'couriers', 'fslabs', 'holidays', 'leavepolicy', 'freight', 'salpolicy', 'petrolrate', 'cleanid', 'keepdemo'];
  var EMPTY_ARR = ['news', 'exemps', 'activity', 'allow', 'attcorr', 'btasks', 'dealers', 'fexcl', 'freebies', 'invlog', 'invreq', 'leaves', 'ledger', 'offers', 'posts', 'preorders', 'returns', 'samples', 'shiftlog', 'staffnotifs', 'targets', 'alerts', 'slips'];
  var EMPTY_OBJ = ['weights', 'inactive', 'att', 'batches', 'dledger', 'inv', 'salary', 'samplestock', 'fwallet', 'stgseen'];
  var HOST_DEF = { id: 'ADMIN', name: 'S-ELEVEN Admin', dept: 'host', designation: 'Host', email: 's.eleven.admin@s-eleven.com', mobile: '9023812338', password: '', status: 'active', brands: [], createdAt: Date.now(), createdBy: 'SYSTEM' };   /* the Host password is set by the server from INITIAL_ADMIN_PASSWORD; there is no default */
  /* removes every employee (except the Host), dealer, order, stock, ledger, post, offer and record. Keeps the product catalogue, settings (freight slabs, holidays, leave and salary rules, couriers) and the Host login. */
  DB.eraseAll = function () {
    LS.setItem('sel.v2.busy', String(Date.now())); try { return eraseAll0(); } finally { LS.setItem('sel.v2.epoch', String(Date.now())); LS.removeItem('sel.v2.busy'); }
  };
  function eraseAll0() {
    mem = {};
    var host = get('employees', []).filter(function (e) { return e.dept === 'host'; }); if (!host.length) host = [HOST_DEF];
    Object.keys(LS).forEach(function (k) { if (k.indexOf('sel.v2.') !== 0) return; var n = k.slice(7); if (KEEP_KEYS.indexOf(n) > -1) return; if (EMPTY_ARR.indexOf(n) > -1) LS.setItem(k, '[]'); else if (EMPTY_OBJ.indexOf(n) > -1) LS.setItem(k, '{}'); else if (n === 'employees') LS.setItem(k, JSON.stringify(host)); else LS.removeItem(k); });
    EMPTY_ARR.forEach(function (n) { if (LS.getItem('sel.v2.' + n) === null) LS.setItem('sel.v2.' + n, '[]'); }); EMPTY_OBJ.forEach(function (n) { if (LS.getItem('sel.v2.' + n) === null) LS.setItem('sel.v2.' + n, '{}'); });
    /* v32: a clean system starts with 100 pcs of every product and every logistics partner's rate at 0 (the Host sets the real rates) */
    var inv0 = {}; SEL.allSkus().forEach(function (k) { inv0[k.sku] = { on: 100, res: 0, dmg: 0, rec: 0 }; }); LS.setItem('sel.v2.inv', JSON.stringify(inv0));
    LS.setItem('sel.v2.lrates', JSON.stringify(LRATE_DEF.map(function (x) { return { id: x.id, name: x.name, perKg: 0 }; })));
    LS.setItem('sel.v2.employees', JSON.stringify(host)); LS.setItem('sel.v2.cleanid', cleanId()); LS.removeItem('sel.v2.keepdemo'); CLEAN_CHECKED = true; return { ok: true };
  };
  /* puts the sample demo data back (3 dealers, 12 employees, orders, stock) and keeps it */
  DB.loadDemo = function () {
    LS.setItem('sel.v2.busy', String(Date.now())); try { return loadDemo0(); } finally { LS.setItem('sel.v2.epoch', String(Date.now())); LS.removeItem('sel.v2.busy'); }
  };
  function loadDemo0() {
    mem = {};
    Object.keys(LS).forEach(function (k) { if (k.indexOf('sel.v2.') === 0 && k !== 'sel.v2.busy') LS.removeItem(k); }); LS.setItem('sel.v2.keepdemo', '1'); LS.setItem('sel.v2.cleanid', cleanId()); CLEAN_CHECKED = true; ensureSeed0(); return { ok: true };
  };
  /* other open tabs refresh themselves when the data is erased or replaced */
  if (typeof window.addEventListener === 'function') window.addEventListener('storage', function (e) { if (e.key === 'sel.v2.epoch' && e.newValue) { try { sessionStorage.clear(); } catch (x) {} setTimeout(function () { location.hash = ''; location.reload(); }, 200); } });
  /* the first time this version opens in a browser, it starts from zero (old demo data in that browser is erased once) */
  function applyCleanStart() {
    if (SERVER) return; if (CLEAN_CHECKED) return; CLEAN_CHECKED = true; var id = cleanId(); if (!id) return; if (LS.getItem('sel.v2.keepdemo')) return; if (LS.getItem('sel.v2.cleanid') === id) return; DB.eraseAll();
  }


  /* =========================== v15: activate / deactivate products =========================== */
  /* An inactive product is hidden from dealers and from every employee screen except the places that manage stock (Inventory) and dealer prices. */
  var RAW_CAT = SEL.CATALOG; SEL.RAW_CATALOG = RAW_CAT; SEL._showAll = false;
  function inactMap() { return get('inactive', {}); }
  SEL.CATALOG = new Proxy(RAW_CAT, { get: function (t, k) { var l = t[k]; if (!Array.isArray(l) || SEL._showAll) return l; var m = inactMap(); return l.filter(function (p) { return !m[p.id]; }); } });
  SEL.findProduct = function (pid) { var f = null; Object.keys(RAW_CAT).forEach(function (b) { RAW_CAT[b].forEach(function (p) { if (p.id === pid) f = { brand: b, product: p }; }); }); return f; };
  DB.isActiveProduct = function (pid) { return !inactMap()[pid]; };
  DB.inactiveProducts = function () { return Object.keys(inactMap()); };
  DB.inactiveLines = function (lines) { var m = inactMap(); return (lines || []).filter(function (l) { return m[l.pid]; }); };
  DB.productUsage = function (pid) { var o = 0, p = 0; get('dealers', []).forEach(function (d) { (get('orders.' + d.code, []) || []).forEach(function (x) { if (!x.cancelled && !x.hist && x.status !== 'Delivered' && (x.items || []).some(function (l) { return l.pid === pid; })) o++; }); }); get('preorders', []).forEach(function (x) { if (x.status === 'Waiting for stock' && (x.items || [{ pid: x.pid }]).some(function (l) { return l.pid === pid; })) p++; }); return { orders: o, preorders: p }; };
  DB.setProductActive = function (pid, active, by, role) {
    if (['admin', 'finance', 'logistics', 'warehouse'].indexOf(role) < 0) return { error: 'Only Inventory managers (Host, Finance, Logistics, Warehouse) can activate or deactivate a product.' };
    var f = SEL.findProduct(pid); if (!f) return { error: 'Product not found.' }; var m = inactMap(), was = !!m[pid]; if (active) delete m[pid]; else m[pid] = { at: Date.now(), by: by }; set('inactive', m);
    DB.notifyAction(by, active ? 'Product activated' : 'Product deactivated', f.product.name.split(' (')[0], 'inventory'); return { ok: true, changed: was === !!active };
  };
  var _vl1 = DB.validateLines; DB.validateLines = function (lines) { var g = DB.inactiveLines(lines)[0]; if (g) return g.product.split(' (')[0] + ': no longer available'; return _vl1(lines); };


  /* =========================== v16: dealer login details (view and reset) =========================== */
  /* The Host, or the Sales employee the dealer is assigned to, can set a new password; the old one stops working at once. */
  DB.resetDealerPassword = function (code, pw, by, role) {
    var l = get('dealers', []), x = l.filter(function (y) { return y.code === String(code).trim().toUpperCase(); })[0]; if (!x) return { error: 'Dealer not found.' };
    if (!(role === 'admin' || (role === 'employee' && x.salesEmp === by))) return { error: 'Only the Host or the dealer\u2019s own Sales employee can reset this password.' };
    pw = String(pw || ''); if (pw.length < 6 || pw.length > 64 || /\s/.test(pw)) return { error: 'The password must be 6 to 64 characters with no spaces.' };
    x.password = pw; x.pwChangedAt = Date.now(); x.pwChangedBy = by; set('dealers', l); DB.notifyAction(by, 'Dealer password reset', x.name + ' (' + x.code + ')', 'security'); return { ok: true };
  };
  DB.dealerLoginInfo = function (code, by, role) {
    var x = get('dealers', []).filter(function (y) { return y.code === String(code).trim().toUpperCase(); })[0]; if (!x) return null; if (!(role === 'admin' || (role === 'employee' && x.salesEmp === by))) return null; return { code: x.code, password: x.password, changedAt: x.pwChangedAt || null, changedBy: x.pwChangedBy || '' };
  };


  /* =========================== v17: logistics partners and weight rates, dispatch-from, packing notes, tracking after packing, ex-employees =========================== */
  var LRATE_DEF = [{ id: 'dtdc', name: 'DTDC', perKg: 70 }, { id: 'tirupati', name: 'Tirupati', perKg: 47 }, { id: 'trackon', name: 'Trackon', perKg: 50 }, { id: 'vxpress', name: 'VXpress', perKg: 8 }, { id: 'ithink', name: 'iThink', perKg: 70 }];
  DB.logisticsRates = function () { ensureSeed(); var l = get('lrates', null); return (l && l.length ? l : LRATE_DEF).map(function (x) { return { id: x.id, name: x.name, perKg: x.perKg }; }); };
  DB.saveLogisticsRate = function (id, perKg, by, role) {
    if (['admin', 'finance', 'logistics'].indexOf(role) < 0) return { error: 'Only the Host, Finance or Logistics can change logistics rates.' }; var v = parseFloat(perKg); if (!(v >= 0) || v > 10000) return { error: 'Enter a rate per kg between 0 and 10,000.' };
    var found = false, l = DB.logisticsRates().map(function (x) { if (x.id === id) { found = true; return { id: x.id, name: x.name, perKg: Math.round(v * 100) / 100 }; } return x; }); if (!found) return { error: 'Logistics partner not found.' }; set('lrates', l); DB.notifyAction(by, 'Logistics rate changed', id + ': ' + v + ' per kg', 'security'); return { ok: true };
  };
  var _lc1 = DB.listCouriers; DB.listCouriers = function () {
    var l = _lc1(), add = [{ id: 'tirupati', name: 'Tirupati Courier', url: 'https://www.tirupaticourier.in/track?awb={id}', sample: true }, { id: 'trackon', name: 'Trackon', url: 'https://www.trackoncourier.com/track?awb={id}', sample: true }, { id: 'vxpress', name: 'VXpress', url: 'https://www.vxpress.in/track?awb={id}', sample: true }, { id: 'ithink', name: 'iThink Logistics', url: 'https://www.ithinklogistics.com/track?awb={id}', sample: true }], ch = false;
    add.forEach(function (n) { if (!l.some(function (c) { return c.id === n.id; })) { l.push(n); ch = true; } }); if (ch) set('couriers', l); return l;
  };
  /* ---- weights: read from each pack size, editable per product ---- */
  function parseW(label) {
    var s = String(label || '').toLowerCase().replace(/,/g, ''), m;
    if ((m = /([\d.]+)\s*lb/.exec(s))) return { kg: +m[1] * 0.4536, src: 'size' }; if ((m = /([\d.]+)\s*kg/.exec(s))) return { kg: +m[1], src: 'size' }; if ((m = /([\d.]+)\s*g\b/.exec(s))) return { kg: +m[1] / 1000, src: 'size' }; if ((m = /([\d.]+)\s*ml/.exec(s))) return { kg: +m[1] / 1000, src: 'size' };
    if ((m = /(\d+)\s*(capsules|tablets|count)/.exec(s))) return { kg: +m[1] * 0.0018, src: 'estimate' }; if ((m = /(\d+)\s*servings/.exec(s))) return { kg: +m[1] * 0.012, src: 'estimate' }; if ((m = /pack of (\d+)/.exec(s))) return { kg: +m[1] * 0.06, src: 'estimate' };
    if (/travel pack/.test(s)) return { kg: 0.06, src: 'estimate' }; if ((m = /(\d+)\s*\u00D7\s*(\d+)/.exec(s))) return { kg: +m[1] * +m[2] * 0.0035, src: 'estimate' }; return { kg: 0.5, src: 'estimate' };
  }
  DB.weightInfo = function (pid, vid) { var m = get('weights', {}), k = pid + '|' + vid; if (m[k] > 0) return { kg: m[k], src: 'custom' }; var f = SEL.findProduct(pid), v = f && f.product.variants.filter(function (x) { return x.id === vid; })[0], r = parseW(v ? v.label : ''); return { kg: Math.round(r.kg * 1000) / 1000, src: r.src }; };
  DB.weightKg = function (pid, vid) { return DB.weightInfo(pid, vid).kg; };
  DB.setWeight = function (pid, vid, kg, by, role) {
    if (['admin', 'finance', 'logistics', 'warehouse'].indexOf(role) < 0) return { error: 'Only Inventory managers can change product weights.' }; var m = get('weights', {}), k = pid + '|' + vid;
    if (kg === '' || kg === null || kg === undefined) delete m[k]; else { var v = parseFloat(kg); if (!(v > 0) || v > 200) return { error: 'The weight must be more than 0 and at most 200 kg.' }; m[k] = Math.round(v * 1000) / 1000; } set('weights', m); return { ok: true };
  };
  DB.linesWeight = function (lines) { var t = 0; (lines || []).forEach(function (l) { t += DB.weightKg(l.pid, l.vid) * (parseInt(l.qty, 10) || 0); }); return Math.round(t * 1000) / 1000; };
  DB.orderWeight = function (o) { return DB.linesWeight(o.items); };
  DB.logisticsCost = function (o, partnerId) { var r = DB.logisticsRates().filter(function (x) { return x.id === partnerId; })[0]; if (!r) return null; var w = DB.orderWeight(o); return { partner: r.id, name: r.name, perKg: r.perKg, weightKg: w, cost: Math.round(w * r.perKg * 100) / 100 }; };
  /* ---- logistics charges: what each partner was paid for orders actually dispatched, plus the company-borne sample shipping ---- */
  DB.logisticsAnalytics = function (ym) {
    ensureSeed(); var rows = {}, tot = { orders: 0, kg: 0, paid: 0, plannedOrders: 0, plannedCost: 0 }, months = {}, noPartner = 0;
    DB.logisticsRates().forEach(function (r) { rows[r.id] = { id: r.id, name: r.name, perKg: r.perKg, orders: 0, kg: 0, paid: 0, plannedOrders: 0, plannedCost: 0 }; });
    get('dealers', []).forEach(function (dl) { (get('orders.' + dl.code, []) || []).forEach(function (o) {
      if (o.cancelled || !o.payment || !o.totals) return; var df = o.dispatchFrom, out = DB.stageIdx(o) >= 7, when = (o.whDispatch && o.whDispatch.at) || (df && df.at) || o.date, m = String(when).slice(0, 7);
      if (ym && m !== ym) return; if (!df) { if (out) noPartner++; return; }
      var r = rows[df.partner] || (rows[df.partner] = { id: df.partner, name: df.name || df.partner, perKg: df.perKg, orders: 0, kg: 0, paid: 0, plannedOrders: 0, plannedCost: 0 });
      if (out) { r.orders++; r.kg = r2(r.kg + (df.weightKg || 0)); r.paid = r2(r.paid + (df.cost || 0)); tot.orders++; tot.kg = r2(tot.kg + (df.weightKg || 0)); tot.paid = r2(tot.paid + (df.cost || 0)); months[m] = r2((months[m] || 0) + (df.cost || 0)); }
      else { r.plannedOrders++; r.plannedCost = r2(r.plannedCost + (df.cost || 0)); tot.plannedOrders++; tot.plannedCost = r2(tot.plannedCost + (df.cost || 0)); }
    }); });
    var sc = 0, sm = {}; get('samples', []).forEach(function (s) { var h = (s.history || []).filter(function (x) { return x.s === 'Shipped'; })[0]; if (['Shipped', 'Delivered'].indexOf(s.status) < 0) return; var m = new Date(h ? h.at : s.at).toISOString().slice(0, 7); if (ym && m !== ym) return; sc++; sm[m] = (sm[m] || 0) + DB.SAMPLE_SHIP; });
    Object.keys(sm).forEach(function (m) { months[m] = r2((months[m] || 0) + sm[m]); });
    var samples = { count: sc, rate: DB.SAMPLE_SHIP, amount: sc * DB.SAMPLE_SHIP };
    return { ym: ym || '', partners: Object.keys(rows).map(function (k) { return rows[k]; }).sort(function (a, b) { return b.paid - a.paid; }), total: tot, samples: samples, grand: r2(tot.paid + samples.amount), noPartner: noPartner, months: Object.keys(months).sort().map(function (m) { return { ym: m, amount: months[m] }; }) };
  };
  /* ---- dispatch from, packing note, tracking ---- */
  DB.dispatchFrom = function (code, id, partnerId, by, role) {
    if (['logistics', 'finance', 'admin'].indexOf(role) < 0) return { error: 'Only Logistics, Finance or the Host choose the dispatch partner.' }; var o = DB.getOrder(code, id); if (!o) return { error: 'Order not found.' }; if (o.status === 'Delivered') return { error: 'This order is delivered, so its documents, notes and details can no longer be changed.' }; if (o.payment.status !== 'Paid') return { error: 'Choose the dispatch partner after payment is received.' };
    var c = DB.logisticsCost(o, partnerId); if (!c) return { error: 'Choose a logistics partner from the list.' };
    patchOrder(code, id, function (x) { var at = new Date().toISOString(); x.dispatchFrom = { partner: c.partner, name: c.name, perKg: c.perKg, weightKg: c.weightKg, cost: c.cost, by: by, at: at }; x.history = x.history || []; x.history.push({ status: 'Dispatch partner: ' + c.name + ' (' + c.weightKg + ' kg x ' + c.perKg + ' = ' + c.cost + ')', at: at }); });
    DB.notifyAction(by, 'Dispatch partner chosen', id + ': ' + c.name, 'order'); return { ok: true, cost: c };
  };
  DB.setPackNote = function (code, id, text, by, role) {
    if (['logistics', 'finance', 'admin'].indexOf(role) < 0) return { error: 'Only Logistics, Finance or the Host add packing instructions.' }; var o = DB.getOrder(code, id); if (!o) return { error: 'Order not found.' }; if (o.status === 'Delivered') return { error: 'This order is delivered, so its documents, notes and details can no longer be changed.' }; if (o.whDispatch || ['Dispatched', 'Out for delivery'].indexOf(o.status) > -1) return { error: 'The packing note cannot be changed once the Warehouse has marked the order dispatched.' }; if (o.payment.status !== 'Paid') return { error: 'Add packing instructions after payment is received.' };
    text = String(text || '').trim(); if (text.length > 500) return { error: 'Keep the packing instruction within 500 characters.' };
    patchOrder(code, id, function (x) { var at = new Date().toISOString(); if (text) { x.packNote = { text: text, by: by, at: at }; x.history = x.history || []; x.history.push({ status: 'Packing instruction added', at: at }); } else delete x.packNote; });
    if (text) DB.addAlert({ key: 'pk:' + id + ':' + Date.now(), to: { roles: ['warehouse'] }, kind: 'order', orderId: id, code: code, title: 'Packing instruction for ' + id, text: text.slice(0, 140), actions: [{ id: 'open', label: 'Open order' }] }); return { ok: true };
  };
  DB.setTracking = function (code, id, partner, trackingId, by, role) {
    if (['logistics', 'finance'].indexOf(role) < 0) return { error: 'Only Logistics or Finance add tracking details.' }; var o = DB.getOrder(code, id); if (!o) return { error: 'Order not found.' }; if (o.status === 'Delivered') return { error: 'This order is delivered, so its documents, notes and details can no longer be changed.' }; if (o.payment.status !== 'Paid') return { error: 'Tracking can be added only after payment is received.' };
    if (o.dispatchFrom && o.dispatchFrom.partner && partner !== o.dispatchFrom.partner) return { error: 'Tracking must use the dispatch partner chosen earlier: ' + (o.dispatchFrom.name || o.dispatchFrom.partner) + '.' };
    if (DB.stageIdx(o) < 7) return { error: 'Tracking can be added only after the Warehouse marks the order dispatched.' }; if (!DB.getCourier(partner)) return { error: 'Choose the courier partner.' }; var tid = String(trackingId || '').trim(); if (!/^[A-Za-z0-9\-\/]{4,40}$/.test(tid)) return { error: 'Enter the tracking ID (4 to 40 letters, numbers, - or /).' };
    patchOrder(code, id, function (x) { var at = new Date().toISOString(), old = x.shipment || {}; x.shipment = { partner: partner, trackingId: tid, status: old.status || x.status, dispatchedAt: old.dispatchedAt || null, updatedAt: at, updatedBy: by }; x.history = x.history || []; x.history.push({ status: 'Tracking added: ' + partner + ' ' + tid, at: at }); });
    DB.notifyAction(by, 'Tracking added', id + ': ' + partner + ' ' + tid, 'order'); return { ok: true };
  };
  /* ---- ex-employees: details and profiles kept after someone leaves ---- */
  var _le1 = DB.listEmployees; DB.listEmployees = function (dept) { return _le1(dept).filter(function (e) { return e.status !== 'left'; }); };
  DB.getEmployee = function (id) { var f = null, k = String(id || '').trim().toUpperCase(); _le1().forEach(function (e) { if (e.id === k) f = e; }); return f; };   /* ex-employees still resolve, so old orders and reports keep showing their names */
  DB.listExEmployees = function () { ensureSeed(); return get('exemps', []).slice().sort(function (a, b) { return a.leftOn < b.leftOn ? 1 : -1; }); };
  function exCheck(r) {
    if (!r.name || String(r.name).trim().length < 2) return 'Enter the name.'; if (!DB.DEPTS[r.dept] || r.dept === 'host') return 'Choose the department.'; if (!r.joinedOn || !r.leftOn) return 'Enter the joining date and the last working day.'; if (r.leftOn < r.joinedOn) return 'The last working day cannot be before the joining date.'; if (r.leftOn > tod()) return 'The last working day cannot be in the future.';
    if (!r.reason || String(r.reason).trim().length < 3) return 'Enter the reason for leaving.'; if (r.mobile && !/^\d{10}$/.test(String(r.mobile).replace(/\D/g, ''))) return 'The mobile number must be 10 digits.'; if (r.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email)) return 'Enter a valid email address.'; if (r.lastSalary !== '' && r.lastSalary !== undefined && !(parseFloat(r.lastSalary) >= 0)) return 'The last salary must be a number.'; return '';
  }
  function exClean(r) { return { name: String(r.name).trim(), dept: r.dept, designation: String(r.designation || '').trim(), email: String(r.email || '').trim(), mobile: String(r.mobile || '').replace(/\D/g, ''), joinedOn: r.joinedOn, leftOn: r.leftOn, reason: String(r.reason).trim(), notes: String(r.notes || '').trim(), lastSalary: r.lastSalary === '' || r.lastSalary === undefined ? 0 : Math.round(parseFloat(r.lastSalary) * 100) / 100 }; }
  DB.addExEmployee = function (r, by, role) { if (!isHRrole(role)) return { error: 'Only the Host or HR can add ex-employee records.' }; var er = exCheck(r); if (er) return { error: er }; var l = get('exemps', []), rec = Object.assign({ id: 'EX-' + (1001 + l.length), source: 'record', by: by, at: Date.now() }, exClean(r)); l.push(rec); set('exemps', l); DB.notifyAction(by, 'Ex-employee record added', rec.name, 'security'); return { ok: true, rec: rec }; };
  DB.updateExEmployee = function (id, r, by, role) { if (!isHRrole(role)) return { error: 'Only the Host or HR can edit ex-employee records.' }; var l = get('exemps', []), x = l.filter(function (y) { return y.id === id; })[0]; if (!x) return { error: 'Record not found.' }; var er = exCheck(Object.assign({}, x, r)); if (er) return { error: er }; Object.assign(x, exClean(Object.assign({}, x, r))); x.editedBy = by; x.editedAt = Date.now(); set('exemps', l); return { ok: true }; };
  DB.markEmployeeLeft = function (id, info, by, role) {
    if (!isHRrole(role)) return { error: 'Only the Host or HR can mark an employee as an ex-employee.' }; var list = get('employees', []), e = list.filter(function (x) { return x.id === id; })[0]; if (!e) return { error: 'Employee not found.' }; if (e.dept === 'host') return { error: 'The Host account cannot be marked as an ex-employee.' }; if (e.status === 'left') return { error: 'This employee is already an ex-employee.' };
    var leftOn = info.leftOn || tod(); if (leftOn > tod()) return { error: 'The last working day cannot be in the future.' }; if (!info.reason || String(info.reason).trim().length < 3) return { error: 'Enter the reason for leaving.' };
    var ds = get('dealers', []), mine = ds.filter(function (d) { return d.salesEmp === id; }), tgt = info.reassignTo || '';
    if (mine.length) { if (!tgt) return { error: 'This employee is the Sales employee for ' + mine.length + ' dealer(s). Choose who takes them over, or "Leave unassigned".', dealers: mine.length }; if (tgt !== '-') { var te = list.filter(function (x) { return x.id === tgt && x.dept === 'sales' && x.status === 'active'; })[0]; if (!te || tgt === id) return { error: 'Choose an active Sales employee to take over the dealers.' }; } ds.forEach(function (d) { if (d.salesEmp === id) d.salesEmp = tgt === '-' ? '' : tgt; }); set('dealers', ds); }
    var att = get('att', {}), sl = att[id]; if (sl && sl.length && !sl[sl.length - 1].out) { sl[sl.length - 1].out = new Date().toISOString(); sl[sl.length - 1].src = (sl[sl.length - 1].src || '') + ' (left the company)'; set('att', att); }
    e.status = 'left'; e.leftOn = leftOn; set('employees', list);
    var ex = get('exemps', []); ex = ex.filter(function (x) { return x.id !== id; }); ex.push({ id: e.id, source: 'employee', name: e.name, dept: e.dept, designation: e.designation || '', email: e.email || '', mobile: e.mobile || '', joinedOn: e.createdAt ? new Date(e.createdAt).toISOString().slice(0, 10) : leftOn, leftOn: leftOn, reason: String(info.reason).trim(), notes: String(info.notes || '').trim(), lastSalary: DB.salaryOf(id), reassignedDealers: mine.length ? { count: mine.length, to: tgt === '-' ? 'Unassigned' : tgt } : null, by: by, at: Date.now() }); set('exemps', ex);
    DB.notifyAction(by, 'Employee marked as ex-employee', e.name + ' (' + e.id + ')', 'security'); return { ok: true, dealers: mine.length };
  };
  DB.reinstateEmployee = function (id, by, role) { if (!isHRrole(role)) return { error: 'Only the Host or HR can reinstate an employee.' }; var ex = get('exemps', []), r = ex.filter(function (x) { return x.id === id; })[0]; if (!r) return { error: 'Record not found.' }; if (r.source !== 'employee') return { error: 'Only people who had a portal login can be reinstated. Create a new employee instead.' }; var list = get('employees', []), e = list.filter(function (x) { return x.id === id; })[0]; if (!e) return { error: 'The employee account no longer exists.' }; e.status = 'active'; delete e.leftOn; set('employees', list); set('exemps', ex.filter(function (x) { return x.id !== id; })); DB.notifyAction(by, 'Ex-employee reinstated', e.name + ' (' + e.id + ')', 'security'); return { ok: true }; };
  DB.exProfile = function (id) {
    var r = DB.listExEmployees().filter(function (x) { return x.id === id; })[0]; if (!r) return null; var out = Object.assign({}, r), a = new Date(r.joinedOn), b = new Date(r.leftOn); out.tenureDays = isNaN(a) || isNaN(b) ? 0 : Math.max(0, Math.round((b - a) / 864e5));
    if (r.source === 'employee') { var ses = DB.sessions(r.id), days = {}; ses.forEach(function (s) { days[ymd(s.in)] = 1; }); out.daysPresent = Object.keys(days).length; out.lastIn = ses.length ? ses[ses.length - 1].in : null; out.slips = DB.listSlips(r.id); out.orders = DB.allOrders().filter(function (o) { return o.attr && o.attr.emp === r.id; }).length; out.dealersCreated = get('dealers', []).filter(function (d) { return d.createdBy === r.id; }).length; out.allowances = DB.listAllow(r.id).filter(function (x) { return x.status === 'Approved'; }).reduce(function (s, x) { return s + x.amount; }, 0); }
    return out;
  };


  /* =========================== v18: orders appear to a department only when they are pushed to it =========================== */
  /* Finance, Logistics and Warehouse see nothing of an order until Sales confirms the payment and pushes it. Finance also sees an order once a payment proof has been uploaded for it (so it can verify the money).
     The Warehouse sees it only after Logistics or Finance has verified the invoice and pushed it to the Warehouse. */
  DB.visibleTo = function (role, o) {
    if (!o) return false; if (o.hist) return true;
    if (role === 'logistics') return !!o.confirmed;
    if (role === 'finance') return !!(o.confirmed || (o.proofs && o.proofs.length));
    if (role === 'warehouse') return !!(o.confirmed && o.whPush) || ['PACKING', 'PACKED'].indexOf(DB.whState(o)) > -1 || !!o.whDispatch;
    return true;
  };
  DB.pushToWarehouse = function (code, id, by, role) {
    if (['logistics', 'finance', 'admin'].indexOf(role) < 0) return { error: 'Only Logistics, Finance or the Host verify the invoice and push an order to the Warehouse.' };
    var o = DB.getOrder(code, id); if (!o) return { error: 'Order not found.' }; if (o.cancelled) return { error: 'This order is cancelled.' }; if (!o.confirmed) return { error: 'Sales has not pushed this order yet.' };
    if (!o.invoiceFile) return { error: 'Upload the invoice first.' }; if (o.whPush) return { ok: true, already: true };
    patchOrder(code, id, function (x) { var at = new Date().toISOString(); x.whPush = { by: by, at: at, invoice: x.invoice ? x.invoice.no : '' }; x.history = x.history || []; x.history.push({ status: 'Invoice verified and pushed to the Warehouse by ' + by, at: at }); });
    DB.notifyAction(by, 'Pushed to Warehouse', id, 'order'); return { ok: true };
  };
  var _sp8 = DB.startPacking; DB.startPacking = function (code, id, by) { var o = DB.getOrder(code, id); if (o && !o.hist && o.confirmed && !o.whPush && !o.packing) return { error: 'This order has not been pushed to the Warehouse yet. Logistics or Finance verifies the invoice and pushes it.' }; return _sp8.apply(DB, arguments); };
  var OPS8 = 1, inOps8 = false;
  var inOps9 = false;
  var inOps10 = false;
  function ensureOps10() {   /* v26 sample data: zones for Sales, three field consultants with brands and commission, their dealers and orders (every stage), CRM leads, visits, and an RTO waiting for the Host */
    if (inOps10 || get('ops10', 0) >= 1 || get('ops9', 0) < 1) return;
    /* sample data exists only where the demo data exists: a clean install (no demo dealers or no demo Sales person) gets nothing */
    if (!get('dealers', []).length || !get('employees', []).some(function (e) { return e.id === 'SALES'; })) { set('ops10', 1); return; }
    inOps10 = true;
    try {
      var PDFD = 'data:application/pdf;base64,JVBERi0xLjQKJSVFT0YK', PNGD = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', now = Date.now(), HR = 36e5, NOTE = 'DEMO order. Test data only.';
      var emps = get('employees', []), tpl = emps.filter(function (e) { return e.id === 'SALES'; })[0] || emps[0];
      emps.forEach(function (e) { if (e.id === 'SALES') e.zone = 'West'; if (e.id === 'SALES2') e.zone = 'North'; if (e.id === 'SALES3') e.zone = 'South'; if (e.id === 'SALES4') e.zone = 'East'; });
      function fb(o) { var r = {}; Object.keys(o).forEach(function (b) { r[b] = { on: true, pct: o[b], by: 'SALES', at: now - 20 * 24 * HR }; }); return r; }
      [['FIELD01', 'Kiran Patel', '9000011101', 'West', 'Ahmedabad', 'SALES', { bolt: 5, ved: 4, wheymill: 3 }, 'Gujarat'], ['FIELD02', 'Neha Verma', '9000011102', 'North', 'Delhi', 'SALES2', { bolt: 6, eleo1ne: 4 }, 'Delhi'], ['FIELD03', 'Rahul Nair', '9000011103', 'South', 'Bengaluru', 'SALES3', { bolt: 5, pureluxe: 4 }, 'Karnataka'], ['FIELD04', 'Anita Das', '9000011104', 'East', 'Kolkata', 'SALES4', { bolt: 5, ved: 4 }, 'West Bengal']].forEach(function (f) {
        var e = JSON.parse(JSON.stringify(tpl)); e.id = f[0]; e.name = f[1]; e.dept = 'fieldsales'; e.designation = 'Field Sales Consultant'; e.email = f[0].toLowerCase() + '@s-eleven.demo'; e.mobile = f[2]; e.password = 'field123'; e.status = 'active'; e.zone = f[3]; e.city = f[4]; e.state = f[7]; e.manager = f[5]; e.fieldBrands = fb(f[6]); e.createdAt = now - 30 * 24 * HR; e.brands = []; emps.push(e);
      });
      set('employees', emps);
      var dtpl = get('dealers', [])[0], dl = get('dealers', []);
      [['FDEMO1', 'Shree Ganesh Sports Nutrition', 'Mahesh Shah', 'Ahmedabad', '9900000011', '12, Satellite Road, Ahmedabad 380015', '380015', 'Retailer', 'FIELD01'], ['FDEMO2', 'Delhi Fit Hub', 'Anil Kapoor', 'Delhi', '9900000012', 'B-14, Lajpat Nagar, New Delhi 110024', '110024', 'Gym', 'FIELD02'], ['FDEMO3', 'Bengaluru Protein Point', 'Suresh Reddy', 'Bengaluru', '9900000013', '45, Koramangala 5th Block, Bengaluru 560095', '560095', 'Retailer', 'FIELD03'], ['FDEMO4', 'Surat Gym Supplements', 'Dipak Mehta', 'Surat', '9900000014', '7, Adajan Road, Surat 395009', '395009', 'Gym', 'FIELD01'], ['FDEMO5', 'Kolkata Fitness Mart', 'Rina Sen', 'Kolkata', '9900000015', '22, Salt Lake Sector V, Kolkata 700091', '700091', 'Retailer', 'FIELD04']].forEach(function (x) {
        var d = JSON.parse(JSON.stringify(dtpl)); d.code = x[0]; d.name = x[1]; d.person = x[2]; d.city = x[3]; d.phone = x[4]; d.address = x[5]; d.pincode = x[6]; d.category = x[7]; d.gst = ''; d.password = 'fdemo123'; d.salesEmp = x[8]; d.createdBy = (emps.filter(function (e) { return e.id === x[8]; })[0] || {}).manager || 'SALES'; d.createdAt = now - 25 * 24 * HR; d.brandPct = {}; d.prices = DB.randomPrices(x[0]); delete d.pricesPending; d.active = true; dl.push(d);
      });
      set('dealers', dl);
      /* orders, each at a different stage of the normal flow */
      function prod(brand, n) { var p = (SEL.CATALOG[brand] || [])[n || 0]; return p ? { p: p, v: p.variants[0] } : null; }
      function placed(code, id, specs, by, hours, o) {
        o = o || {}; var d = DB.getDealer(code), lines = []; specs.forEach(function (s) { var c = prod(s[0], s[2]); if (!c) return; lines.push({ key: c.p.id + '|' + c.v.id + '|0', brand: s[0], pid: c.p.id, product: c.p.name, vid: c.v.id, variant: c.v.label, flavour: (c.p.flavours && c.p.flavours[0]) || '', mrp: c.v.mrp, price: DB.priceFor(d, c.p.id, c.v.id, c.v.mrp), qty: s[1] }); }); if (!lines.length) return;
        var at = new Date(now - hours * HR).toISOString(), gj = parseInt(d.pincode, 10) >= 360000 && parseInt(d.pincode, 10) <= 396999, who = emps.filter(function (e) { return e.id === by; })[0];
        var ord = { id: id, date: at, status: 'Placed', payment: { method: '', status: 'Pending', txn: '' }, items: lines, freebies: [], totals: DB.calcTotals(lines, null, gj), address: d.address, pin: d.pincode, phone: d.phone, gst: d.gst, note: NOTE, shipment: null, history: [{ status: 'Placed', at: at }], buyer: { name: d.name, gst: d.gst, address: d.address, pin: d.pincode, phone: d.phone }, ship: { address: d.address, pin: d.pincode, phone: d.phone }, demo: true, createdBy: { code: by, name: who ? who.name : by, role: 'employee' } };
        var r = DB.addOrder(code, ord); if (r && r.error) return;
        if (o.paid) DB.markPaid(code, id, { method: 'UPI (demo)', txn: 'DEMO-TXN-' + id, by: 'FINANCE' });
        if (o.confirm) DB.confirmOrder(code, id, (who || {}).manager || 'SALES');   /* the allocated Sales executive confirms: only then do Logistics and Finance receive it */
        if (o.invoice) DB.attachInvoiceFile(code, id, { name: 'invoice-' + id + '.pdf', size: 90, data: PDFD, no: 'DEMO/26-27/F' + id.replace(/\D/g, '').slice(-3) }, 'LOGISTICS');
        if (o.proof) DB.addProof(code, id, { method: 'UPI', ref: o.proof, date: DB.tod(), amount: ord.totals.total, name: 'payment-screenshot.png', size: 6594, data: PNGD }, by, 'employee');
        if (o.seen) DB.markSeen(code, id, 'WAREHOUSE');
        if (o.pack) { DB.startPacking(code, id, 'WAREHOUSE'); ((DB.getOrder(code, id).packing || {}).items || []).forEach(function (it) { DB.verifyItem(code, id, it.key, it.req, 'WAREHOUSE'); }); DB.finishPacking(code, id, 'WAREHOUSE'); }
        if (o.ship) shipPatch(code, id, { partner: 'delhivery', trackingId: 'DEMOTRK' + id.replace(/\D/g, ''), status: o.ship }, 'LOGISTICS');
      }
      var all = { paid: true, confirm: true, invoice: true, seen: true, pack: true };
      placed('FDEMO1', 'DEMO-FO1', [['bolt', 4]], 'FIELD01', 150, Object.assign({ ship: 'Delivered' }, all));                       /* delivered: stays in On field orders */
      placed('FDEMO1', 'DEMO-FO2', [['ved', 3], ['wheymill', 2]], 'FIELD01', 40, Object.assign({ ship: 'Dispatched' }, all));     /* in transit */
      placed('FDEMO2', 'DEMO-FO3', [['bolt', 5]], 'FIELD02', 20, { proof: 'DEMOUTR200001' });                                    /* payment proof waiting for Finance */
      placed('FDEMO2', 'DEMO-FO4', [['eleo1ne', 3]], 'FIELD02', 8, {});                                                            /* just placed: awaiting payment */
      placed('FDEMO3', 'DEMO-FO5', [['bolt', 3], ['pureluxe', 4]], 'FIELD03', 10, all);                                           /* packed: ready for Logistics */
      placed('FDEMO3', 'DEMO-FO6', [['bolt', 2]], 'FIELD03', 220, Object.assign({ ship: 'Delivered' }, all));                     /* delivered */
      placed('FDEMO5', 'DEMO-FO9', [['bolt', 3], ['ved', 2]], 'FIELD04', 6, { paid: true });                                    /* East: paid, waiting for the Sales executive to confirm */
      placed('FDEMO3', 'DEMO-FO8', [['bolt', 2], ['pureluxe', 1]], 'FIELD03', 4, { paid: true });                                  /* paid: waiting for the Sales executive to confirm and push it */
      placed('FDEMO4', 'DEMO-FO7', [['bolt', 6]], 'FIELD01', 60, Object.assign({ ship: 'Dispatched' }, all));                      /* dispatched: RTO asked, waiting for the Host */
      var o7 = get('orders.FDEMO4', []); o7.forEach(function (o) { if (o.id === 'DEMO-FO7') o.rto = { status: 'Pending', reason: 'Dealer refused delivery: the shop is closed for a week', requestedBy: 'SALES', requestedAt: new Date(now - 2 * HR).toISOString() }; }); set('orders.FDEMO4', o7);
      DB.addStaffNotif({ key: 'rto:DEMO-FO7', kind: 'rto', audience: ['admin'], title: 'RTO approval needed', text: 'DEMO-FO7 (Surat Gym Supplements): Dealer refused delivery: the shop is closed for a week', count: 1, at: now - 2 * HR, popup: 'rto', orderId: 'DEMO-FO7', dealerCode: 'FDEMO4' });
      /* CRM leads (each Sales person sees only their own) */
      function lead(n, o, by, st, h) { return { id: 'CRM-' + ('0000' + n).slice(-4), name: o[0], person: o[1], phone: o[2], email: o[3], gst: '', address: o[4], city: o[5], pincode: o[6], category: o[7], source: o[8], notes: o[9] || '', status: st, lostReason: st === 'Lost' ? 'Went with a local distributor offering credit' : '', owner: by, ownerName: (emps.filter(function (e) { return e.id === by; })[0] || {}).name || by, createdAt: now - h * 24 * HR, updatedAt: now - Math.max(0, h - 2) * 24 * HR, history: [{ at: now - h * 24 * HR, by: by, text: 'Created' }].concat(st === 'New' ? [] : [{ at: now - Math.max(0, h - 2) * 24 * HR, by: by, text: 'Updated (status: ' + st + ')' }]) }; }
      var CL = [lead(8, ['Gandhinagar Gym Hub', 'Bhavin Trivedi', '9811100008', '', 'Sector 11, Gandhinagar 382011', 'Gandhinagar', '382011', 'Gym', 'Field visit', 'Asked for a trial order'], 'FIELD01', 'New', 3), lead(9, ['Vadodara Health Mart', 'Nisha Rana', '9811100009', 'nisha@vhm.demo', 'Alkapuri, Vadodara 390007', 'Vadodara', '390007', 'Retailer', 'Field visit', 'Wants the ved range'], 'FIELD01', 'Contacted', 5), lead(10, ['Noida Fit Store', 'Vikas Gupta', '9811100010', '', 'Sector 18, Noida 201301', 'Noida', '201301', 'Retailer', 'Field visit', ''], 'FIELD02', 'Interested', 4), lead(11, ['Mysore Nutrition Point', 'Latha Gowda', '9811100011', '', 'Vijayanagar, Mysuru 570017', 'Mysuru', '570017', 'Retailer', 'Field visit', ''], 'FIELD03', 'New', 2), lead(12, ['Howrah Gym Supplies', 'Subir Ghosh', '9811100012', '', 'Shibpur, Howrah 711102', 'Howrah', '711102', 'Gym', 'Field visit', 'Gym chain with 3 branches'], 'FIELD04', 'Contacted', 3)];
      set('crm', CL.concat([lead(1, ['Apex Fitness Studio', 'Ravi Shah', '9811100001', 'ravi@apexfit.demo', '12 MG Road, Surat 395001', 'Surat', '395001', 'Gym', 'Walk-in', 'Wants BOLT and ved for 3 branches'], 'SALES', 'Contacted', 9), lead(2, ['Urban Gym & Nutrition', 'Pooja Desai', '9811100002', 'pooja@urbangym.demo', 'Shop 4, Vesu, Surat 395007', 'Surat', '395007', 'Gym', 'Referral', 'Ready to order after price list'], 'SALES', 'Interested', 6), lead(3, ['Metro Health Store', 'Jignesh Patel', '9811100003', '', 'CG Road, Ahmedabad 380009', 'Ahmedabad', '380009', 'Retailer', 'Exhibition', ''], 'SALES', 'New', 1), lead(4, ['Sunrise Wellness Mart', 'Komal Joshi', '9811100004', 'komal@sunrise.demo', 'Ring Road, Rajkot 360001', 'Rajkot', '360001', 'Wholesaler', 'Cold call', 'Negotiating margin on WHEYMILL'], 'SALES', 'Negotiation', 4), lead(5, ['FitZone Rajkot', 'Hardik Vyas', '9811100005', '', 'Kalawad Road, Rajkot 360005', 'Rajkot', '360005', 'Gym', 'Cold call', ''], 'SALES', 'Lost', 14), lead(6, ['Delhi Muscle Mart', 'Sandeep Arora', '9811100006', 'sandeep@dmm.demo', 'Karol Bagh, New Delhi 110005', 'Delhi', '110005', 'Retailer', 'Referral', 'Interested in pre-workouts'], 'SALES2', 'New', 2), lead(7, ['Capital Nutrition Hub', 'Meera Khanna', '9811100007', 'meera@capital.demo', 'Saket, New Delhi 110017', 'Delhi', '110017', 'Gym', 'Exhibition', 'Asked for gym-chain pricing'], 'SALES2', 'Interested', 5)])); set('crmseq', 12);
      /* visits logged by the consultants */
      var V = [['FIELD01', 'FDEMO1', 1, 'Stock check and new product introduction', 'Reordered BOLT whey, 4 units', 'Send the ved price list'], ['FIELD01', 'FDEMO4', 2, 'Payment follow-up', 'Promised payment on Friday', 'Call on Friday'], ['FIELD01', 'FDEMO1', 5, 'Display and shelf check', 'Gave 2 posters', 'Visit again in 2 weeks'], ['FIELD01', 'FDEMO4', 9, 'Handed the Sales team the order form', 'Order placed the same day', ''], ['FIELD02', 'FDEMO2', 1, 'Gym trainers demo of EL01NE', 'Trainers liked the pre-workout', 'Quote for 20 units'], ['FIELD02', 'FDEMO2', 4, 'Order follow-up', 'Waiting for payment approval', 'Call tomorrow'], ['FIELD02', 'FDEMO2', 8, 'First introduction visit', 'Wants gym-chain pricing', 'Share the price list'], ['FIELD03', 'FDEMO3', 2, 'Delivery check', 'Delivered correctly', ''], ['FIELD03', 'FDEMO3', 6, 'Pureluxe bar tasting at the counter', 'Ordered 4 boxes', 'Try the new flavours'], ['FIELD04', 'FDEMO5', 2, 'Gym trainers demo in Salt Lake', 'Ordered BOLT and ved', 'Collect the payment']];
      set('visits', V.map(function (v, k) { var e = emps.filter(function (x) { return x.id === v[0]; })[0], d = dl.filter(function (x) { return x.code === v[1]; })[0]; return { id: 'VIS-demo-' + k, emp: v[0], empName: e.name, dealer: v[1], dealerName: d.name, city: d.city, zone: e.zone, purpose: v[3], notes: '', outcome: v[4], nextStep: v[5], at: now - v[2] * 24 * HR - k * 36e5 }; }));
      set('ops10', 1);
    } finally { inOps10 = false; }
  }
  function ensureOps9() {   /* an order cannot be in transit without its invoice (and e-way bill): earlier ones marked dispatched without them go back to Ready to be picked up */
    if (inOps9 || get('ops9', 0) >= 1 || get('ops8', 0) < 1) return; inOps9 = true;
    try { get('dealers', []).forEach(function (dl) { var l = get('orders.' + dl.code, []), ch = false; l.forEach(function (o) { if (o.status === 'Delivered' || o.cancelled || !o.payment || !o.totals) return; var disp = ['Dispatched', 'Out for delivery'].indexOf(o.status) > -1 || !!o.whDispatch, dp = disp ? DB.docsPending(o) : ''; if (!dp) return; delete o.whDispatch; var pk = o.packing || { items: [] }; pk.state = 'Packed'; o.packing = pk; if (o.status === 'Dispatched' || o.status === 'Out for delivery') o.status = 'Processing'; o.history = o.history || []; o.history.push({ status: 'Moved back to Ready to be picked up: ' + dp + ' (an order cannot be dispatched without them)', at: new Date().toISOString() }); ch = true; }); if (ch) set('orders.' + dl.code, l); }); set('ops9', 1); } finally { inOps9 = false; }
  }
  function ensureOps8() {   /* orders that already had their invoice before this rule are treated as pushed */
    if (inOps8 || get('ops8', 0) >= OPS8 || get('ops7', 0) < 1) return; inOps8 = true;
    try { get('dealers', []).forEach(function (dl) { var l = get('orders.' + dl.code, []), ch = false; l.forEach(function (o) { if (o.confirmed && o.invoiceFile && (!DB.needsEway(o) || o.ewayFile) && !o.whPush) { o.whPush = { by: 'SYSTEM (before this rule)', at: (o.invoice && o.invoice.date) || o.date }; ch = true; } }); if (ch) set('orders.' + dl.code, l); }); set('ops8', OPS8); } finally { inOps8 = false; }
  }


  /* =========================== v19: suspend or transfer, dealer on/off, news and events, incentive basis =========================== */
  var _le2 = DB.listEmployees; DB.listEmployees = function (dept) { return _le2(dept).filter(function (e) { return e.status !== 'suspended'; }); };
  function proofOk(p) { if (!p || !p.data) return ''; if (!/^data:(image\/png|image\/jpeg|application\/pdf)/.test(p.data)) return 'The proof must be a PNG, JPEG or PDF file.'; if (!sniffOk(p.data)) return 'The proof file content does not match a PNG, JPEG or PDF.'; if ((p.size || 0) > 1300000) return 'The proof file is too large for this demo (limit about 1.3 MB).'; return ''; }
  function handOver(id, tgt, list) {
    var ds = get('dealers', []), mine = ds.filter(function (d) { return d.salesEmp === id; }); if (!mine.length) return { n: 0, apply: function () {}, to: '' };
    if (!tgt) return { error: 'This employee is the Sales employee for ' + mine.length + ' dealer(s). Choose who takes them over, or "Leave unassigned".', dealers: mine.length };
    if (tgt !== '-') { var te = list.filter(function (x) { return x.id === tgt && x.dept === 'sales' && x.status === 'active'; })[0]; if (!te || tgt === id) return { error: 'Choose an active Sales employee to take over the dealers.' }; }
    return { n: mine.length, to: tgt === '-' ? 'Unassigned' : tgt, apply: function () { ds.forEach(function (d) { if (d.salesEmp === id) d.salesEmp = tgt === '-' ? '' : tgt; }); set('dealers', ds); } };
  }
  /* the Host suspends someone: reason required, proof optional; the record, reason and proof appear under Team > Ex-employees */
  DB.suspendEmployee = function (id, info, by, role) {
    if (!isHRrole(role)) return { error: 'Only the Host or HR can suspend an employee.' }; var list = get('employees', []), e = list.filter(function (x) { return x.id === id; })[0]; if (!e) return { error: 'Employee not found.' }; if (e.dept === 'host' || e.id === 'ADMIN') return { error: 'The Host account cannot be suspended.' }; if (e.status !== 'active') return { error: 'This employee is not active.' };
    var reason = String(info.reason || '').trim(); if (reason.length < 5) return { error: 'Enter the reason for the suspension (at least 5 characters).' }; var pe = proofOk(info.proof); if (pe) return { error: pe };
    var ho = handOver(id, info.reassignTo || '', list); if (ho.error) return ho; ho.apply();
    var att = get('att', {}), sl = att[id]; if (sl && sl.length && !sl[sl.length - 1].out) { sl[sl.length - 1].out = new Date().toISOString(); sl[sl.length - 1].src = (sl[sl.length - 1].src || '') + ' (suspended)'; set('att', att); }
    e.status = 'suspended'; e.suspendedOn = tod(); set('employees', list);
    var ex = get('exemps', []).filter(function (x) { return x.id !== id; }); ex.push({ id: e.id, source: 'employee', kind: 'suspended', name: e.name, dept: e.dept, designation: e.designation || '', email: e.email || '', mobile: e.mobile || '', joinedOn: e.createdAt ? new Date(e.createdAt).toISOString().slice(0, 10) : tod(), leftOn: tod(), reason: reason, notes: String(info.notes || '').trim(), lastSalary: DB.salaryOf(id), proof: info.proof && info.proof.data ? { name: info.proof.name, size: info.proof.size, data: info.proof.data } : null, reassignedDealers: ho.n ? { count: ho.n, to: ho.to } : null, by: by, at: Date.now() }); set('exemps', ex);
    DB.notifyAction(by, 'Employee suspended', e.name + ' (' + e.id + '): ' + reason, 'security'); return { ok: true, dealers: ho.n };
  };
  /* an internal transfer moves the person to another department; they show up in that department's team and sign in there next time */
  DB.transferEmployee = function (id, info, by, role) {
    if (!isHRrole(role)) return { error: 'Only the Host or HR can transfer an employee.' }; var list = get('employees', []), e = list.filter(function (x) { return x.id === id; })[0]; if (!e) return { error: 'Employee not found.' }; if (e.dept === 'host' || e.id === 'ADMIN') return { error: 'The Host account cannot be transferred.' }; if (e.status !== 'active') return { error: 'Only an active employee can be transferred.' };
    var to = info.toDept; if (!DB.DEPTS[to] || to === 'host') return { error: 'Choose the department to transfer to.' }; if (to === e.dept) return { error: 'The employee is already in this department.' }; var reason = String(info.reason || '').trim(); if (reason.length < 3) return { error: 'Enter the reason for the transfer.' };
    var ho = handOver(id, info.reassignTo || '', list); if (ho.error) return ho; ho.apply();
    var from = e.dept; e.dept = to; e.transfers = (e.transfers || []).concat([{ from: from, to: to, reason: reason, by: by, on: tod(), at: Date.now() }]); if (info.designation) e.designation = String(info.designation).trim().slice(0, 60); set('employees', list);
    DB.notifyAction(by, 'Employee transferred', e.name + ' (' + e.id + '): ' + (DB.DEPTS[from] || from) + ' to ' + DB.DEPTS[to] + '. ' + reason, 'security'); return { ok: true, from: from, to: to, dealers: ho.n };
  };
  var _re3 = DB.reinstateEmployee; DB.reinstateEmployee = function (id, by, role) { var r = _re3(id, by, role); if (r && r.ok) { var list = get('employees', []); list.forEach(function (e) { if (e.id === id) delete e.suspendedOn; }); set('employees', list); } return r; };
  /* ---- dealer on / off ---- */
  DB.setDealerActive = function (code, active, reason, by, role) {
    var l = get('dealers', []), d = l.filter(function (x) { return x.code === String(code || '').trim().toUpperCase(); })[0]; if (!d) return { error: 'Dealer not found.' };
    if (!(role === 'admin' || (role === 'employee' && d.salesEmp === by))) return { error: 'Only the Host or the dealer\u2019s own Sales employee can activate or deactivate a dealer.' };
    reason = String(reason || '').trim(); if (!active && reason.length < 3) return { error: 'Enter the reason for deactivating this dealer.' };
    d.active = !!active; d.statusBy = by; d.statusAt = Date.now(); d.statusReason = active ? '' : reason; d.statusLog = (d.statusLog || []).concat([{ on: !!active, by: by, at: Date.now(), reason: reason }]).slice(-20); set('dealers', l);
    DB.notifyAction(by, active ? 'Dealer activated' : 'Dealer deactivated', d.name + ' (' + d.code + ')' + (active ? '' : ': ' + reason), 'security'); return { ok: true };
  };
  DB.dealerLoginStatus = function (code, pw) { var c = String(code || '').trim().toUpperCase(), f = null; get('dealers', []).forEach(function (d) { if (d.code === c && pw && d.password === pw) f = d; }); return !f ? 'invalid' : (f.active === false ? 'inactive' : 'ok'); };
  var _vd2 = DB.verifyDealer; DB.verifyDealer = function (c, pw) { var d = _vd2(c, pw); return d && d.active === false ? null : d; };
  DB.isDealerActive = function (code) { var d = DB.getDealer(code); return !d || d.active !== false; };
  var _sd4 = DB.saveDealer; DB.saveDealer = function (d) { var old = DB.getDealer(d.code); if (old) ['active', 'statusBy', 'statusAt', 'statusReason', 'statusLog', 'pwChangedAt', 'pwChangedBy'].forEach(function (k) { if (d[k] === undefined && old[k] !== undefined) d[k] = old[k]; }); return _sd4.apply(DB, arguments); };
  /* ---- latest news and upcoming events for employees (posted by Branding or IT) ---- */
  DB.listNews = function () { ensureSeed(); return get('news', []).slice().sort(function (a, b) { return b.at - a.at; }); };
  DB.addNews = function (n, by, role) {
    if (['branding', 'it', 'admin'].indexOf(role) < 0) return { error: 'Only Branding, IT or the Host can post news and events.' };
    var kind = n.kind === 'event' ? 'event' : 'news', title = String(n.title || '').trim(), text = String(n.text || '').trim(); if (title.length < 3 || title.length > 100) return { error: 'Enter a title (3 to 100 characters).' }; if (text.length > 800) return { error: 'Keep the details within 800 characters.' };
    if (kind === 'event') { if (!/^\d{4}-\d{2}-\d{2}$/.test(n.date || '')) return { error: 'Choose the event date.' }; if (n.date < tod()) return { error: 'An event date cannot be in the past.' }; }
    var img = null; if (n.image && n.image.data) { if (!/^data:image\/(png|jpeg)/.test(n.image.data) || !sniffOk(n.image.data)) return { error: 'The picture must be a PNG or JPEG file.' }; if ((n.image.size || 0) > 700000) return { error: 'The picture is too large (limit about 700 KB).' }; img = { name: n.image.name, size: n.image.size, data: n.image.data }; }
    var l = get('news', []), x = { id: 'N' + Date.now().toString(36) + l.length, kind: kind, title: title, text: text, date: kind === 'event' ? n.date : '', time: String(n.time || '').slice(0, 12), place: String(n.place || '').slice(0, 80), image: img, by: by, role: role, at: Date.now() }; l.unshift(x); set('news', l.slice(0, 200));
    DB.addStaffNotif({ key: 'news:' + x.id, kind: 'news', audience: ['admin', 'employee', 'logistics', 'warehouse', 'finance', 'branding', 'it'], title: (kind === 'event' ? 'Upcoming event: ' : 'News: ') + title, text: text.slice(0, 120), count: 1, at: Date.now() }); DB.notifyAction(by, kind === 'event' ? 'Event posted' : 'News posted', title, 'post'); return { ok: true, item: x };
  };
  DB.deleteNews = function (id, by, role) { var l = get('news', []), x = l.filter(function (y) { return y.id === id; })[0]; if (!x) return { error: 'Not found.' }; if (!(role === 'admin' || x.by === by)) return { error: 'Only the person who posted it, or the Host, can delete this.' }; set('news', l.filter(function (y) { return y.id !== id; })); return { ok: true }; };
  /* ---- incentives: one percentage per brand, worked out on the amount received including GST ---- */
  var _ip3 = DB.incPolicy; DB.incPolicy = function () { var p = _ip3(); p.mode = 'brand'; p.basis = 'Amount received including GST, net of returns. Paid per brand when that brand target is met.'; return p; };


  /* =========================== v20: attendance follows the portal tab (sign-in = in, logout = out, tab closed = out, computer off = out at the last beat) =========================== */
  var _lo20 = DB.portalLogout; DB.portalLogout = function (code) { var r = _lo20.apply(DB, arguments); try { var a = get('att', {}), l = a[code] || [], last = l[l.length - 1]; if (last && last.out) { last.logout = true; set('att', a); } } catch (e) {} return r; };
  /* the tab is closing: sign out at once. If it was only a reload, portalResume() puts the session back. */
  DB.portalClosing = function (code) { var e = DB.getEmployee(code); if (!e || e.dept === 'host') return; var a = get('att', {}), l = a[code] || [], last = l[l.length - 1]; if (!last || last.out || last.hr) return; var now = Date.now(); last.out = new Date(Math.max(now, new Date(last.in).getTime() + 1000)).toISOString(); last.closing = now; last.src = (last.src || 'portal') + ' (tab closed)'; set('att', a); };
  DB.portalResume = function (code) { var a = get('att', {}), l = a[code] || [], last = l[l.length - 1]; if (last && last.out && last.closing && Date.now() - last.closing < 30000) { delete last.out; delete last.closing; last.src = String(last.src || 'portal').replace(' (tab closed)', ''); last.seen = new Date().toISOString(); set('att', a); return true; } return false; };
  /* the heartbeat also starts a new session when the computer was off or asleep and the tab is still signed in (the gap is not counted) */
  var _ps20 = DB.portalSeen; DB.portalSeen = function (code) {
    var e = DB.getEmployee(code); if (!e || e.dept === 'host') return; var a = get('att', {}), l = a[code] || (a[code] = []), last = l[l.length - 1];
    if (last && !last.out) { last.seen = new Date().toISOString(); set('att', a); return; }
    if (last && last.out && !last.logout && !last.hr && String(new Date(last.out).toDateString()) === new Date().toDateString() && !last.closing) { l.push({ in: new Date().toISOString(), out: null, src: 'portal (back after the computer was off)', seen: new Date().toISOString() }); set('att', a); }
  };

  DB.resetDemo = function () {
    try { Object.keys(LS).forEach(function (k) { if (k.indexOf('sel.v2.') === 0) LS.removeItem(k); }); } catch (e) {}
    mem = {}; ensureSeed();
  };
  /* =========================== v25: CRM (Sales) and Field Sales Consultants =========================== */
  DB.DEPTS.fieldsales = 'Field Sales Consultants'; ROLE_OF.fieldsales = 'employee';   /* a field consultant works with the same order tools as Sales; what differs is enforced by department below */
  DB.CRM_STATUS = ['New', 'Contacted', 'Interested', 'Negotiation', 'Ready to onboard', 'Converted', 'Lost'];
  function empRaw(id) { id = String(id || '').trim().toUpperCase(); var l = get('employees', []); for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i]; return null; }   /* reads the stored employees directly: safe to use while the data is being seeded */
  function deptOfBy(by) { var e = empRaw(by); return e ? e.dept : ''; }
  function r2n(n) { return Math.round(n * 100) / 100; }
  function genPassword() { var U = 'ABCDEFGHJKLMNPQRSTUVWXYZ', Lc = 'abcdefghijkmnpqrstuvwxyz', N = '23456789', all = U + Lc + N, out = [U, Lc, N].map(function (s) { return s.charAt(Math.floor(Math.random() * s.length)); }); while (out.length < 12) out.push(all.charAt(Math.floor(Math.random() * all.length))); for (var i = out.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)), t = out[i]; out[i] = out[j]; out[j] = t; } return out.join(''); }
  /* ---------------- CRM: leads and dealer data kept by the Sales team ---------------- */
  function crmSees(r, by) { var me = empRaw(by); if (!me) return false; if (me.dept === 'host') return true; if (r.owner === by) return true; if (me.dept === 'sales') { var o = empRaw(r.owner); return !!(o && o.dept === 'fieldsales' && o.manager === by); } return false; }   /* the owner; the senior of a consultant; the Host */
  DB.listCrm = function (by, role) { ensureSeed(); return get('crm', []).filter(function (r) { return crmSees(r, by); }); };
  DB.getCrm = function (id, by, role) { var r = get('crm', []).filter(function (x) { return x.id === id; })[0] || null; return r && crmSees(r, by) ? r : null; };
  DB.saveCrm = function (rec, by, role) {
    ensureSeed(); var me = DB.getEmployee(by); if (!me) return { error: 'Please sign in again.' }; if (me.dept !== 'sales' && me.dept !== 'host' && me.dept !== 'fieldsales') return { error: 'The CRM is for the Sales team and the Field Sales Consultants.' }; if (me.dept === 'fieldsales' && rec.id) return { error: 'A Field Sales Consultant cannot change a lead once it is saved. You can add notes.' };
    var name = String(rec.name || '').trim(), phone = String(rec.phone || '').replace(/\D/g, ''), gst = String(rec.gst || '').toUpperCase().replace(/\s/g, ''), email = String(rec.email || '').trim(), pin = String(rec.pincode || '').replace(/\D/g, '');
    if (name.length < 2) return { error: 'Enter the business or person name.' }; if (phone.length !== 10) return { error: 'Enter a 10-digit mobile number.' };
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) return { error: 'The email address does not look right.' };
    if (gst && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gst)) return { error: 'The GST number does not look right (15 characters, for example 24ABCDE1234F1Z5), or leave it empty.' };
    if (pin && pin.length !== 6) return { error: 'The pincode has 6 digits.' }; if (gst && pin.length === 6) { var gp = DB.gstProfile({ gst: gst, pincode: pin, address: String(rec.address || '') }); if (gp && !gp.ok) return { error: gp.msg }; }   /* the same GST and pincode check as Add dealer, so a lead that cannot become a dealer is caught now */ if (rec.category && DB.CATS.indexOf(rec.category) < 0) return { error: 'Choose a valid dealer category.' };
    var l = get('crm', []), old = rec.id ? l.filter(function (x) { return x.id === rec.id; })[0] : null; if (rec.id && !old) return { error: 'That CRM record was not found.' };
    if (old && me.dept !== 'host' && old.owner !== by) return { error: 'You can change only your own CRM records.' }; if (old && old.status === 'Converted') return { error: 'This lead is already a dealer. Its details now live in the dealer profile.' };
    var dup = l.filter(function (x) { return (!old || x.id !== old.id) && ((x.phone === phone) || (gst && x.gst === gst)); })[0]; if (dup) return { error: 'Already in the CRM as ' + dup.id + ' (' + dup.name + ', ' + (dup.ownerName || dup.owner) + ').' };
    var dd = get('dealers', []).filter(function (x) { return String(x.phone || '').replace(/\D/g, '') === phone || (gst && x.gst === gst); })[0]; if (dd) return { error: 'This is already a dealer: ' + dd.name + ' (' + dd.code + ').' };
    var now = Date.now(), seq = (get('crmseq', 0) || 0), st = rec.status && DB.CRM_STATUS.indexOf(rec.status) > -1 && rec.status !== 'Converted' ? rec.status : (old ? old.status : 'New');
    if (st === 'Lost' && !(old && old.status === 'Lost') && String(rec.lostReason || '').trim().length < 5) return { error: 'Say briefly why this lead was lost (at least 5 characters).' };
    var out = { id: old ? old.id : 'CRM-' + ('0000' + (seq + 1)).slice(-4), name: name, person: String(rec.person || '').trim(), phone: phone, email: email, gst: gst, address: String(rec.address || '').trim(), city: String(rec.city || '').trim(), pincode: pin, category: rec.category || '', source: String(rec.source || '').trim().slice(0, 60), notes: String(rec.notes || '').trim().slice(0, 1000), status: st, lostReason: st === 'Lost' ? String(rec.lostReason || (old && old.lostReason) || '').trim() : '', owner: old ? old.owner : by, ownerName: old ? old.ownerName : me.name, createdAt: old ? old.createdAt : now, updatedAt: now, history: (old ? old.history : []) || [] };
    out.history.push({ at: now, by: by, text: old ? 'Updated' + (old.status !== st ? ' (status: ' + st + ')' : '') : 'Created' });
    if (old) l[l.indexOf(old)] = out; else { l.unshift(out); set('crmseq', seq + 1); } set('crm', l); return { ok: true, rec: out };
  };
  DB.crmNote = function (id, text, by, role) { var r = DB.getCrm(id, by, role); if (!r) return { error: 'That CRM record was not found.' }; text = String(text || '').trim(); if (text.length < 2) return { error: 'Write the note.' }; var l = get('crm', []); l.forEach(function (x) { if (x.id === id) { x.history.push({ at: Date.now(), by: by, text: text.slice(0, 500) }); x.updatedAt = Date.now(); } }); set('crm', l); return { ok: true }; };
  DB.deleteCrm = function (id, by, role) { if (deptOfBy(by) === 'fieldsales') return { error: 'A Field Sales Consultant cannot delete a lead.' }; var r = DB.getCrm(id, by, role); if (!r) return { error: 'That CRM record was not found.' }; if (r.status === 'Converted') return { error: 'A converted lead cannot be deleted: it is a dealer now.' }; set('crm', get('crm', []).filter(function (x) { return x.id !== id; })); return { ok: true }; };
  /* a CRM lead becomes a real dealer (the same rules as Add dealer). The login password is generated once and shown once. */
  DB.suggestDealerCode = function (name) { var base = String(name || 'DLR').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) || 'DLR', c = base, i = 1; while (DB.getDealer(c) || c.length < 3) { c = base + (++i); } return c; };
  DB.crmToDealer = function (id, d, by, role) {
    var r = DB.getCrm(id, by, role); if (!r) return { error: 'That CRM record was not found.' }; if (deptOfBy(by) !== 'host' && r.owner !== by) return { error: 'Only the person who owns this lead can turn it into a dealer.' }; if (r.status === 'Converted' && r.dealerCode) return { ok: true, existing: true, dealerCode: r.dealerCode };
    d = d || {}; var code = String(d.code || DB.suggestDealerCode(r.name)).trim().toUpperCase(); if (!/^[A-Z0-9\-]{3,20}$/.test(code)) return { error: 'Dealer code: 3 to 20 letters/numbers.' }; if (DB.getDealer(code)) return { error: 'The dealer code ' + code + ' is already used. Choose another.' };
    var dealer = { code: code, password: genPassword(), name: String(d.name || r.name).trim(), person: String(d.person || r.person).trim(), city: String(d.city || r.city).trim(), phone: String(d.phone || r.phone).replace(/\D/g, ''), gst: String(d.gst === undefined ? r.gst : d.gst).trim(), address: String(d.address || r.address).trim(), pincode: String(d.pincode || r.pincode || '').replace(/\D/g, ''), category: d.category || r.category, freightApply: true, freightFixed: '', prices: {}, brandPct: {}, createdBy: by };
    if (!dealer.name || !dealer.person || !dealer.city) return { error: 'Business name, contact person and city are required.' }; if (dealer.phone.length !== 10) return { error: 'Enter a 10-digit phone number.' }; if (dealer.address.length < 10) return { error: 'Enter the full delivery address.' };
    var sv = DB.saveDealerAs(dealer, by, role); if (sv && sv.error) return sv;
    var dl0 = get('dealers', []); dl0.forEach(function (x) { if (x.code === code) x.pricesPending = true; }); set('dealers', dl0);   /* no purchase prices yet: orders are blocked until they are added (Dealers > Edit dealer) */
    var l = get('crm', []); l.forEach(function (x) { if (x.id === id) { x.status = 'Converted'; x.dealerCode = code; x.convertedAt = Date.now(); x.updatedAt = Date.now(); x.history.push({ at: Date.now(), by: by, text: 'Dealer ' + code + ' created from this lead' }); } }); set('crm', l);
    return { ok: true, dealerCode: code, password: dealer.password };
  };
  /* ---------------- Field Sales Consultants ---------------- */
  var _se25 = DB.saveEmployee;
  DB.saveEmployee = function (e) {
    var isF = String(e.dept || '') === 'fieldsales', old = DB.getEmployee(String(e.id || '').trim().toUpperCase());
    if (isF) {
      var zone = String(e.zone || (old && old.zone) || ''), city = String(e.city || (old && old.city) || '').trim(), state = String(e.state || (old && old.state) || '').trim(), mgr = String(e.manager || (old && old.manager) || '').trim().toUpperCase(), m = DB.getEmployee(mgr);
      if (DB.ZONES.indexOf(zone) < 0) return { error: 'Choose the zone this consultant works in (North, South, East or West).' };
      if (DB.ZSTATES[zone].indexOf(state) < 0) return { error: 'Choose the state this consultant works in (a state of the ' + zone + ' zone). The consultant can create dealers only in this state.' };
      if (city.length < 2) return { error: 'Enter the city this consultant works in.' };
      if (!m || m.dept !== 'sales' || m.status !== 'active') return { error: 'Choose the Sales executive this consultant is allocated to: that person is the consultant\u2019s senior.' };
      if (m.zone && m.zone !== zone) return { error: 'The Sales executive ' + m.name + ' works in the ' + m.zone + ' zone. Choose a Sales executive of the ' + zone + ' zone, or change the zone.' };
    } else if (old && old.dept === 'fieldsales') return { error: 'A Field Sales Consultant cannot be moved to another department.' };
    var rec = _se25(e); if (rec && rec.error) return rec;
    if (isF) { var l = get('employees', []); l.forEach(function (x) { if (x.id === rec.id) { x.zone = String(e.zone || (old && old.zone)); x.state = String(e.state || (old && old.state)).trim(); x.city = String(e.city || (old && old.city)).trim(); x.manager = String(e.manager || (old && old.manager)).trim().toUpperCase(); x.fieldBrands = (old && old.fieldBrands) || {}; rec = x; } }); set('employees', l); }
    return rec;
  };
  DB.listFieldExecs = function () { return DB.listEmployees('fieldsales'); };
  DB.fieldBrandsOf = function (id) { var e = DB.getEmployee(id); return (e && e.fieldBrands) || {}; };
  DB.fieldActiveBrands = function (id) { var fb = DB.fieldBrandsOf(id); return Object.keys(fb).filter(function (k) { return fb[k] && fb[k].on; }); };
  /* the allocated Sales person (or the Host) switches a brand on or off for a consultant and sets the commission for it */
  function normC(c) { return (c && !c.mode && c.pct > 0) ? Object.assign({}, c, { mode: 'percent' }) : c; }   /* commission set before modes existed is a percentage */
  function commissionOk(c) {
    c = normC(c); if (!c || ['percent', 'amount', 'slab'].indexOf(c.mode) < 0) return false;
    if (c.mode === 'percent') return c.pct > 0 && c.pct <= 30; if (c.mode === 'amount') return c.amount > 0 && c.amount <= 1000000;
    if (!Array.isArray(c.slabs) || !c.slabs.length || c.slabs.length > 8) return false; var prev = -1; for (var i = 0; i < c.slabs.length; i++) { var s = c.slabs[i]; if (!(s.from >= 0) || s.from < prev || (s.to != null && s.to !== '' && !(s.to > s.from)) || ['percent', 'amount'].indexOf(s.type) < 0 || !(s.value > 0) || (s.type === 'percent' && s.value > 30)) return false; prev = s.to != null && s.to !== '' ? s.to : 1e15; } return true;
  }
  DB.commissionLabel = function (c) { c = normC(c); if (!c || !commissionOk(c)) return 'not set'; if (c.mode === 'percent') return c.pct + '%'; if (c.mode === 'amount') return '\u20B9' + c.amount + ' per order'; return 'by order size'; };
  /* what one order earns: a percentage of the brand's value, a fixed amount, or the slab the order size falls in */
  DB.commissionAmount = function (c, base) { c = normC(c); if (!commissionOk(c)) return 0; if (c.mode === 'percent') return r2n(base * c.pct / 100); if (c.mode === 'amount') return r2n(c.amount); for (var i = 0; i < c.slabs.length; i++) { var s = c.slabs[i]; if (base >= s.from && (s.to == null || s.to === '' || base < s.to)) return r2n(s.type === 'percent' ? base * s.value / 100 : s.value); } return 0; };
  /* only the Host sets the commission (mode and values); it never changes commission already earned */
  DB.setFieldCommission = function (execId, brand, cfg, by, role) {
    var x = DB.getEmployee(execId); if (!x || x.dept !== 'fieldsales') return { error: 'Field sales consultant not found.' }; if (deptOfBy(by) !== 'host') return { error: 'Only the Host sets the commission.' }; if (!SEL.brandById(brand)) return { error: 'Unknown brand.' };
    var c = { mode: cfg && cfg.mode, pct: parseFloat(cfg && cfg.pct), amount: parseFloat(cfg && cfg.amount), slabs: ((cfg && cfg.slabs) || []).map(function (s) { return { from: parseFloat(s.from), to: (s.to === '' || s.to == null) ? null : parseFloat(s.to), type: s.type, value: parseFloat(s.value) }; }) };
    if (!commissionOk(c)) return { error: c.mode === 'slab' ? 'Check the order-size slabs: each needs a start, a larger end (the last may be open), a type and a value above 0 (percentages up to 30), in increasing order.' : c.mode === 'amount' ? 'Enter a fixed amount per order above 0.' : 'Enter a percentage above 0 and up to 30.' };
    var l = get('employees', []); l.forEach(function (e) { if (e.id === x.id) { e.fieldBrands = e.fieldBrands || {}; var cur = e.fieldBrands[brand] || { on: false }; e.fieldBrands[brand] = { on: !!cur.on, mode: c.mode, pct: c.mode === 'percent' ? c.pct : 0, amount: c.mode === 'amount' ? c.amount : 0, slabs: c.mode === 'slab' ? c.slabs : [], by: by, at: Date.now() }; } }); set('employees', l); return { ok: true };
  };
  /* the senior (or the Host) switches a brand on or off; a brand can be switched on only once the Host has set its commission */
  DB.setFieldBrand = function (execId, brand, on, pct, by, role) {
    var x = DB.getEmployee(execId); if (!x || x.dept !== 'fieldsales') return { error: 'Field sales consultant not found.' }; var actor = DB.getEmployee(by), host = !!(actor && actor.dept === 'host');
    if (!host && !(actor && actor.dept === 'sales' && x.manager === by)) return { error: 'Only the Host or the Sales person this consultant is allocated to can change the brands.' };
    if (!SEL.brandById(brand)) return { error: 'Unknown brand.' };
    if (host && pct !== undefined && pct !== '' && pct !== null) { var rr = DB.setFieldCommission(execId, brand, { mode: 'percent', pct: pct }, by, role); if (rr.error) return rr; }
    var cur = ((DB.getEmployee(execId) || {}).fieldBrands || {})[brand] || { on: false }; if (on && !commissionOk(cur)) return { error: 'The Host has not set the commission for ' + SEL.brandById(brand).name + ' yet. Ask the Host to set it, then switch the brand on.' };
    var l = get('employees', []); l.forEach(function (e) { if (e.id === x.id) { e.fieldBrands = e.fieldBrands || {}; e.fieldBrands[brand] = Object.assign({}, cur, { on: !!on, by: by, at: Date.now() }); } }); set('employees', l);
    DB.addAlert({ key: 'fb:' + x.id + ':' + brand + ':' + Date.now(), to: { users: [x.id] }, kind: 'brand', title: SEL.brandById(brand).name + (on ? ' activated for you' : ' deactivated for you'), text: on ? 'Commission: ' + DB.commissionLabel(cur) + '. You can now sell it.' : SEL.brandById(brand).name + ' is no longer available to you.', actions: [{ id: 'open', label: 'OK' }], at: Date.now() });
    return { ok: true };
  };
  /* who works where: zone, then city; and which brands are live in which zone */
  DB.fieldOverview = function () {
    var ex = DB.listFieldExecs().filter(function (e) { return e.status === 'active'; }), zones = {}, matrix = {};
    ex.forEach(function (e) { var z = e.zone || 'Unassigned', c = e.city || '-'; zones[z] = zones[z] || {}; (zones[z][c] = zones[z][c] || []).push({ id: e.id, name: e.name, city: c, zone: z, manager: e.manager, managerName: (DB.getEmployee(e.manager) || {}).name || e.manager, brands: DB.fieldActiveBrands(e.id), mobile: e.mobile });
      DB.fieldActiveBrands(e.id).forEach(function (b) { matrix[z] = matrix[z] || {}; matrix[z][b] = (matrix[z][b] || 0) + 1; }); });
    return { zones: zones, matrix: matrix, total: ex.length };
  };
  /* ---- commission: the brand percentage set for the consultant, on the amount received including GST, for the brand's goods, net of returns ---- */
  function postFieldComm(o) {
    if (!o || !o.attr || !o.attr.emp || !o.payment || o.payment.status !== 'Paid') return; var x = empRaw(o.attr.emp); if (!x || x.dept !== 'fieldsales') return;
    var fb = x.fieldBrands || {}, rows = get('fcomm', []), have = {}; rows.forEach(function (r) { have[r.key] = 1; }); var tot = 0, by = {}; o.items.forEach(function (l) { var v = l.qty * l.price; tot += v; by[l.brand] = (by[l.brand] || 0) + v; });
    var disc = (o.totals && o.totals.couponDiscount) || 0, f = tot > 0 ? Math.max(0, 1 - disc / tot) : 0, at = o.payment.paidAt ? new Date(o.payment.paidAt).getTime() : Date.now(), n = 0;
    Object.keys(by).forEach(function (b) { var key = 'fc:' + o.id + ':' + b; if (have[key]) return; var cfg = fb[b]; if (!cfg || !cfg.on) return; var base = r2n(by[b] * f), amt = DB.commissionAmount(cfg, base); if (!(amt > 0)) return; rows.push({ key: key, emp: x.id, orderId: o.id, dealer: o.dealerCode || '', dealerName: o.dealerName || (o.buyer && o.buyer.name) || '', brand: b, base: base, mode: cfg.mode || 'percent', pct: base > 0 ? r2n(amt * 100 / base) : 0, rate: DB.commissionLabel(cfg), amount: amt, month: DB.ym(at), at: at }); n++; });
    if (n) set('fcomm', rows);
  }
  var _co25 = DB.creditOrder; DB.creditOrder = function (o) { var n = _co25(o); try { postFieldComm(o); } catch (e) {} return n; };
  DB.fieldCommission = function (emp, month) {
    ensureSeed(); var rows = get('fcomm', []).filter(function (r) { return (!emp || r.emp === emp) && (!month || r.month === month); }).map(function (r) { return Object.assign({ kind: 'COMMISSION' }, r); }), out = rows.slice();
    get('returns', []).forEach(function (rt) {   /* returned goods take their share of the commission back */
      if (['Accepted', 'Partially accepted'].indexOf(rt.status) < 0) return; var base = {}; (rt.lines || []).forEach(function (l) { var p = String(l.sku || '').split('|')[0], f = SEL.findProduct(p); if (f && l.acc > 0) base[f.brand] = (base[f.brand] || 0) + l.acc * l.unit; });
      Object.keys(base).forEach(function (b) { var orig = get('fcomm', []).filter(function (r) { return r.orderId === rt.orderId && r.brand === b && (!emp || r.emp === emp); })[0]; if (!orig || !(orig.base > 0)) return; var share = Math.min(1, base[b] / orig.base), last = (rt.history && rt.history.length ? rt.history[rt.history.length - 1].at : Date.now()), at = typeof last === 'number' ? last : Date.parse(last) || Date.now(), mth = DB.ym(at); if (month && mth !== month) return; out.push({ kind: 'RETURN', key: 'fr:' + rt.id + ':' + b, emp: orig.emp, orderId: rt.orderId, dealer: orig.dealer, dealerName: orig.dealerName, brand: b, base: -r2n(base[b]), mode: orig.mode, pct: orig.pct, rate: orig.rate, amount: -r2n(orig.amount * share), month: mth, at: at }); });
    });
    out.sort(function (a, b) { return b.at - a.at; }); return out;
  };
  DB.fieldCommissionSummary = function (emp, month) { var rows = DB.fieldCommission(emp, month), by = {}, tot = 0; rows.forEach(function (r) { var b = by[r.brand] = by[r.brand] || { base: 0, amount: 0, orders: {} }; b.base += r.base; b.amount += r.amount; b.orders[r.orderId] = 1; tot += r.amount; }); Object.keys(by).forEach(function (k) { by[k].base = r2n(by[k].base); by[k].amount = r2n(by[k].amount); by[k].orders = Object.keys(by[k].orders).length; }); return { rows: rows, byBrand: by, total: r2n(tot) }; };
  /* ---- what a consultant may sell, and who is told about what they do ---- */
  function tellManager(fieldId, key, title, text, extra) { var x = empRaw(fieldId); if (!x || x.dept !== 'fieldsales' || !x.manager) return; DB.addAlert(Object.assign({ key: key, to: { users: [x.manager] }, kind: 'field', title: title, text: text, actions: [{ id: 'open', label: 'Open' }], at: Date.now() }, extra || {})); }
  var _ao25 = DB.addOrder; DB.addOrder = function (code, order) {
    var dp = get('dealers', []).filter(function (x) { return x.code === code; })[0]; if (dp && dp.pricesPending) return { error: 'Purchase prices are not set for this dealer yet. Sales adds them in Dealers > Edit dealer, then orders can be placed.' };
    var cb = order && order.createdBy, e = cb && cb.role !== 'dealer' ? empRaw(cb.code) : null;
    if (e && e.dept === 'fieldsales') { var on = DB.fieldActiveBrands(e.id), bad = (order.items || []).filter(function (l) { return on.indexOf(l.brand) < 0; })[0]; if (bad) return { error: (SEL.brandById(bad.brand) || { name: bad.brand }).name + ' is not activated for you. Ask your Sales manager to activate it.' }; var d0 = DB.getDealer(code); if (d0 && d0.salesEmp !== e.id) return { error: 'You can place orders only for your own dealers.' }; }
    var res = _ao25.apply(DB, arguments); if (res && !res.error && e && e.dept === 'fieldsales') tellManager(e.id, 'fo:' + res.id, 'Field order ' + res.id, e.name + ' placed an order for ' + ((DB.getDealer(code) || {}).name || code) + ' (' + r2n((res.totals || {}).total || 0) + ').', { orderId: res.id, code: code }); return res;
  };
  var _sd25 = DB.saveDealerAs; DB.saveDealerAs = function (d, by, role) { var isNew = !DB.getDealer(String(d.code || '').trim().toUpperCase()), res = _sd25.apply(DB, arguments); if (res && res.ok && isNew && deptOfBy(by) === 'fieldsales') tellManager(by, 'fd:' + String(d.code).toUpperCase(), 'New dealer from the field', (DB.getEmployee(by) || {}).name + ' created the dealer ' + d.name + ' (' + String(d.code).toUpperCase() + '). Please add the purchase prices in Dealers > Edit dealer.', { code: String(d.code).toUpperCase() }); return res; };
  var _ap25 = DB.addProof; DB.addProof = function (code, id, p, by, role) { var res = _ap25.apply(DB, arguments); if (res && res.ok && deptOfBy(by) === 'fieldsales') tellManager(by, 'fp:' + id + ':' + Date.now(), 'Payment proof uploaded', (DB.getEmployee(by) || {}).name + ' uploaded a payment proof for ' + id + '.', { orderId: id, code: code }); return res; };
  var _cf25 = DB.confirmOrder; DB.confirmOrder = function (code, id, by) {
    var o0 = get('orders.' + code, []).filter(function (x) { return x.id === id; })[0], ae = o0 && o0.attr && o0.attr.emp ? empRaw(o0.attr.emp) : null, who = empRaw(by);
    if (ae && ae.dept === 'fieldsales' && !(who && (who.dept === 'host' || (who.dept === 'sales' && ae.manager === by)))) return { error: 'On-field orders are confirmed by the Sales executive this consultant is allocated to (or the Host).' };
    var res = _cf25.apply(DB, arguments); if (!(res && res.error) && deptOfBy(by) === 'fieldsales') tellManager(by, 'fc:' + id, 'Order pushed to Logistics and Finance', (DB.getEmployee(by) || {}).name + ' pushed ' + id + ' to Logistics and Finance.', { orderId: id, code: code }); return res; };



/* =========================== v26: Field Sales visits, RTO approval popup, zone for Sales, on-field order tagging =========================== */
  /* ---- Visits: a field sales consultant logs visits to dealers ---- */
  DB.addVisit = function (rec, by, role) {
    ensureSeed(); var me = empRaw(by); if (!me || me.dept !== 'fieldsales') return { error: 'Only a Field Sales Consultant can log a visit.' };
    var dealer = String(rec.dealer || '').trim().toUpperCase(), d = DB.getDealer(dealer); if (!d) return { error: 'Dealer not found.' }; if (d.salesEmp !== by) return { error: 'You can log visits only for your own dealers.' };
    var purpose = String(rec.purpose || '').trim(), notes = String(rec.notes || '').trim(); if (purpose.length < 3) return { error: 'Describe the purpose of the visit (at least 3 characters).' };
    var v = { id: 'VIS-' + Date.now() + '-' + by, emp: by, empName: me.name, dealer: dealer, dealerName: d.name, city: d.city || me.city || '', zone: me.zone || '', purpose: purpose, notes: notes, outcome: String(rec.outcome || '').trim(), nextStep: String(rec.nextStep || '').trim(), at: Date.now() };
    var l = get('visits', []); l.unshift(v); set('visits', l);
    tellManager(by, 'vis:' + v.id, 'Visit logged', me.name + ' visited ' + d.name + (purpose ? ': ' + purpose.slice(0, 60) : ''), { code: dealer });
    return { ok: true, visit: v };
  };
  DB.listVisits = function (by, role) { ensureSeed(); var l = get('visits', []); if (role === 'admin') return l.slice(); var me = empRaw(by); if (!me) return []; if (me.dept === 'fieldsales') return l.filter(function (v) { return v.emp === by; }); if (me.dept === 'sales') { var mine = {}; get('employees', []).forEach(function (e) { if (e.manager === by) mine[e.id] = 1; }); return l.filter(function (v) { return mine[v.emp]; }); } return []; };
  /* ---- RTO: when a return is requested and marked for RTO, the admin gets a popup with approve/reject ---- */
  DB.requestRTO = function (dealerCode, orderId, reason, by, role) {
    ensureSeed(); var o = DB.getOrder(dealerCode, orderId); if (!o) return { error: 'Order not found.' }; if (['Dispatched', 'Out for delivery'].indexOf(o.status) < 0) return { error: 'RTO can be requested only for dispatched or out-for-delivery orders.' };
    if (o.rto) return { error: 'An RTO request already exists for this order.' }; if (!reason || reason.trim().length < 5) return { error: 'Describe the reason for the RTO (at least 5 characters).' };
    patchOrder(dealerCode, orderId, function (x) { x.rto = { status: 'Pending', reason: reason.trim(), requestedBy: by, requestedAt: new Date().toISOString() }; x.history = x.history || []; x.history.push({ status: 'RTO requested: ' + reason.trim().slice(0, 100), at: new Date().toISOString() }); });
    DB.addStaffNotif({ key: 'rto:' + orderId, kind: 'rto', audience: ['admin'], title: 'RTO approval needed', text: orderId + ' (' + (o.dealerName || dealerCode) + '): ' + reason.trim().slice(0, 80), count: 1, at: Date.now(), popup: 'rto', orderId: orderId, dealerCode: dealerCode });
    return { ok: true };
  };
  DB.approveRTO = function (dealerCode, orderId, approved, note, by, role) {
    if (role !== 'admin') return { error: 'Only the Host can approve or reject an RTO.' }; var o = DB.getOrder(dealerCode, orderId); if (!o || !o.rto || o.rto.status !== 'Pending') return { error: 'No pending RTO found for this order.' };
    patchOrder(dealerCode, orderId, function (x) { x.rto.status = approved ? 'Approved' : 'Rejected'; x.rto.decidedBy = by; x.rto.decidedAt = new Date().toISOString(); x.rto.note = String(note || '').trim(); if (approved) { x.status = 'RTO'; } x.history = x.history || []; x.history.push({ status: 'RTO ' + (approved ? 'approved' : 'rejected') + (note ? ': ' + String(note).trim().slice(0, 100) : ''), at: new Date().toISOString() }); });
    DB.addStaffNotif({ key: 'rtod:' + orderId, kind: 'rto', audience: ['employee', 'logistics', 'finance'], title: 'RTO ' + (approved ? 'approved' : 'rejected') + ': ' + orderId, text: (o.dealerName || dealerCode) + (note ? ' — ' + note : ''), count: 1, at: Date.now() });
    return { ok: true };
  };
  /* ---- on-field order tagging: orders placed by field consultants are tagged for separate tracking ---- */
  DB.isFieldOrder = function (o) { return !!(o && o.attr && o.attr.emp && empRaw(o.attr.emp) && empRaw(o.attr.emp).dept === 'fieldsales'); };
  DB.fieldOrders = function (by, role) {
    var all = DB.allOrders(), me = empRaw(by); if (!me) return [];
    if (role === 'admin' || me.dept === 'logistics' || me.dept === 'finance') return all.filter(function (o) { return DB.isFieldOrder(o); });
    if (me.dept === 'sales') { var mine = {}; get('employees', []).forEach(function (e) { if (e.manager === by) mine[e.id] = 1; }); return all.filter(function (o) { return o.attr && o.attr.emp && mine[o.attr.emp]; }); }
    if (me.dept === 'fieldsales') return all.filter(function (o) { return o.attr && o.attr.emp === by; });
    return [];
  };
  /* ---- zone for Sales employees: admin allocates North/South/East/West ---- */
  var _se26 = DB.saveEmployee; DB.saveEmployee = function (e) {
    var oldDept = (DB.getEmployee(String(e.id || '').trim().toUpperCase()) || {}).dept;
    if (oldDept === 'sales' || String(e.dept) === 'sales') { var z = String(e.zone || (DB.getEmployee(String(e.id || '').trim().toUpperCase()) || {}).zone || ''); if (z && DB.ZONES.indexOf(z) < 0) return { error: 'Choose a valid zone.' }; }
    var res = _se26(e); if (res && !res.error && (String(e.dept) === 'sales') && e.zone) { var l = get('employees', []); l.forEach(function (x) { if (x.id === res.id) x.zone = e.zone; }); set('employees', l); }
    return res;
  };
  /* field sales cannot create dealers (only Sales exec or admin) */
  var _sdOrig27 = DB.saveDealerAs; DB.saveDealerAs = function (d, by, role) {
    var me = empRaw(by), code = String((d || {}).code || '').trim().toUpperCase(), old = get('dealers', []).filter(function (x) { return x.code === code; })[0];
    if (me && me.dept === 'fieldsales') {
      if (old) return { error: 'A Field Sales Consultant cannot change a dealer once it is created. Ask your Sales executive.' };
      var pin = /^\d{6}$/.test(String(d.pincode || '')) ? String(d.pincode) : (DB.pinFrom(d.address) || ''), st = pin ? DB.stateFromPin(pin) : null;
      if (!st || !st.name) return { error: 'Enter a valid 6-digit pincode. It decides the state, and you can create dealers only in your allocated state (' + (me.state || 'none set') + ').' };
      if (zk(st.name) !== zk(me.state)) return { error: 'This address is in ' + st.name + ', but you are allocated to ' + me.state + '. A dealer outside your state cannot be created.' };
      d.salesEmp = me.id; d.prices = {};   /* the purchase prices are set by the senior Sales executive, not by the consultant */
      var res = _sdOrig27.call(DB, d, by, role); if (res && res.ok) { var dl0 = get('dealers', []); dl0.forEach(function (x) { if (x.code === code) x.pricesPending = true; }); set('dealers', dl0); } return res;
    }
    if (me && me.dept === 'sales' && old && old.salesEmp !== by) {   /* the senior of a consultant looks after the consultant's dealers */
      var oe = empRaw(old.salesEmp); if (oe && oe.dept === 'fieldsales' && oe.manager === by) { d.salesEmp = old.salesEmp; d.brandPct = old.brandPct; d.freightApply = old.freightApply; d.freightFixed = old.freightFixed; return _sdOrig27.call(DB, d, by, 'admin'); }
    }
    return _sdOrig27.apply(DB, arguments);
  };

  /* ---- a Field Sales Consultant creates; they never change, cancel or delete (parameter lists are kept exactly: the server finds `by` and `role` by name) ---- */
  var NOFIELD = 'A Field Sales Consultant cannot change or cancel anything once it is created. Ask your Sales executive.';
  function fieldBlocked(by) { return deptOfBy(by) === 'fieldsales'; }
  var _eo27 = DB.editOrder; DB.editOrder = function (code, id, specs, by, role) { if (fieldBlocked(by)) return { error: NOFIELD }; return _eo27.apply(DB, arguments); };
  var _cd27 = DB.cancelDiff; DB.cancelDiff = function (code, id, by) { if (fieldBlocked(by)) return { error: NOFIELD }; return _cd27.apply(DB, arguments); };
  var _ad27 = DB.applyDiff; DB.applyDiff = function (code, id, by) { if (fieldBlocked(by)) return { error: NOFIELD }; return _ad27.apply(DB, arguments); };
  var _ep27 = DB.editPreorder; DB.editPreorder = function (id, specs, by) { if (fieldBlocked(by)) return { error: NOFIELD }; return _ep27.apply(DB, arguments); };
  var _cp27 = DB.cancelPreorder; DB.cancelPreorder = function (id, by) { if (fieldBlocked(by)) return { error: NOFIELD }; return _cp27.apply(DB, arguments); };
  var _cr27 = DB.cancelRevision; DB.cancelRevision = function (code, id, by) { if (fieldBlocked(by)) return { error: NOFIELD }; return _cr27.apply(DB, arguments); };
  var _rp27 = DB.resetDealerPassword; DB.resetDealerPassword = function (code, pw, by, role) { if (fieldBlocked(by)) return { error: NOFIELD }; return _rp27.apply(DB, arguments); };
  var _sa27 = DB.setDealerActive; DB.setDealerActive = function (code, active, reason, by, role) { if (fieldBlocked(by)) return { error: NOFIELD }; return _sa27.apply(DB, arguments); };
  var _ex27 = DB.editProof; DB.editProof = function (code, id, pid, f, by, role) { if (fieldBlocked(by)) return { error: NOFIELD }; return _ex27.apply(DB, arguments); };
  var _mp27 = DB.markPaid; DB.markPaid = function (code, id, info) { if (info && fieldBlocked(info.by)) return { error: 'Only Finance marks an order paid.' }; return _mp27.apply(DB, arguments); };
  /* an offer remembers who created it; a Field Sales Consultant sees the offers of their senior Sales executive (and the company's own) */
  var _so28 = DB.saveOffer; DB.saveOffer = function (o, by, role) { var old = get('offers', []).filter(function (x) { return x.id === o.id; })[0]; o.createdBy = (old && old.createdBy) || by || o.createdBy || ''; return _so28.call(DB, o); };
  DB.offersForConsultant = function (empId) { var e = empRaw(empId); if (!e) return []; var host = {}; get('employees', []).forEach(function (x) { if (x.dept === 'host') host[x.id] = 1; }); return get('offers', []).filter(function (o) { return !o.createdBy || o.createdBy === e.manager || host[o.createdBy]; }); };

  DB.editVisit = function (id, rec, by, role) {
    var me = empRaw(by); if (!me || me.dept !== 'fieldsales') return { error: 'Only a Field Sales Consultant logs and edits visits.' }; var l = get('visits', []), v = l.filter(function (x) { return x.id === id; })[0]; if (!v) return { error: 'Visit not found.' }; if (v.emp !== by) return { error: 'You can edit only your own visits.' };
    var purpose = String((rec || {}).purpose || '').trim(); if (purpose.length < 3) return { error: 'Describe the purpose of the visit (at least 3 characters).' };
    v.purpose = purpose; v.outcome = String(rec.outcome || '').trim(); v.nextStep = String(rec.nextStep || '').trim(); v.notes = String(rec.notes || '').trim(); v.editedAt = Date.now(); set('visits', l); return { ok: true, visit: v };
  };
  /* ---- consultants have no attendance and no allowances; HR screens leave them out ---- */
  var _pl28 = DB.portalLogin; DB.portalLogin = function (code) { if (deptOfBy(code) === 'fieldsales') return; return _pl28.apply(DB, arguments); };
  var _le28 = DB.listEmployees; DB.listEmployees = function (dept) { var l = _le28.apply(DB, arguments); return (DB.__noField && dept !== 'fieldsales') ? l.filter(function (e) { return e.dept !== 'fieldsales'; }) : l; };
  /* ---- a consultant's record can be changed by the Host only ---- */
  function isCons(id) { var e = empRaw(id); return !!(e && e.dept === 'fieldsales'); }
  var _su28 = DB.suspendEmployee; DB.suspendEmployee = function (id, info, by, role) { if (isCons(id) && deptOfBy(by) !== 'host') return { error: 'Only the Host can change a Field Sales Consultant.' }; return _su28.apply(DB, arguments); };
  var _tr28 = DB.transferEmployee; DB.transferEmployee = function (id, info, by, role) { if (isCons(id) && deptOfBy(by) !== 'host') return { error: 'Only the Host can change a Field Sales Consultant.' }; return _tr28.apply(DB, arguments); };
  var _ss28 = DB.setSalary; DB.setSalary = function (emp, amount, by, role) { if (isCons(emp)) return { error: 'A Field Sales Consultant has no salary here: they earn commission.' }; return _ss28.apply(DB, arguments); };
  /* ---- the Warehouse never sees what logistics costs ---- */
  var _mo28 = DB.maskOrderFor; DB.maskOrderFor = function (role, o) { var m = _mo28.apply(DB, arguments); if (role === 'warehouse' && m) { if (m.dispatchFrom) { m.dispatchFrom = Object.assign({}, m.dispatchFrom); delete m.dispatchFrom.cost; delete m.dispatchFrom.perKg; } if (m.shipment) { m.shipment = Object.assign({}, m.shipment); delete m.shipment.cost; delete m.shipment.charge; } } return m; };
  /* ---- an offer remembers who created it already (v27) ---- */

  /* =========================== v32: brands added by Admin / IT ===========================
     A brand (name, logo, website, products with packs/MRP/flavours/photo) is stored once ('cbrands') and merged into the same
     SEL.BRANDS / SEL.CATALOG the whole portal already reads, so its card and products appear for dealers, Sales, Finance,
     Logistics and Warehouse everywhere a brand appears. Stock for its packs is created (default 100 each). */
  var BR_SIG = '', BR_IDS = {}, BR_PIDS = {}, BR_BASE = null;
  /* Every brand (built in or added) is in SEL.ALL_BRANDS; SEL.BRANDS holds only the ENABLED ones, so a disabled brand disappears from every card, picker and
     list at once, while old orders still resolve it (brandById reads ALL_BRANDS). Built-in brands can have their name / logo / website / description edited ('bover'). */
  DB.applyBrands = function () {
    var l = get('cbrands', []), off = get('boff', {}), ov = get('bover', {}), sig = l.map(function (b) { return b.id + ':' + (b.v || 0); }).join(',') + '|' + Object.keys(off).sort().join(',') + '|' + Object.keys(ov).map(function (k) { return k + ':' + (ov[k].v || 0); }).join(','); if (sig === BR_SIG) return; BR_SIG = sig;
    var raw = SEL.RAW_CATALOG || SEL.CATALOG; if (!BR_BASE) BR_BASE = SEL.BRANDS.filter(function (b) { return !b.custom; }).map(function (b) { return Object.assign({}, b); });
    Object.keys(BR_IDS).forEach(function (k) { delete raw[k]; }); Object.keys(BR_PIDS).forEach(function (k) { delete SEL.IMG[k]; }); BR_IDS = {}; BR_PIDS = {};
    var all = BR_BASE.map(function (b) { var o = Object.assign({}, b), x = ov[b.id]; if (x) { if (x.name) { o.name = x.name; o.full = x.full || x.name; } if (x.url !== undefined) o.url = x.url; if (x.logo) o.logo = x.logo; if (x.desc !== undefined) o.desc = x.desc; o.edited = true; } return o; });
    l.forEach(function (b) { all.push({ id: b.id, name: b.name, full: b.full || b.name, url: b.url || '', logo: b.logo || '', desc: b.desc || '', custom: true }); BR_IDS[b.id] = 1; raw[b.id] = b.products || [];
      (b.products || []).forEach(function (p) { if (p.image) { SEL.IMG[p.id] = { src: p.image, bg: '#f3f6fb', abs: true }; BR_PIDS[p.id] = 1; } }); });
    all.forEach(function (b) { b.off = !!off[b.id]; }); SEL.ALL_BRANDS = all; SEL.BRANDS.length = 0; all.forEach(function (b) { if (!b.off) SEL.BRANDS.push(b); });
  };
  (function () {
    var _io = SEL.imgOf; SEL.imgOf = function (pid) { var m = SEL.IMG[pid]; return m && m.abs ? { src: m.src, bg: m.bg } : _io(pid); };
    var _fp = SEL.findProduct; SEL.findProduct = function () { DB.applyBrands(); return _fp.apply(SEL, arguments); };
    SEL.brandById = function (id) { DB.applyBrands(); var r = null; (SEL.ALL_BRANDS || SEL.BRANDS).forEach(function (b) { if (b.id === id) r = b; }); return r; };
    var _as = SEL.allSkus; SEL.allSkus = function () { DB.applyBrands(); return _as.apply(SEL, arguments); };
    var raw = SEL.RAW_CATALOG; SEL.CATALOG = new Proxy(raw, { get: function (t, k) { DB.applyBrands(); var l = t[k]; if (!Array.isArray(l) || SEL._showAll) return l; if (get('boff', {})[k]) return []; var m = get('inactive', {}); return l.filter(function (p) { return !m[p.id]; }); } });
    var _il = DB.inactiveLines; DB.inactiveLines = function (lines) { var base = _il.apply(DB, arguments), off = get('boff', {}); if (!Object.keys(off).length) return base; var extra = (lines || []).filter(function (l) { var f = SEL.findProduct(l.pid); return f && off[f.brand] && base.indexOf(l) < 0; }); return base.concat(extra); };
  })();
  DB.setBrandActive = function (id, active, by, role) {
    if (['admin', 'it'].indexOf(role) < 0) return { error: 'Only the Host and IT can enable or disable a brand.' }; DB.applyBrands(); var b = (SEL.ALL_BRANDS || []).filter(function (x) { return x.id === id; })[0]; if (!b) return { error: 'Brand not found.' };
    var off = get('boff', {}); if (active) delete off[id]; else off[id] = { at: Date.now(), by: by }; set('boff', off); DB.applyBrands();
    DB.addStaffNotif({ key: 'brandoff:' + id + ':' + Date.now(), kind: 'brand', audience: ['admin', 'employee', 'finance', 'logistics', 'warehouse', 'it', 'branding'], title: active ? 'Brand enabled' : 'Brand disabled', text: b.name + (active ? ' is available again.' : ' is hidden from dealers and teams. Existing orders are not affected.'), count: 1, at: Date.now() });
    DB.notifyAction(by, active ? 'Brand enabled' : 'Brand disabled', b.name, 'inventory'); return { ok: true };
  };
  /* edit the name / logo / website / description of a BUILT-IN brand (its catalogue stays as published) */
  DB.saveBrandInfo = function (id, info, by, role) {
    if (['admin', 'it'].indexOf(role) < 0) return { error: 'Only the Host and IT can edit a brand.' }; DB.applyBrands(); var b = (SEL.ALL_BRANDS || []).filter(function (x) { return x.id === id && !x.custom; })[0]; if (!b) return { error: 'Brand not found.' }; info = info || {};
    var name = String(info.name || '').trim(); if (name.length < 2 || name.length > 40) return { error: 'Enter the brand name (2 to 40 characters).' }; var url = String(info.url || '').trim(); if (url && !/^https:\/\/[^\s<>"']+$/i.test(url)) return { error: 'The website address must start with https://' };
    var logo = brImg(info.logo, 420000); if (logo === null) return { error: 'The logo must be a PNG, JPEG or WebP image under about 300 KB.' };
    var ov = get('bover', {}), old = ov[id] || {}; ov[id] = { name: name, full: name, url: url, desc: String(info.desc || '').trim().slice(0, 300), logo: logo || old.logo || '', v: (old.v || 0) + 1 }; set('bover', ov); DB.applyBrands(); DB.notifyAction(by, 'Brand updated', name, 'inventory'); return { ok: true };
  };
  DB.listBrandsCustom = function () { return get('cbrands', []); };
  function brSlug(s, n) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, n || 24); }
  function brImg(d, max) { if (!d) return ''; if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+\/=]+$/.test(d)) return null; if (d.length > max) return null; return d; }
  DB.saveBrand = function (b, by, role) {
    if (['admin', 'it'].indexOf(role) < 0) return { error: 'Only the Host and IT can add a brand.' };
    b = b || {}; var name = String(b.name || '').trim(); if (name.length < 2 || name.length > 40) return { error: 'Enter the brand name (2 to 40 characters).' };
    var id = brSlug(b.id || name); if (!id) return { error: 'Enter a valid brand name.' }; var list = get('cbrands', []), ex = list.filter(function (x) { return x.id === id; })[0];
    DB.applyBrands(); if (!ex && SEL.BRANDS.some(function (x) { return x.id === id || String(x.name).toLowerCase() === name.toLowerCase(); })) return { error: 'A brand with this name already exists.' };
    var url = String(b.url || '').trim(); if (url && !/^https:\/\/[^\s<>"']+$/i.test(url)) return { error: 'The website address must start with https://' };
    var logo = brImg(b.logo, 420000); if (logo === null) return { error: 'The logo must be a PNG, JPEG or WebP image under about 300 KB.' };
    var prods = Array.isArray(b.products) ? b.products : []; if (!prods.length) return { error: 'Add at least one product.' }; if (prods.length > 200) return { error: 'At most 200 products per brand.' };
    var seen = {}, out = [], init = parseInt(b.initStock, 10); if (!(init >= 0 && init <= 100000)) init = 100;
    for (var i = 0; i < prods.length; i++) {
      var p = prods[i] || {}, pn = String(p.name || '').trim(); if (pn.length < 2 || pn.length > 80) return { error: 'Product ' + (i + 1) + ': enter a name (2 to 80 characters).' };
      var vs = Array.isArray(p.variants) ? p.variants : []; if (!vs.length || vs.length > 12) return { error: pn + ': add 1 to 12 pack sizes with a price.' };
      var vseen = {}, vout = []; for (var j = 0; j < vs.length; j++) { var lab = String(vs[j].label || '').trim(), mrp = Math.round(parseFloat(vs[j].mrp) * 100) / 100; if (!lab || lab.length > 30) return { error: pn + ': each pack needs a label (for example 1 KG).' }; if (!(mrp > 0) || mrp > 1000000) return { error: pn + ' ' + lab + ': enter the MRP (more than 0).' };
        var vid = brSlug(vs[j].id || lab, 20) || ('v' + j); while (vseen[vid]) vid += '-' + j; vseen[vid] = 1; vout.push({ id: vid, label: lab, mrp: mrp }); }
      var fl = (Array.isArray(p.flavours) ? p.flavours : []).map(function (x) { return String(x).trim().slice(0, 40); }).filter(Boolean).slice(0, 30), img = brImg(p.image, 360000); if (img === null) return { error: pn + ': the photo must be a PNG, JPEG or WebP image under about 260 KB.' };
      var pid = (p.id && String(p.id).indexOf(id + '-') === 0 && /^[a-z0-9-]+$/.test(p.id)) ? p.id : id + '-' + (brSlug(pn, 28) || ('p' + i)); while (seen[pid]) pid += '-' + i; seen[pid] = 1;
      out.push({ id: pid, name: pn, cat: String(p.cat || 'Products').trim().slice(0, 30) || 'Products', variants: vout, flavours: fl, image: img || '' });
    }
    var rec = { id: id, name: name, full: String(b.full || name).trim().slice(0, 60), url: url, logo: logo || '', desc: String(b.desc || '').trim().slice(0, 300), products: out, by: by, at: ex ? ex.at : new Date().toISOString(), v: (ex ? (ex.v || 0) : 0) + 1 };
    if (ex) list = list.map(function (x) { return x.id === id ? rec : x; }); else list.push(rec); set('cbrands', list);
    var inv = get('inv', {}), made = 0; out.forEach(function (p) { p.variants.forEach(function (v) { var k = SEL.sku(p.id, v.id); if (!inv[k]) { inv[k] = { on: init, res: 0, dmg: 0, rec: 0 }; made++; } }); }); set('inv', inv);
    DB.applyBrands();
    DB.addStaffNotif({ key: 'brand:' + id + ':' + rec.v, kind: 'brand', audience: ['admin', 'employee', 'finance', 'logistics', 'warehouse', 'it', 'branding'], title: ex ? 'Brand updated' : 'New brand added', text: name + ': ' + out.length + ' product(s) now available' + (made ? ', opening stock ' + init + ' per pack' : '') + '.', count: 1, at: Date.now() });
    DB.notifyAction(by, ex ? 'Brand updated' : 'Brand added', name, 'inventory'); return { ok: true, id: id, created: !ex };
  };
  DB.removeBrand = function (id, by, role) {
    if (['admin', 'it'].indexOf(role) < 0) return { error: 'Only the Host and IT can remove a brand.' }; var list = get('cbrands', []), b = list.filter(function (x) { return x.id === id; })[0]; if (!b) return { error: 'Brand not found.' };
    var used = false; get('dealers', []).forEach(function (d) { (get('orders.' + d.code, []) || []).forEach(function (o) { if ((o.items || []).some(function (l) { return String(l.pid).indexOf(id + '-') === 0; })) used = true; }); }); if (used) return { error: 'This brand already has orders. Deactivate its products in Inventory instead.' };
    set('cbrands', list.filter(function (x) { return x.id !== id; })); var inv = get('inv', {}); Object.keys(inv).forEach(function (k) { if (k.indexOf(id + '-') === 0) delete inv[k]; }); set('inv', inv); DB.applyBrands(); DB.notifyAction(by, 'Brand removed', b.name, 'inventory'); return { ok: true };
  };
})();
