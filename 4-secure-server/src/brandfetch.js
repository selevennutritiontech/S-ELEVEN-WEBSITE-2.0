'use strict';
/* Reads a brand's public website so Admin / IT can add the brand with its logo and product list.
   Safety: HTTPS only, never a private / loopback / link-local address (checked on every redirect and pinned to the resolved
   address so DNS cannot change between the check and the request), size and time limits, no cookies, no credentials sent.
   Product list is read (best effort) from a Shopify catalogue, the WooCommerce store API, or schema.org Product data. */
const dns = require('node:dns').promises;
const net = require('node:net');
const https = require('node:https');
const http = require('node:http');
const zlib = require('node:zlib');

const MAX_HTML = 1.5 * 1024 * 1024, MAX_JSON = 6 * 1024 * 1024, MAX_IMG = 260 * 1024, TIMEOUT = 8000;

function isPrivate(ip) {
  if (net.isIPv4(ip)) { const [a, b] = ip.split('.').map(Number); return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224; }
  if (net.isIPv6(ip)) { const x = ip.toLowerCase(); if (x === '::1' || x === '::') return true; if (x.startsWith('::ffff:')) return isPrivate(x.slice(7)); return /^f[cd]/.test(x) || /^fe[89ab]/.test(x); }
  return true;
}

async function get(urlStr, { max = MAX_HTML, allowPrivate = false, accept = '*/*', hops = 3 } = {}) {
  let u; try { u = new URL(urlStr); } catch (e) { throw new Error('That is not a valid web address.'); }
  if (u.username || u.password) throw new Error('The address must not contain a login.');
  if (u.protocol !== 'https:' && !(allowPrivate && u.protocol === 'http:')) throw new Error('Use a secure https:// address.');
  let addr, fam;
  if (net.isIP(u.hostname)) { addr = u.hostname.replace(/^\[|\]$/g, ''); fam = net.isIP(addr); }
  else { const r = await dns.lookup(u.hostname, { all: true }); if (!r.length) throw new Error('The website could not be found.'); addr = r[0].address; fam = r[0].family; if (!allowPrivate && r.some(x => isPrivate(x.address))) throw new Error('That address is not allowed.'); }
  if (!allowPrivate && isPrivate(addr)) throw new Error('That address is not allowed.');
  const mod = u.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = mod.request({ protocol: u.protocol, hostname: u.hostname, port: u.port || undefined, path: u.pathname + u.search, method: 'GET', timeout: TIMEOUT,
      lookup: (h, o, cb) => (o && o.all) ? cb(null, [{ address: addr, family: fam }]) : cb(null, addr, fam),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; S-ELEVEN-BrandImport/1.0)', Accept: accept, 'Accept-Encoding': 'gzip, deflate, br' } }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume(); if (hops <= 0) return reject(new Error('Too many redirects.'));
        let next; try { next = new URL(res.headers.location, u).toString(); } catch (e) { return reject(new Error('Bad redirect.')); }
        return get(next, { max, allowPrivate, accept, hops: hops - 1 }).then(resolve, reject);
      }
      let stream = res; const enc = String(res.headers['content-encoding'] || '').toLowerCase();
      if (enc === 'gzip') stream = res.pipe(zlib.createGunzip()); else if (enc === 'deflate') stream = res.pipe(zlib.createInflate()); else if (enc === 'br') stream = res.pipe(zlib.createBrotliDecompress());
      const parts = []; let n = 0; let done = false;
      stream.on('data', c => { n += c.length; if (n > max) { if (!done) { done = true; req.destroy(); reject(new Error('The page is too large.')); } } else parts.push(c); });
      stream.on('end', () => { if (!done) { done = true; resolve({ status: res.statusCode, type: String(res.headers['content-type'] || '').split(';')[0].trim().toLowerCase(), body: Buffer.concat(parts), url: u.toString() }); } });
      stream.on('error', e => { if (!done) { done = true; reject(e); } });
    });
    req.on('timeout', () => req.destroy(new Error('The website took too long to answer.')));
    req.on('error', e => reject(e)); req.end();
  });
}

const dec = s => String(s || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').trim();
function metaOf(html, key) {
  const re = new RegExp('<meta[^>]+(?:property|name)\\s*=\\s*["\']' + key + '["\'][^>]*>', 'i'), m = re.exec(html); if (!m) return '';
  const c = /content\s*=\s*["']([^"']*)["']/i.exec(m[0]); return c ? dec(c[1]) : '';
}
function linkHref(html, relRe) {
  const out = []; for (const m of html.matchAll(/<link\b[^>]*>/gi)) { const t = m[0], r = /rel\s*=\s*["']([^"']*)["']/i.exec(t), h = /href\s*=\s*["']([^"']*)["']/i.exec(t); if (r && h && relRe.test(r[1])) { const sz = /sizes\s*=\s*["'](\d+)x/i.exec(t); out.push({ href: dec(h[1]), size: sz ? +sz[1] : 0 }); } }
  return out.sort((a, b) => b.size - a.size);
}
function abs(base, href) { try { return new URL(href, base).toString(); } catch (e) { return ''; } }
function sniff(buf) { if (buf.length > 12 && buf.slice(0, 4).toString('latin1') === '\x89PNG') return 'image/png'; if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg'; if (buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP') return 'image/webp'; return ''; }

async function imageData(url, opts) {
  try {
    let u = new URL(url); if (/cdn\.shopify\.com$/i.test(u.hostname) && !u.searchParams.has('width')) u.searchParams.set('width', '600');
    const r = await get(u.toString(), { max: MAX_IMG, allowPrivate: opts.allowPrivate, accept: 'image/*' }); if (r.status !== 200) return '';
    const t = sniff(r.body); return t ? 'data:' + t + ';base64,' + r.body.toString('base64') : '';
  } catch (e) { return ''; }
}

const num = v => { const n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.]/g, '')); return n > 0 ? Math.round(n * 100) / 100 : 0; };
const clean = (s, n) => dec(String(s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ')).slice(0, n);

function fromShopify(j) {
  const out = [];
  for (const p of (j.products || [])) {
    const opts = (p.options || []).map(o => ({ name: String(o.name || ''), values: o.values || [] })), fi = opts.findIndex(o => /flavou?r|taste/i.test(o.name));
    const groups = new Map(), flav = new Set();
    for (const v of (p.variants || [])) {
      const vals = [v.option1, v.option2, v.option3]; if (fi > -1 && vals[fi]) flav.add(String(vals[fi]));
      const lab = vals.filter((x, i) => x && i !== fi && x !== 'Default Title').join(' / ') || 'Standard', mrp = Math.max(num(v.compare_at_price), num(v.price));
      if (mrp > 0 && (!groups.has(lab) || groups.get(lab) < mrp)) groups.set(lab, mrp);
    }
    if (!groups.size) continue;
    out.push({ name: clean(p.title, 80), cat: clean(p.product_type, 30) || 'Products', variants: [...groups].slice(0, 12).map(([label, mrp]) => ({ label: label.slice(0, 30), mrp })), flavours: [...flav].slice(0, 30).map(x => x.slice(0, 40)), imageUrl: p.images && p.images[0] ? p.images[0].src : '' });
  }
  return out;
}
function fromWoo(arr) {
  const out = [];
  for (const p of arr) {
    const minor = (p.prices && +p.prices.currency_minor_unit) || 2, mrp = num(((p.prices && (p.prices.regular_price || p.prices.price)) || 0) / Math.pow(10, minor)); if (!(mrp > 0)) continue;
    const attrs = p.attributes || [], fl = attrs.find(a => /flavou?r|taste/i.test(a.name || '')), sz = attrs.find(a => /size|weight|pack/i.test(a.name || ''));
    out.push({ name: clean(p.name, 80), cat: clean(p.categories && p.categories[0] && p.categories[0].name, 30) || 'Products', variants: sz && sz.terms && sz.terms.length ? sz.terms.slice(0, 12).map(t => ({ label: clean(t.name, 30), mrp })) : [{ label: 'Standard', mrp }], flavours: fl && fl.terms ? fl.terms.slice(0, 30).map(t => clean(t.name, 40)) : [], imageUrl: p.images && p.images[0] ? p.images[0].src : '' });
  }
  return out;
}
function fromLd(html) {
  const out = [];
  const walk = x => {
    if (!x || typeof x !== 'object') return; if (Array.isArray(x)) return x.forEach(walk);
    const t = [].concat(x['@type'] || []); if (t.includes('Product')) {
      const o = [].concat(x.offers || [])[0] || {}, mrp = num(o.price || o.lowPrice || (o.priceSpecification && o.priceSpecification.price)); const img = [].concat(x.image || [])[0];
      if (mrp > 0 && x.name) out.push({ name: clean(x.name, 80), cat: clean(x.category, 30) || 'Products', variants: [{ label: 'Standard', mrp }], flavours: [], imageUrl: typeof img === 'string' ? img : (img && img.url) || '' });
    }
    if (x['@graph']) walk(x['@graph']); if (x.itemListElement) walk(x.itemListElement); if (x.item) walk(x.item);
  };
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) { try { walk(JSON.parse(m[1])); } catch (e) {} }
  return out;
}

async function fetchBrand(input, cfg = {}) {
  const allowPrivate = !!cfg.brandFetchAllowPrivate; let site;
  input = String(input || '').trim(); if (!input) return { error: 'Enter the brand website address.' };
  if (!/^[a-z]+:\/\//i.test(input)) input = 'https://' + input;
  let page; try { page = await get(input, { allowPrivate, accept: 'text/html,*/*' }); } catch (e) { return { error: e.message || 'The website could not be read.' }; }
  if (page.status >= 400) return { error: 'The website answered with an error (' + page.status + ').' };
  const html = page.body.toString('utf8'), base = page.url, origin = new URL(base).origin, notes = [];
  const title = dec((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html) || [, ''])[1]);
  const name = clean(metaOf(html, 'og:site_name') || title.split(/\s[|\u2013\u2014-]\s/)[0] || new URL(base).hostname.replace(/^www\./, ''), 40), desc = clean(metaOf(html, 'og:description') || metaOf(html, 'description'), 300);
  const ldLogo = (() => { for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) { try { const f = x => { if (!x || typeof x !== 'object') return ''; if (Array.isArray(x)) { for (const y of x) { const r = f(y); if (r) return r; } return ''; } if (x.logo) return typeof x.logo === 'string' ? x.logo : (x.logo.url || ''); return f(x['@graph']); }; const r = f(JSON.parse(m[1])); if (r) return r; } catch (e) {} } return ''; })();
  const cand = [ldLogo, ...linkHref(html, /apple-touch-icon/i).map(x => x.href), ...linkHref(html, /^(shortcut )?icon$/i).map(x => x.href), metaOf(html, 'og:image')].filter(Boolean).map(x => abs(base, x)).filter(Boolean);
  let logo = ''; for (const c of cand) { logo = await imageData(c, { allowPrivate }); if (logo) break; }
  if (!logo) notes.push('No logo could be read; upload one below.');
  let products = [], via = '';
  try { const r = await get(origin + '/products.json?limit=250', { max: MAX_JSON, allowPrivate, accept: 'application/json' }); if (r.status === 200 && /json/.test(r.type)) { products = fromShopify(JSON.parse(r.body.toString('utf8'))); if (products.length) via = 'catalogue'; } } catch (e) {}
  if (!products.length) { try { const r = await get(origin + '/wp-json/wc/store/v1/products?per_page=100', { max: MAX_JSON, allowPrivate, accept: 'application/json' }); if (r.status === 200) { const j = JSON.parse(r.body.toString('utf8')); if (Array.isArray(j)) { products = fromWoo(j); if (products.length) via = 'store'; } } } catch (e) {} }
  if (!products.length) { products = fromLd(html); if (products.length) via = 'page data'; }
  products = products.filter((p, i, a) => p.name && a.findIndex(q => q.name === p.name) === i).slice(0, 100);
  if (products.length) notes.push('Read ' + products.length + ' product(s) from the website ' + via + '. Check the prices (MRP) before saving.'); else notes.push('No product list could be read automatically from this website. Add the products below.');
  let k = 0; const queue = products.slice(0, 60);
  await Promise.all(Array.from({ length: 6 }, async () => { while (k < queue.length) { const p = queue[k++]; if (p.imageUrl) { const u = abs(base, p.imageUrl.startsWith('//') ? 'https:' + p.imageUrl : p.imageUrl); p.image = u ? await imageData(u, { allowPrivate }) : ''; } } }));
  products.forEach(p => { delete p.imageUrl; p.image = p.image || ''; });
  return { ok: true, name, full: name, url: origin, desc, logo, products, notes };
}
module.exports = { fetchBrand, isPrivate };
