'use strict';
/* The linked Google sheets update by themselves, with the real Code.gs behind a stand-in for Google; errors are reported, never swallowed. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { start, staff } = require('./helpers.js');
const { makeGoogle } = require('./google-mock.js');
const ID_FS = '1FiElDsAlEsShEeTiDfIeLdSaLeS0123456789abcd', ID_SALES = '1SaLeSsHeEtIdSaLeSsHeEtId0123456789abcdefg', ID_FIN = '1FiNaNcEsHeEtIdFiNaNcEsHeEtId0123456789abcd';
let g, app, host; const tab = (sheet, name) => (sheet.tabs.find(t => t.name === name) || { rows: [] }).rows;
test.before(async () => { g = await makeGoogle(); g.mk(ID_SALES, 'Sales linked', true); g.mk(ID_FIN, 'Finance linked', false); g.mk(ID_FS, 'Field linked', true); app = await start({ memory: true, cfg: { sheetsUrlPattern: g.pattern } }); host = await staff(app, 'ADMIN', 'admin123'); });
test.after(async () => { await app.close(); await g.close(); });
const cfgGet = async () => (await host.raw('GET', '/api/sheets/config')).json;

test('Code.gs itself: upserts by key, writes headers once, keeps =formulas as text, reports unshared sheets', async () => {
  const sh = g.st.sheets.get(ID_SALES); const base = { book: 'Sales sheets', dept: 'sales', target: ID_SALES, tab: 'T1', headers: ['Order ID', 'Note'] };
  const send = items => JSON.parse(require('node:vm').runInContext('JSON.stringify(doPost({postData:{contents:' + JSON.stringify(JSON.stringify({ secret: g.st.secret, items })) + '}}).text)', require('node:vm').createContext({})) || '{}');
  const vmx = require('node:vm'); const post = (items, secret) => { const code = require('node:fs').readFileSync(require('node:path').resolve(__dirname, '..', '..', '2-operations-platform-core', 'google-sheets', 'Code.gs'), 'utf8'); return null; };
  // go through the real HTTP path instead
  const call = async items => (await (await fetch(g.url, { method: 'POST', body: JSON.stringify({ secret: g.st.secret, items }) })).json());
  let r = await call([Object.assign({ key: 'A1', row: ['A1', 'first'] }, base)]); assert.equal(r.ok, true); assert.equal(r.written, 1);
  r = await call([Object.assign({ key: 'A1', row: ['A1', 'changed'] }, base), Object.assign({ key: 'A2', row: ['A2', '=HYPERLINK("http://evil")'] }, base)]); assert.equal(r.written, 2);
  const rows = tab(sh, 'T1'); assert.deepEqual(rows[0], ['Order ID', 'Note'], 'header row once'); assert.equal(rows.filter(x => x[0] === 'A1').length, 1, 'updated in place, not duplicated'); assert.equal(rows.find(x => x[0] === 'A1')[1], 'changed'); assert.ok(String(rows.find(x => x[0] === 'A2')[1]).startsWith("'"), 'a formula is stored as text');
  r = await call([Object.assign({ key: 'Z', row: ['Z', 'x'] }, base, { target: ID_FIN })]); assert.equal(r.ok, true); assert.match(JSON.stringify(r.errors), /permission/i, 'a sheet not shared with the script is reported');
  const bad = await (await fetch(g.url, { method: 'POST', body: JSON.stringify({ secret: 'nope', items: [] }) })).json(); assert.equal(bad.ok, false); assert.equal(bad.error, 'Wrong secret');
});

test('wrong secret: nothing is lost, the exact reason is shown, and the rows go out once the secret is right', async () => {
  assert.equal((await host.raw('PUT', '/api/sheets/config', { body: { url: g.url, secret: 'wrong-secret' } })).status, 200);
  assert.equal((await host.raw('PUT', '/api/sheets/glink', { body: { dept: 'sales', url: 'https://docs.google.com/spreadsheets/d/' + ID_SALES + '/edit' } })).status, 200);
  assert.equal((await host.raw('PUT', '/api/sheets/glink', { body: { dept: 'finance', url: 'https://docs.google.com/spreadsheets/d/' + ID_FIN + '/edit' } })).status, 200);
  const before = g.st.sheets.get(ID_SALES).tabs.map(t => t.name).sort().join(), s1 = (await host.raw('POST', '/api/sheets/sync', { body: {} })).json;
  assert.match(s1.status.lastError, /secret/i, 'the screen can say why: ' + s1.status.lastError); assert.ok(s1.status.queued > 100, 'the rows are kept (' + s1.status.queued + ')'); assert.equal(g.st.sheets.get(ID_SALES).tabs.map(t => t.name).sort().join(), before, 'nothing was written');
  assert.equal(JSON.stringify(s1).includes('wrong-secret') || JSON.stringify(s1).includes('right-secret'), false, 'the secret is never shown');
  assert.equal((await host.raw('PUT', '/api/sheets/config', { body: { secret: 'right-secret' } })).status, 200);
  app.sheetSync.lastGv = -1;   // force a re-run to drain the queue
  const s2 = (await host.raw('POST', '/api/sheets/sync', { body: {} })).json; console.log('Google calls:', g.st.calls, 'last items count:', g.st.lastItems.length, 'Sales sheet tabs:', g.st.sheets.get(ID_SALES).tabs.map(t => t.name + '(' + t.rows.length + ')').join(', ')); assert.equal(s2.status.queued, 0, 'everything delivered: ' + JSON.stringify(s2.status).slice(0, 200));
  const sales = g.st.sheets.get(ID_SALES), orders = tab(sales, 'Orders'); assert.ok(orders.length > 50, 'the linked Sales sheet received the orders (' + orders.length + ' rows)'); assert.equal(new Set(orders.slice(1).map(r => r[0])).size, orders.length - 1, 'one row per order');
  assert.ok(tab(sales, 'Payments').length > 10); assert.match(s2.status.lastError, /not written.*permission|Share the Google Sheet/i, 'the Finance sheet is not shared with the script: said so, and said how to fix it');
  assert.equal(g.st.sheets.get(ID_FIN).tabs.length, 1, 'nothing written to the unshared sheet');
  const other = [...g.folderFiles.keys()]; assert.ok(other.some(n => /Logistics sheets/.test(n)) && other.some(n => /Warehouse sheets/.test(n)), 'departments without their own link get a file in the Drive folder: ' + other.join(' | '));
});

test('automatic: a change in the portal reaches the linked sheet by itself, updating the same row', async () => {
  const sales = g.st.sheets.get(ID_SALES), rowOf = id => tab(sales, 'Orders').filter(r => r[0] === id), before = rowOf('DEMO-L1'); assert.equal(before.length, 1); assert.ok(!/INV\/MOCK/.test(JSON.stringify(before[0]))); const calls0 = g.st.calls;
  const PDF = 'data:application/pdf;base64,JVBERi0xLjQKJSVFT0YK', r = await app.commitCall('attachInvoiceFile', ['DEMO001', 'DEMO-L1', { name: 'i.pdf', size: 14, data: PDF, no: 'INV/MOCK/1' }, 'LOGISTICS']); assert.ok(!(r.result && r.result.error), JSON.stringify(r).slice(0, 200));
  await app.sheetSync.run(false); const after = rowOf('DEMO-L1'); assert.equal(after.length, 1, 'still one row, updated in place'); assert.match(JSON.stringify(after[0]), /INV\/MOCK\/1/, 'the new invoice number is in the row');
  assert.ok(g.st.calls > calls0, 'the change was sent'); const sent = g.st.lastItems.length; assert.ok(sent < 40, 'a small update, not everything again (' + sent + ' rows)');
  const idle = g.st.calls; await app.sheetSync.run(false); assert.equal(g.st.calls, idle, 'nothing changed: nothing sent');
});

test('rows sent by browsers (activity, personal sheets) are kept until Google accepts them', async () => {
  g.st.secret = 'rotated'; const item = { book: 'Sales sheets', dept: 'sales', tab: 'Activity', key: '', headers: ['When', 'Who'], row: ['now', 'SALES'] };
  const sales = await staff(app, 'SALES', 'sales123'); const r = await sales.raw('POST', '/api/sheets/push', { body: { items: [item] } }); assert.equal(r.status, 200); await new Promise(x => setTimeout(x, 400));
  const c1 = (await sales.raw('GET', '/api/sheets/config')).json; assert.match(c1.status.lastError, /secret/i); assert.ok(c1.queued >= 1, 'kept in the queue'); g.st.secret = 'right-secret';
  await app.sheets.flush(); const left = app.sheets.queue.length; assert.equal(left, 0, 'delivered after the secret matched again'); assert.ok(tab(g.st.sheets.get(ID_SALES), 'Activity').some(x => x[1] === 'SALES'), 'the activity row arrived');
});

test('the Field Sales sheet carries the orders of field consultants (and only theirs)', async () => {
  const e = { id: 'FIELD9', name: 'Field Nine', dept: 'fieldsales', password: 'Field#Pass2026', email: 'f9@x.in', mobile: '9000000009', zone: 'North', state: 'Delhi', city: 'Delhi', manager: 'SALES2' };
  assert.ok(!(await host.rpc('saveEmployee', [e])).json.result.error); assert.ok((await host.rpc('setFieldBrand', ['FIELD9', 'bolt', true, 4, 'x', 'x'])).json.result.ok);
  const f = await staff(app, 'FIELD9', 'Field#Pass2026');
  const fd = { code: 'FSH1', password: 'Dealer#Pass2026x', name: 'Sheet Dealer', person: 'Q', city: 'Delhi', phone: '9444444441', gst: '', address: 'Shop 9, Connaught Place, Delhi 110001', pincode: '110001', category: 'Retailer', freightApply: true, brandPct: {}, salesEmp: 'FIELD9' };
  const cdResult = await host.rpc('saveDealerAs', [fd, 'x', 'x']); assert.ok(!cdResult.json.result.error, JSON.stringify(cdResult.json).slice(0,200));
  const pid = Object.keys(app.engine.ctx.SEL.IMG).find(p => app.engine.ctx.SEL.findProduct(p).brand === 'bolt'), pr = app.engine.ctx.SEL.findProduct(pid).product;
  const o = await f.rpc('addOrder', ['FSH1', { items: [{ pid, vid: pr.variants[0].id, flavour: (pr.flavours || [''])[0] || '', qty: 1 }], address: fd.address, pin: fd.pincode, phone: fd.phone }]); assert.ok(!(o.json.result || {}).error, JSON.stringify(o.json).slice(0, 200));
  assert.ok(!(await host.raw('PUT', '/api/sheets/glink', { body: { dept: 'fieldsales', url: 'https://docs.google.com/spreadsheets/d/' + ID_FS + '/edit' } })).json.error);
  // force a completely fresh sync (new sandbox, re-reads the engine state with FIELD9 in it)
  app.sheetSync.ctx = null; app.sheetSync.lastGv = -1; app.sheetSync.own.clear(); app.sheetSync.junk.clear();
  await app.sheetSync.run(true);
  const rows = tab(g.st.sheets.get(ID_FS), 'Orders');
  assert.ok(rows.length >= 2, 'the linked Field Sales sheet received at least one order row (' + rows.length + ' rows)');
  assert.ok(rows.some(r => r[0] === o.json.result.id), 'the consultant\'s order is in the Field Sales sheet');
  assert.ok(tab(g.st.sheets.get(ID_SALES), 'Orders').some(r => r[0] === o.json.result.id), 'and it is in the Sales sheet too');
});
