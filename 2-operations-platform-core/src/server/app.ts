import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import type pg from 'pg';
import { DomainError } from '../db.js';
import { can, type Actor } from '../permissions.js';
import { createOrder } from '../services/orders.js';
import { listOrders } from '../services/orderViews.js';
import { getOrderFor } from '../services/access.js';
import { dealerContext } from '../services/context.js';
import { recordOrderView } from '../services/orderViews.js';
import { Cfg, Session, login, resolve, logout, changePassword, setTemporaryPassword, endAllSessions, audit, parseCookies, sessionCookie, clearCookie } from './auth.js';
import { RateLimiter, securityHeaders, safeEqual, seal, open } from './security.js';

type Result = { status: number; body?: unknown; headers?: Record<string, string> };
interface Ctx { req: http.IncomingMessage; url: URL; m: string[]; body: Record<string, unknown>; s: Session | null; ip: string; cfg: Cfg; pool: pg.Pool; lim: RateLimiter }
type Need = 'public' | 'any' | 'dealer' | 'staff' | 'host';
interface Route { method: string; re: RegExp; need: Need; big?: boolean; h: (c: Ctx) => Promise<Result> }
const UUID = '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})', CODE = '([A-Za-z0-9_-]{1,40})';
const asJson = (v: unknown) => JSON.stringify(v, (_k, x) => typeof x === 'bigint' ? x.toString() : x);
const str = (v: unknown, max: number) => typeof v === 'string' ? v.trim().slice(0, max) : '';
const int = (v: unknown, d: number, lo: number, hi: number) => { const n = Number(v); return Number.isInteger(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const forbid = (msg = 'You are not allowed to do that.') => new DomainError('FORBIDDEN', msg);
const notFound = (msg = 'Not found.') => new DomainError('NOT_FOUND', msg);
const bad = (msg: string) => new DomainError('VALIDATION', msg);
const ORDER_STATUS = /^[A-Z_]{3,30}$/;

async function orderDetail(pool: pg.Pool, actor: Actor, id: string) {
  const o = await getOrderFor(pool, actor, id); if (!o) throw notFound('Order not found.');     // the same answer for "does not exist" and "belongs to someone else"
  const items = (await pool.query('SELECT sku, name, brand_code, qty, unit_price_paise, line_total_paise, tax_paise FROM order_items WHERE order_id=$1 ORDER BY sku', [id])).rows;
  const hist = (await pool.query('SELECT from_status, to_status, at FROM order_status_history WHERE order_id=$1 ORDER BY id', [id])).rows;
  const keep = ['id', 'order_number', 'status', 'total_paise', 'paid_paise', 'created_at', 'paid_at', 'dealer_id'], order: Record<string, unknown> = {}; for (const k of keep) order[k] = (o as Record<string, unknown>)[k];
  return { order, items, history: hist };
}
async function dealerByCode(pool: pg.Pool, code: string) { const r = (await pool.query('SELECT id, dealer_code, name, sales_employee_id FROM dealers WHERE upper(dealer_code)=upper($1)', [code])).rows[0]; if (!r) throw notFound('Dealer not found.'); return r as { id: string; dealer_code: string; name: string; sales_employee_id: string | null }; }
/** the Host, or the Sales employee who owns that dealer, may manage the dealer's account */
const mayManageDealer = (s: Session, d: { sales_employee_id: string | null }) => s.actor.role === 'HOST' || (s.actor.role === 'SALES' && d.sales_employee_id === s.actor.id);

const routes: Route[] = [
  { method: 'GET', re: /^\/healthz$/, need: 'public', h: async () => ({ status: 200, body: { ok: true } }) },
  { method: 'POST', re: /^\/api\/auth\/login$/, need: 'public', h: async c => {
    const r = await login(c.pool, c.cfg, c.lim, { kind: c.body.kind, id: c.body.id, password: c.body.password, otp: c.body.otp, ip: c.ip, ua: String(c.req.headers['user-agent'] || '') });
    return { status: 200, body: { user: r.user, csrf: r.csrf }, headers: { 'Set-Cookie': sessionCookie(c.cfg, r.token, c.cfg.dealerAbsHours * 3600) } };
  } },
  { method: 'GET', re: /^\/api\/me$/, need: 'any', h: async c => ({ status: 200, body: { user: { type: c.s!.actor.type, role: c.s!.actor.role, code: c.s!.code, name: c.s!.name, mustChange: c.s!.mustChange }, csrf: c.s!.csrf } }) },
  { method: 'POST', re: /^\/api\/auth\/logout$/, need: 'any', h: async c => { await logout(c.pool, c.s!); await audit(c.pool, { actor: c.s!.actor, action: 'logout', ip: c.ip }); return { status: 200, body: { ok: true }, headers: { 'Set-Cookie': clearCookie(c.cfg) } }; } },
  { method: 'POST', re: /^\/api\/auth\/change-password$/, need: 'any', h: async c => { await changePassword(c.pool, c.s!, { current: c.body.current, next: c.body.next }); await audit(c.pool, { actor: c.s!.actor, action: 'password.changed', ip: c.ip }); return { status: 200, body: { ok: true } }; } },

  /* ----- dealer: every query is scoped to the dealer in the SESSION; an id in the URL or body is never trusted ----- */
  { method: 'GET', re: /^\/api\/dealer\/orders$/, need: 'dealer', h: async c => {
    const q = c.url.searchParams, status = str(q.get('status'), 30);
    const r = await listOrders(c.pool, c.s!.actor, { page: int(q.get('page'), 1, 1, 10000), pageSize: int(q.get('pageSize'), 25, 1, 100), q: str(q.get('q'), 80) || undefined, status: ORDER_STATUS.test(status) ? status : undefined });
    return { status: 200, body: r };
  } },
  { method: 'GET', re: new RegExp(`^/api/dealer/orders/${UUID}$`), need: 'dealer', h: async c => ({ status: 200, body: await orderDetail(c.pool, c.s!.actor, c.m[1]) }) },
  { method: 'POST', re: /^\/api\/dealer\/orders$/, need: 'dealer', h: async c => {
    const key = str(c.body.idempotencyKey, 80); if (key.length < 8) throw bad('idempotencyKey is required (a unique value per order attempt).');
    const raw = Array.isArray(c.body.items) ? c.body.items : []; if (!raw.length || raw.length > 100) throw bad('Add between 1 and 100 items.');
    const items = raw.map((x: unknown) => { const o = x as Record<string, unknown>; const id = str(o.productId, 40), qty = Number(o.qty); if (!new RegExp(`^${UUID}$`).test(id) || !Number.isInteger(qty) || qty < 1 || qty > 10000) throw bad('Each item needs a valid productId and a whole quantity from 1 to 10000.'); return { productId: id, qty }; });
    const r = await createOrder(c.pool, { dealerId: c.s!.actor.id, actor: { type: 'DEALER', id: c.s!.actor.id, role: 'DEALER' }, items, couponCode: str(c.body.couponCode, 40) || undefined, idempotencyKey: key });   // dealerId comes from the session; prices are computed by the server
    return { status: r.duplicate ? 200 : 201, body: r };
  } },
  { method: 'GET', re: /^\/api\/dealer\/summary$/, need: 'dealer', h: async c => ({ status: 200, body: await dealerContext(c.pool, c.s!.actor, c.s!.actor.id, { limit: 10 }) }) },

  /* ----- staff: the existing role rules decide what each department sees ----- */
  { method: 'GET', re: /^\/api\/staff\/orders$/, need: 'staff', h: async c => {
    const q = c.url.searchParams, status = str(q.get('status'), 30);
    return { status: 200, body: await listOrders(c.pool, c.s!.actor, { page: int(q.get('page'), 1, 1, 10000), pageSize: int(q.get('pageSize'), 25, 1, 100), q: str(q.get('q'), 80) || undefined, status: ORDER_STATUS.test(status) ? status : undefined, dealerCode: str(q.get('dealerCode'), 40) || undefined }) };
  } },
  { method: 'GET', re: new RegExp(`^/api/staff/orders/${UUID}$`), need: 'staff', h: async c => ({ status: 200, body: await orderDetail(c.pool, c.s!.actor, c.m[1]) }) },
  { method: 'POST', re: new RegExp(`^/api/staff/orders/${UUID}/viewed$`), need: 'staff', h: async c => { if (!(await getOrderFor(c.pool, c.s!.actor, c.m[1]))) throw notFound('Order not found.'); return { status: 200, body: await recordOrderView(c.pool, c.s!.actor, c.m[1]) }; } },

  /* ----- account administration ----- */
  { method: 'POST', re: new RegExp(`^/api/admin/dealers/${CODE}/reset-password$`), need: 'staff', h: async c => {
    const d = await dealerByCode(c.pool, c.m[1]); if (!mayManageDealer(c.s!, d)) { await audit(c.pool, { actor: c.s!.actor, action: 'dealer.reset-password.denied', target: d.dealer_code, ip: c.ip, ok: false }); throw forbid('Only the Host or the dealer\'s own Sales employee can reset this password.'); }
    const temp = await setTemporaryPassword(c.pool, 'dealer', d.id); await audit(c.pool, { actor: c.s!.actor, action: 'dealer.reset-password', target: d.dealer_code, ip: c.ip });
    return { status: 200, body: { dealer: d.dealer_code, temporaryPassword: temp, note: 'Shown once. The dealer must change it at first sign-in.' } };
  } },
  { method: 'POST', re: new RegExp(`^/api/admin/dealers/${CODE}/status$`), need: 'staff', h: async c => {
    const d = await dealerByCode(c.pool, c.m[1]); if (!mayManageDealer(c.s!, d)) throw forbid(); const active = c.body.active === true, reason = str(c.body.reason, 200); if (!active && reason.length < 3) throw bad('Enter a reason.');
    await c.pool.query('UPDATE dealers SET status=$2 WHERE id=$1', [d.id, active ? 'ACTIVE' : 'INACTIVE']); if (!active) await endAllSessions(c.pool, 'dealer', d.id, 'DEACTIVATED');
    await audit(c.pool, { actor: c.s!.actor, action: active ? 'dealer.activate' : 'dealer.deactivate', target: d.dealer_code, ip: c.ip, detail: { reason } }); return { status: 200, body: { dealer: d.dealer_code, active } };
  } },
  { method: 'POST', re: new RegExp(`^/api/admin/employees/${CODE}/reset-password$`), need: 'host', h: async c => {
    const e = (await c.pool.query('SELECT id, employee_code FROM employees WHERE upper(employee_code)=upper($1)', [c.m[1]])).rows[0]; if (!e) throw notFound('Employee not found.');
    const temp = await setTemporaryPassword(c.pool, 'staff', e.id); await audit(c.pool, { actor: c.s!.actor, action: 'employee.reset-password', target: e.employee_code, ip: c.ip });
    return { status: 200, body: { employee: e.employee_code, temporaryPassword: temp, note: 'Shown once. The employee must change it at first sign-in.' } };
  } },
  { method: 'GET', re: /^\/api\/admin\/audit$/, need: 'host', h: async c => ({ status: 200, body: (await c.pool.query('SELECT at, actor_type, action, target, ip, ok FROM security_audit ORDER BY id DESC LIMIT $1', [int(c.url.searchParams.get('limit'), 100, 1, 500)])).rows }) },

  /* ----- Google Sheets: the secret lives ONLY on the server (sealed at rest). No endpoint ever returns it. ----- */
  { method: 'PUT', re: /^\/api\/admin\/google-config$/, need: 'host', h: async c => {
    const url = str(c.body.url, 300), secret = str(c.body.secret, 200), owner = str(c.body.owner, 120);
    const okUrl = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url) || (c.cfg.allowInsecureGoogleUrl && /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(url));
    if (!okUrl) throw bad('The address should look like https://script.google.com/macros/s/.../exec'); if (secret.length < 8) throw bad('The secret must be at least 8 characters.');
    await c.pool.query("INSERT INTO integration_secrets (key, ciphertext, meta, updated_by) VALUES ('google.sheets',$1,$2,$3) ON CONFLICT (key) DO UPDATE SET ciphertext=$1, meta=$2, updated_by=$3, updated_at=now()", [seal(JSON.stringify({ url, secret }), c.cfg.secretsKey), JSON.stringify({ owner }), c.s!.code]);
    await audit(c.pool, { actor: c.s!.actor, action: 'google.config.set', ip: c.ip }); return { status: 200, body: { connected: true, owner } };
  } },
  { method: 'GET', re: /^\/api\/admin\/google-config$/, need: 'staff', h: async c => {
    const r = (await c.pool.query("SELECT meta, updated_at FROM integration_secrets WHERE key='google.sheets'")).rows[0];
    return { status: 200, body: { connected: !!r, owner: r?.meta?.owner ?? '', updatedAt: r?.updated_at ?? null } };          // never the url or the secret
  } },
  { method: 'GET', re: /^\/api\/sheets\/links$/, need: 'staff', h: async c => { const all = (await c.pool.query('SELECT dept, sheet_id, linked_by, linked_at FROM sheet_links ORDER BY dept')).rows; return { status: 200, body: c.s!.actor.role === 'HOST' ? all : all.filter(x => x.dept === c.s!.actor.role) }; } },
  { method: 'PUT', re: new RegExp(`^/api/sheets/links/${CODE}$`), need: 'staff', h: async c => {
    const dept = c.m[1].toUpperCase(); if (c.s!.actor.role !== 'HOST' && c.s!.actor.role !== dept) throw forbid('You can link only your own department\'s sheet.');
    const m = /^https:\/\/docs\.google\.com\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})/.exec(str(c.body.url, 400)); if (!m) throw bad('Paste a Google Sheets link (https://docs.google.com/spreadsheets/d/...).');
    await c.pool.query('INSERT INTO sheet_links (dept, sheet_id, linked_by) VALUES ($1,$2,$3) ON CONFLICT (dept) DO UPDATE SET sheet_id=$2, linked_by=$3, linked_at=now()', [dept, m[1], c.s!.code]); await audit(c.pool, { actor: c.s!.actor, action: 'sheet.link', target: dept, ip: c.ip }); return { status: 200, body: { dept, sheetId: m[1] } };
  } },
  { method: 'POST', re: /^\/api\/sheets\/forward$/, need: 'staff', big: true, h: async c => {
    const items = Array.isArray(c.body.items) ? c.body.items : []; if (!items.length || items.length > 200) throw bad('Send between 1 and 200 rows.');
    const links = new Map((await c.pool.query('SELECT dept, sheet_id FROM sheet_links')).rows.map(r => [String(r.dept), String(r.sheet_id)])), out: Record<string, unknown>[] = [];
    for (const raw of items) {
      const it = raw as Record<string, unknown>, dept = str(it.dept, 20).toUpperCase(), row = it.row, headers = it.headers;
      if (!str(it.book, 90) || !str(it.tab, 90) || !Array.isArray(row) || row.length > 60 || (headers !== undefined && (!Array.isArray(headers) || headers.length > 60))) throw bad('Each row needs a book, a tab and a list of values (at most 60).');
      if ([...row, ...(Array.isArray(headers) ? headers : [])].some(v => !(v === null || ['string', 'number', 'boolean'].includes(typeof v)) || (typeof v === 'string' && v.length > 2000))) throw bad('A value is not allowed.');
      if (dept && c.s!.actor.role !== 'HOST' && dept !== c.s!.actor.role) throw forbid('You can send only your own department\'s rows.');
      const target = str(it.target, 80); if (target && target !== links.get(dept)) throw forbid('That Google Sheet is not linked to the department.');          // the server only ever writes into a LINKED sheet
      out.push({ book: str(it.book, 90), dept, target, tab: str(it.tab, 90), key: str(it.key, 200), headers, row });
    }
    const cfgRow = (await c.pool.query("SELECT ciphertext FROM integration_secrets WHERE key='google.sheets'")).rows[0]; if (!cfgRow) throw new DomainError('NOT_CONFIGURED', 'Google is not connected yet.');
    const g = JSON.parse(open(cfgRow.ciphertext, c.cfg.secretsKey)) as { url: string; secret: string };
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 15_000);
    try { const r = await fetch(g.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ secret: g.secret, items: out }), signal: ctl.signal, redirect: 'follow' }); return { status: 200, body: { ok: r.ok, forwarded: out.length } }; }
    catch { throw new DomainError('UPSTREAM', 'Google could not be reached. The rows can be sent again.'); } finally { clearTimeout(t); }
  } },
];

const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.json': 'application/json; charset=utf-8', '.woff2': 'font/woff2', '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8', '.mp4': 'video/mp4', '.webm': 'video/webm' };

export function buildServer(pool: pg.Pool, cfg: Cfg) {
  const lim = new RateLimiter(), baseHeaders = securityHeaders(cfg.secure);
  const send = (res: http.ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}, api = true, head = false) => {
    const data = body === undefined ? '' : (typeof body === 'string' ? body : asJson(body));
    res.writeHead(status, { ...baseHeaders, ...(api ? { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } : {}), 'Content-Length': Buffer.byteLength(data), ...extra }); res.end(head ? undefined : data);
  };
  const clientIp = (req: http.IncomingMessage) => cfg.trustProxy ? String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '?' : req.socket.remoteAddress || '?';
  const readBody = (req: http.IncomingMessage, max: number) => new Promise<string>((resolve, reject) => { let n = 0; const parts: Buffer[] = []; req.on('data', (b: Buffer) => { n += b.length; if (n > max) { reject(new DomainError('PAYLOAD_TOO_LARGE', 'The request is too large.')); req.destroy(); } else parts.push(b); }); req.on('end', () => resolve(Buffer.concat(parts).toString('utf8'))); req.on('error', reject); });
  const staticFile = (req: http.IncomingMessage, res: http.ServerResponse, pathname: string) => {
    if (!cfg.portalDir) return send(res, 404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' }, false);
    let rel: string; try { rel = decodeURIComponent(pathname); } catch { return send(res, 400, 'Bad request', { 'Content-Type': 'text/plain; charset=utf-8' }, false); }
    if (rel.includes('\0') || rel.split('/').some(p => p.startsWith('.'))) return send(res, 404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' }, false);       // no dotfiles, no traversal
    const root = path.resolve(cfg.portalDir); let file = path.resolve(root, '.' + rel); if (file !== root && !file.startsWith(root + path.sep)) return send(res, 404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' }, false);
    try { if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.html'); const st = fs.statSync(file); const ext = path.extname(file).toLowerCase(); if (!MIME[ext]) return send(res, 404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' }, false);
      res.writeHead(200, { ...baseHeaders, 'Content-Type': MIME[ext], 'Content-Length': st.size, 'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600' }); if (req.method === 'HEAD') return res.end(); fs.createReadStream(file).pipe(res);
    } catch { send(res, 404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' }, false); }
  };
  const server = http.createServer(async (req, res) => {
    const ip = clientIp(req), method = (req.method || 'GET').toUpperCase();
    try {
      const url = new URL(req.url || '/', 'http://x'), p = url.pathname;
      if (!p.startsWith('/api/') && p !== '/healthz') { if (method !== 'GET' && method !== 'HEAD') return send(res, 405, { error: 'METHOD_NOT_ALLOWED' }, { Allow: 'GET, HEAD' }); return staticFile(req, res, p); }
      const wait = lim.hit('api:' + ip, cfg.apiPerIp, 60_000); if (wait) return send(res, 429, { error: 'TOO_MANY_REQUESTS', message: 'Too many requests. Slow down.' }, { 'Retry-After': String(wait) });
      let route: Route | undefined, m: string[] = []; for (const r of routes) { const mm = r.re.exec(p); if (mm) { if (r.method === method) { route = r; m = mm; break; } else m = ['405']; } }
      if (!route) return m[0] === '405' ? send(res, 405, { error: 'METHOD_NOT_ALLOWED' }) : send(res, 404, { error: 'NOT_FOUND', message: 'Not found.' });
      const mutating = method !== 'GET' && method !== 'HEAD';
      if (mutating) {   // a request that comes from another website is refused
        const origin = req.headers.origin, sfs = req.headers['sec-fetch-site']; const allowed = cfg.origin || `http${cfg.secure ? 's' : ''}://${req.headers.host}`;
        if ((origin && origin !== allowed) || sfs === 'cross-site') return send(res, 403, { error: 'CROSS_SITE', message: 'Cross-site request refused.' });
      }
      const s = route.need === 'public' ? null : await resolve(pool, cfg, parseCookies(req.headers.cookie)[cfg.cookieName]);
      if (route.need !== 'public' && !s) return send(res, 401, { error: 'UNAUTHENTICATED', message: 'Please sign in.' });
      if (s) {
        if (mutating && !(typeof req.headers['x-csrf-token'] === 'string' && safeEqual(req.headers['x-csrf-token'], s.csrf))) { await audit(pool, { actor: s.actor, action: 'csrf.rejected', target: p, ip, ok: false }); return send(res, 403, { error: 'CSRF', message: 'Missing or invalid security token. Reload the page.' }); }
        if (s.mustChange && !['/api/me', '/api/auth/change-password', '/api/auth/logout'].includes(p)) return send(res, 403, { error: 'PASSWORD_CHANGE_REQUIRED', message: 'Choose a new password before continuing.' });
        if (route.need === 'dealer' && s.kind !== 'dealer') return send(res, 403, { error: 'FORBIDDEN', message: 'This is for dealers.' });
        if ((route.need === 'staff' || route.need === 'host') && s.kind !== 'staff') return send(res, 403, { error: 'FORBIDDEN', message: 'This is for staff.' });
        if (route.need === 'host' && s.actor.role !== 'HOST') { await audit(pool, { actor: s.actor, action: 'forbidden', target: p, ip, ok: false }); return send(res, 403, { error: 'FORBIDDEN', message: 'Only the Host can do that.' }); }
      }
      let body: Record<string, unknown> = {};
      if (mutating) {
        const ct = String(req.headers['content-type'] || '').toLowerCase(), len = Number(req.headers['content-length'] || 0);
        const raw = await readBody(req, route.big ? cfg.maxUploadBody : cfg.maxBody);
        if (raw.length) { if (!ct.startsWith('application/json')) return send(res, 415, { error: 'UNSUPPORTED_MEDIA_TYPE', message: 'Send JSON (Content-Type: application/json).' }); try { const j = JSON.parse(raw); if (!j || typeof j !== 'object' || Array.isArray(j)) throw new Error('shape'); body = j as Record<string, unknown>; } catch { return send(res, 400, { error: 'BAD_JSON', message: 'The request body is not valid JSON.' }); } }
        void len;
      }
      const r = await route.h({ req, url, m, body, s, ip, cfg, pool, lim });
      return send(res, r.status, r.body ?? { ok: true }, r.headers || {}, true, method === 'HEAD');
    } catch (e) {
      if (e instanceof DomainError) {
        const code = e.code, status = ({ NOT_FOUND: 404, FORBIDDEN: 403, VALIDATION: 400, WEAK_PASSWORD: 400, INVALID_CREDENTIALS: 401, OTP_REQUIRED: 401, OTP_INVALID: 401, ACCOUNT_DISABLED: 403, TOO_MANY_ATTEMPTS: 429, PAYLOAD_TOO_LARGE: 413, CONFLICT: 409, UPSTREAM: 502, NOT_CONFIGURED: 409 } as Record<string, number>)[code] ?? 400;
        const extra: Record<string, string> = status === 429 ? { 'Retry-After': String((e.details as { retryAfter?: number })?.retryAfter ?? 60) } : {};
        return send(res, status, { error: code, message: e.message }, extra);
      }
      const id = Math.random().toString(36).slice(2, 10); console.error(`[${id}] unhandled error`, e instanceof Error ? e.stack : e);       // full detail stays in the server log; the client gets an id only
      return send(res, 500, { error: 'SERVER_ERROR', message: 'Something went wrong.', requestId: id });
    }
  });
  server.requestTimeout = 30_000; server.headersTimeout = 15_000; server.keepAliveTimeout = 5_000; server.maxHeadersCount = 60;
  return { server, lim };
}
