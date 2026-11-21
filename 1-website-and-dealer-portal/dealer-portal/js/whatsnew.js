/* "What's new": after an update, each person sees a pop-up ONCE with a small preview of what changed for THEM (their department only).
   To announce a future update: add one entry to the top of SEL_RELEASES (a new id, the items, who each item is for). Nothing else is needed.
   Seen state is kept per person in this browser. Under browser automation (navigator.webdriver) the pop-up stays quiet unless sel.v2.forcewhatsnew is set, so tests are not blocked. */
(function () {
  'use strict';
  /* audience: 'all' | 'staff' | 'dealer' | a list of departments (host, sales, fieldsales, logistics, warehouse, finance, branding, it, hr) */
  window.SEL_RELEASES = [
    {
      id: '2026-11-v28', version: '28', date: '2026-11-07', title: 'What\u2019s new',
      items: [
        { audience: 'staff', title: 'Google Authenticator', text: 'After your password you type the 6-digit code from the Google Authenticator app. It is checked the moment you type the sixth digit. The first time, you scan a QR code.', preview: { kind: 'digits', label: 'Enter the 6-digit code', digits: '4 8 2 1 9 6' } },
        { audience: 'staff', title: 'Eleven knows your department', text: 'Eleven now answers only about your own department, and tells you what it can do for you. Ask it \u201Cwhat can you do\u201D.', preview: { kind: 'chat', lines: ['You: what can you do', 'Eleven: You are in your department. I can help you with your orders, stock and alerts.'] } },
        { audience: ['host'], title: 'Security page', text: 'Switch Google Authenticator on for every department (or one), see who has set it up, and reset a lost phone.', preview: { kind: 'rows', title: 'Security', rows: [['Sales', 'Required'], ['Warehouse', 'Required'], ['Finance', 'Required']] } },
        { audience: ['host'], title: 'Commission: your choice of three', text: 'Only you set a consultant\u2019s commission per brand: a percentage, a fixed amount per order, or by order size (slabs).', preview: { kind: 'rows', title: 'BOLT for a consultant', rows: [['Up to \u20B95,000', '2%'], ['\u20B95,000 and above', '\u20B9600 per order']] } },
        { audience: ['host', 'sales'], title: 'Sales by zone', text: 'North, South, East and West: every Sales executive with the field consultants who report to them, their orders and commission.', preview: { kind: 'chips', chips: ['North', 'South', 'East', 'West'] } },
        { audience: ['fieldsales'], title: 'Your menu is simpler', text: 'Dashboard, Dealers, Offers, Inventory, My visits, Updates, Sheets and WhatsApp. Attendance, allowances and Analytics are not used for you. Your commission is on your dashboard.', preview: { kind: 'rows', title: 'Menu', rows: [['My dashboard', ''], ['My visits', 'You can edit'], ['Inventory', 'Your brands']] } },
        { audience: ['fieldsales'], title: 'Edit your visits', text: 'You can change a visit you logged: the purpose, the outcome and the next step.', preview: { kind: 'chips', chips: ['Edit visit', 'Save changes'] } },
        { audience: ['fieldsales'], title: 'Stock of your brands only', text: 'Inventory shows only the brands your senior has activated for you. You message dealers only.', preview: { kind: 'chips', chips: ['BOLT', 'ELEO1NE'] } },
        { audience: ['sales'], title: 'Your consultants\u2019 leads and orders', text: 'You see your consultants\u2019 CRM leads, price their dealers, confirm their paid orders and switch their brands on or off. The Host sets the commission.', preview: { kind: 'chips', chips: ['Confirm order', 'Prices', 'Brand on/off'] } },
        { audience: ['warehouse'], title: 'Stock is view-only', text: 'Stock in, out, returned and damaged are done by Finance and Logistics. You can ask for a count. Logistics costs are no longer shown to you.', preview: { kind: 'rows', title: 'Inventory', rows: [['View', 'Yes'], ['Stock in / out', 'Finance and Logistics'], ['Ask for a count', 'Yes']] } },
        { audience: ['logistics', 'finance'], title: 'Stock changes are yours', text: 'Stock in, out, returned, damaged and counts are done by Finance and Logistics only.', preview: { kind: 'chips', chips: ['In', 'Out', 'Returned', 'Damaged'] } },
        { audience: ['dealer'], title: 'Your account stays private', text: 'No staff details are shown in your portal, and passwords can never be viewed.', preview: { kind: 'chips', chips: ['Private', 'Secure'] } }
      ]
    }
  ];
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function mine(item, who) { var a = item.audience, d = who.kind === 'dealer' ? 'dealer' : who.dept; if (a === 'all') return true; if (a === 'staff') return who.kind === 'staff'; if (a === 'dealer') return who.kind === 'dealer'; return Array.isArray(a) && a.indexOf(d) > -1; }
  function preview(p) {
    if (!p) return ''; var h = '<div class="wn-pv" aria-hidden="true">';
    if (p.kind === 'digits') h += '<div class="wn-pvl">' + esc(p.label) + '</div><div class="wn-dig">' + String(p.digits).split(' ').map(function (x) { return '<span>' + esc(x) + '</span>'; }).join('') + '</div>';
    else if (p.kind === 'rows') h += '<div class="wn-pvl"><b>' + esc(p.title) + '</b></div>' + (p.rows || []).map(function (r) { return '<div class="wn-row"><span>' + esc(r[0]) + '</span><b>' + esc(r[1]) + '</b></div>'; }).join('');
    else if (p.kind === 'chips') h += '<div class="wn-chips">' + (p.chips || []).map(function (c) { return '<span>' + esc(c) + '</span>'; }).join('') + '</div>';
    else if (p.kind === 'chat') h += (p.lines || []).map(function (l, i) { return '<div class="wn-bub' + (i % 2 ? ' bot' : '') + '">' + esc(l) + '</div>'; }).join('');
    return h + '</div>';
  }
  function css() {
    if (document.getElementById('wn-css')) return; var s = document.createElement('style'); s.id = 'wn-css';
    s.textContent = '#wnmodal{position:fixed;inset:0;z-index:100000;background:rgba(1,60,88,.55);display:flex;align-items:center;justify-content:center;padding:16px}#wnmodal .wn{background:#fff;color:#013C58;border-radius:18px;max-width:34rem;width:100%;max-height:86vh;overflow:auto;box-shadow:0 20px 60px rgba(0,0,0,.35);padding:22px}#wnmodal h2{margin:0 0 2px;font-size:1.35rem}#wnmodal .wn-sub{margin:0 0 14px;color:#476;font-size:.88rem}#wnmodal .wn-it{border-top:1px solid #d9eef5;padding:14px 0}#wnmodal .wn-it h3{margin:0 0 4px;font-size:1.02rem}#wnmodal .wn-it p{margin:0 0 8px;font-size:.9rem;line-height:1.45}.wn-pv{background:#E8F8FD;border:1px solid #A8E8F9;border-radius:12px;padding:10px 12px;font-size:.84rem}.wn-pvl{margin-bottom:6px;color:#00537A}.wn-dig{display:flex;gap:6px}.wn-dig span{flex:1;text-align:center;background:#fff;border:1px solid #00537A;border-radius:8px;padding:6px 0;font-weight:800;font-size:1.1rem;color:#00537A}.wn-row{display:flex;justify-content:space-between;gap:10px;padding:4px 0;border-top:1px dashed #A8E8F9}.wn-row b{color:#00537A}.wn-chips{display:flex;gap:6px;flex-wrap:wrap}.wn-chips span{background:#F5A201;color:#013C58;border-radius:99px;padding:4px 12px;font-weight:700}.wn-bub{background:#fff;border-radius:10px;padding:6px 10px;margin:4px 0;max-width:92%}.wn-bub.bot{background:#00537A;color:#fff;margin-left:auto}#wnmodal .wn-btns{display:flex;gap:10px;justify-content:flex-end;margin-top:12px}#wnmodal button{font:inherit;font-weight:700;border-radius:99px;padding:9px 20px;cursor:pointer;border:2px solid #00537A}#wnmodal .ok{background:#00537A;color:#fff}#wnmodal .later{background:#fff;color:#00537A}';
    document.head.appendChild(s);
  }
  function key(who) { return 'sel.v2.seenrel.' + (who.kind === 'dealer' ? 'D:' : 'S:') + who.code; }
  var shown = false;
  function maybeShow(who) {
    try {
      if (shown || !who || !who.code) return; var rel = (window.SEL_RELEASES || [])[0]; if (!rel) return;
      var auto = !!navigator.webdriver && !localStorage.getItem('sel.v2.forcewhatsnew'); if (auto) return;
      if (localStorage.getItem(key(who)) === rel.id) return;
      var items = rel.items.filter(function (it) { return mine(it, who); }); if (!items.length) { localStorage.setItem(key(who), rel.id); return; }
      shown = true; css(); var m = document.createElement('div'); m.id = 'wnmodal'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true'); m.setAttribute('aria-labelledby', 'wnt');
      m.innerHTML = '<div class="wn"><h2 id="wnt">' + esc(rel.title) + '</h2><p class="wn-sub">Update ' + esc(rel.version) + ' \u00B7 ' + esc(rel.date) + ' \u00B7 only what changed for you</p>' + items.map(function (it) { return '<div class="wn-it"><h3>' + esc(it.title) + '</h3><p>' + esc(it.text) + '</p>' + preview(it.preview) + '</div>'; }).join('') + '<div class="wn-btns"><button type="button" class="later" data-wn="later">Remind me later</button><button type="button" class="ok" data-wn="ok">Got it</button></div></div>';
      document.body.appendChild(m); var ok = m.querySelector('.ok'); if (ok) ok.focus();
      m.addEventListener('click', function (e) { var b = e.target.closest && e.target.closest('[data-wn]'); if (!b) return; if (b.getAttribute('data-wn') === 'ok') { try { localStorage.setItem(key(who), rel.id); } catch (x) {} } m.remove(); });
      document.addEventListener('keydown', function esc2(e) { if (e.key === 'Escape' && document.getElementById('wnmodal')) { document.getElementById('wnmodal').remove(); document.removeEventListener('keydown', esc2); } });
    } catch (e) { if (window.console) console.error(e); }
  }
  window.WhatsNew = { maybeShow: maybeShow, _forget: function (who) { try { localStorage.removeItem(key(who)); } catch (e) {} shown = false; } };
})();
