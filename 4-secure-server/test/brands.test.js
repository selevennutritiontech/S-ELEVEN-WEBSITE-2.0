'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { start, staff, dealer } = require('./helpers.js');
const failed = r => !r.json || r.json.ok === false || !!(r.json.result && r.json.result.error);
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const PNGBUF = Buffer.from(PNG.split(',')[1], 'base64');
let app, site, siteUrl;
test.before(async () => {
  site = http.createServer((q, s) => {
    if (q.url.startsWith('/products.json')) { s.setHeader('content-type', 'application/json'); return s.end(JSON.stringify({ products: [
      { title: 'Mass Gainer', product_type: 'Protein', images: [{ src: siteUrl + '/img.png' }], options: [{ name: 'Size', values: ['1 KG', '3 KG'] }, { name: 'Flavour', values: ['Chocolate', 'Vanilla'] }], variants: [
        { option1: '1 KG', option2: 'Chocolate', price: '1800.00', compare_at_price: '2000.00' }, { option1: '1 KG', option2: 'Vanilla', price: '1800.00', compare_at_price: '2000.00' }, { option1: '3 KG', option2: 'Chocolate', price: '4900.00', compare_at_price: '5400.00' }] },
      { title: 'Shaker', product_type: 'Accessories', images: [], options: [{ name: 'Title', values: ['Default Title'] }], variants: [{ option1: 'Default Title', price: '299.00', compare_at_price: null }] }] })); }
    if (q.url === '/img.png' || q.url === '/logo.png') { s.setHeader('content-type', 'image/png'); return s.end(PNGBUF); }
    s.setHeader('content-type', 'text/html'); s.end('<html><head><title>Titan Nutrition | Official</title><meta property="og:site_name" content="Titan Nutrition"><meta property="og:description" content="Real nutrition"><link rel="apple-touch-icon" href="/logo.png"></head><body></body></html>');
  });
  await new Promise(r => site.listen(0, '127.0.0.1', r)); siteUrl = 'http://127.0.0.1:' + site.address().port;
  app = await start({ env: { BRANDFETCH_ALLOW_PRIVATE: '1' } });
});
test.after(async () => { site.close(); await app.close(); });

test('brand importer reads name, logo and a Shopify-style product list; refuses private addresses in production mode', async () => {
  const bf = require('../src/brandfetch.js');
  const r = await bf.fetchBrand(siteUrl, { brandFetchAllowPrivate: true }); assert.ok(r.ok, JSON.stringify(r).slice(0, 200));
  assert.equal(r.name, 'Titan Nutrition'); assert.match(r.logo, /^data:image\/png/); assert.equal(r.products.length, 2);
  const mg = r.products.find(p => p.name === 'Mass Gainer'); assert.deepEqual(mg.variants.map(v => [v.label, v.mrp]), [['1 KG', 2000], ['3 KG', 5400]]); assert.deepEqual(mg.flavours, ['Chocolate', 'Vanilla']); assert.match(mg.image, /^data:image\/png/);
  assert.equal(r.products.find(p => p.name === 'Shaker').variants[0].label, 'Standard');
  const blocked = await bf.fetchBrand('http://127.0.0.1:1/', {}); assert.match(blocked.error, /secure|allowed/);
  assert.match((await bf.fetchBrand('https://127.0.0.1/', {})).error, /not allowed/);
  assert.match((await bf.fetchBrand('https://user:pw@example.com/', {})).error, /login/);
});

test('only the Host and IT fetch / add a brand; it then appears for dealers and Sales, with stock', async () => {
  const sales = await staff(app, 'SALES', 'sales123'), admin = await staff(app, 'ADMIN', 'admin123');
  const f0 = await sales.raw('POST', '/api/brand/fetch', { body: { url: siteUrl } }); assert.equal(f0.status, 403);
  const f1 = await admin.raw('POST', '/api/brand/fetch', { body: { url: siteUrl } }); assert.equal(f1.status, 200); assert.equal(f1.json.name, 'Titan Nutrition');
  const brand = { name: 'Titan Nutrition', url: siteUrl.replace('http:', 'https:'), logo: f1.json.logo, initStock: 100, products: f1.json.products };
  const denied = await sales.rpc('saveBrand', [brand, 'x', 'x']); assert.ok(failed(denied) || denied.status >= 400, 'sales cannot add a brand');
  const bad = await admin.rpc('saveBrand', [Object.assign({}, brand, { name: 'BOLT' }), 'x', 'x']); assert.match(JSON.stringify(bad.json), /already exists/);
  const ok = await admin.rpc('saveBrand', [brand, 'x', 'x']); assert.ok(!failed(ok), JSON.stringify(ok.json).slice(0, 200)); assert.equal(ok.json.result.id, 'titan-nutrition');
  const d = await dealer(app, 'DEMO001', 'demo123'), sg = await sales.getState(0);
  assert.ok((d.state.cbrands || []).some(b => b.id === 'titan-nutrition' && b.products.length === 2), 'dealers receive the new brand');
  const st = (await admin.getState(0)).json; const inv = JSON.parse(st.set['sel.v2.inv'] || st.set.inv || '{}'); assert.equal(inv['titan-nutrition-mass-gainer|1-kg'].on, 100);
  const T = require('node:vm'); assert.ok(app.engine.ctx.SEL.findProduct('titan-nutrition-shaker'), 'the engine knows the new products');
  const rm = await admin.rpc('removeBrand', ['titan-nutrition', 'x', 'x']); assert.ok(!failed(rm), JSON.stringify(rm.json).slice(0, 200));
});

test('Sales department can no longer collect payments; Finance can', async () => {
  const sales = await staff(app, 'SALES', 'sales123'), fin = await staff(app, 'FINANCE', 'fin123'), o = (app.engine.get('orders.DEMO001') || []).find(x => !x.hist && x.payment.status !== 'Paid' && !x.cancelled); assert.ok(o);
  const mk = ref => ({ method: 'UPI', ref, amount: 100, date: new Date().toISOString().slice(0, 10), name: 'p', size: 70, data: PNG });
  for (const [fn, args] of [['addProof', ['DEMO001', o.id, mk('UTR123456789'), 'x', 'x']], ['addPayLink', ['DEMO001', o.id, 'https://pay.example.com/x', 'x', 'x', 'x']], ['markPaid', ['DEMO001', o.id, { method: 'Cash' }]]]) {
    const r = await sales.rpc(fn, args); assert.ok(failed(r) || r.status >= 400, fn + ' must be refused for Sales: ' + JSON.stringify(r.json).slice(0, 120));
  }
  const ok = await fin.rpc('addProof', ['DEMO001', o.id, mk('UTR987654321'), 'x', 'x']); assert.ok(!failed(ok), JSON.stringify(ok.json).slice(0, 200));
});

test('clean start: 100 pcs of every product, logistics rates at 0, no demo people', async () => {
  const c = await start({ env: { SEED_DEMO: '', NODE_ENV: 'test', INITIAL_ADMIN_PASSWORD: 'Xk9-demo-Strong-Pass!', REQUIRE_2FA: '0' } });
  const inv = c.engine.get('inv'), SEL = c.engine.ctx.SEL, skus = SEL.allSkus(); assert.ok(skus.length > 50);
  for (const k of skus) assert.equal(inv[k.sku].on, 100, k.sku);
  assert.ok(c.engine.get('lrates').every(x => x.perKg === 0)); assert.equal((c.engine.get('employees') || []).length, 1); assert.equal((c.engine.get('dealers') || []).length, 0); await c.close();
});

test('Host and IT can disable, enable and edit a brand; Sales cannot; dealers stop seeing a disabled brand', async () => {
  const admin = await staff(app, 'ADMIN', 'admin123'), it = await staff(app, 'IT', 'it123'), sales = await staff(app, 'SALES', 'sales123');
  const SEL = app.engine.ctx.SEL, first = SEL.BRANDS[0], id = first.id, n0 = SEL.BRANDS.length, origName = first.name;
  const no = await sales.rpc('setBrandActive', [id, false, 'x', 'x']); assert.ok(failed(no) || no.status >= 400, 'sales refused');
  const off = await it.rpc('setBrandActive', [id, false, 'x', 'x']); assert.ok(!failed(off), JSON.stringify(off.json).slice(0, 200));
  assert.equal(SEL.BRANDS.length, n0 - 1); assert.ok(!SEL.BRANDS.some(b => b.id === id)); assert.ok(SEL.ALL_BRANDS.some(b => b.id === id), 'still listed for admins');
  const d = await dealer(app, 'DEMO001', 'demo123'); assert.ok((d.state.boff || {})[id], 'dealer client is told the brand is off');
  const on = await admin.rpc('setBrandActive', [id, true, 'x', 'x']); assert.ok(!failed(on)); assert.equal(SEL.BRANDS.length, n0);
  const ed = await it.rpc('saveBrandInfo', [id, { name: origName + ' X', url: 'https://example.com', desc: 'new text' }, 'x', 'x']); assert.ok(!failed(ed), JSON.stringify(ed.json).slice(0, 200));
  assert.equal(SEL.brandById(id).name, origName + ' X');
  const no2 = await sales.rpc('saveBrandInfo', [id, { name: 'Hack' }, 'x', 'x']); assert.ok(failed(no2) || no2.status >= 400);
});
