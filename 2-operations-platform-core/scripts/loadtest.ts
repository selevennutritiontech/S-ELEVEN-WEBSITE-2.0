/* Load test: realistic concurrent workflows against a real PostgreSQL. Reports MEASURED latency and throughput for THIS machine only.
   It does not prove capacity for production: run it against a production-like environment before launch. */
import crypto from 'node:crypto';
import { pool, fixture, provider, hook } from '../test/helpers.js';
import { createOrder } from '../src/services/orders.js';
import { initiatePayment, handleWebhook } from '../src/services/payments.js';
import { dealerContext } from '../src/services/context.js';

const pct = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };
async function run<T>(name: string, total: number, conc: number, fn: (i: number) => Promise<T>) {
  const lat: number[] = [], t0 = performance.now(); let next = 0, errors = 0; const out: T[] = [];
  await Promise.all(Array.from({ length: conc }, async () => { while (true) { const i = next++; if (i >= total) return; const s = performance.now(); try { out.push(await fn(i)); } catch { errors++; } lat.push(performance.now() - s); } }));
  const sec = (performance.now() - t0) / 1000;
  console.log(`${name.padEnd(30)} n=${String(total).padStart(4)} conc=${String(conc).padStart(2)}  p50=${pct(lat, 50).toFixed(0).padStart(4)}ms  p95=${pct(lat, 95).toFixed(0).padStart(4)}ms  p99=${pct(lat, 99).toFixed(0).padStart(4)}ms  ${(total / sec).toFixed(0).padStart(4)} req/s  errors=${errors}`);
  return out;
}
const f = await fixture(); const prods: string[] = [], dealers: string[] = [];
for (let i = 0; i < 60; i++) { const id = (await pool.query("INSERT INTO products (sku,name,brand_id,base_price_paise,gst_rate_bp) VALUES ($1,$1,$2,$3,0) RETURNING id", ['LT-' + i, i % 2 ? f.bolt : f.ved, 50000 + i * 1000])).rows[0].id as string; await pool.query('INSERT INTO inventory_balances (product_id,on_hand) VALUES ($1,1000000)', [id]); prods.push(id); }
for (let i = 0; i < 40; i++) dealers.push((await pool.query('INSERT INTO dealers (dealer_code,name,sales_employee_id) VALUES ($1,$1,$2) RETURNING id', ['LD' + i, i % 2 ? f.sales1 : f.sales2])).rows[0].id as string);
let seed = 12345; const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
console.log(`PostgreSQL local, pool=25 connections, ${prods.length} products, ${dealers.length} dealers\n`);
const orders = await run('create order (1-3 lines)', 600, 20, i => createOrder(pool, { dealerId: dealers[rnd(40)], actor: { type: 'DEALER', id: 'x' }, items: Array.from({ length: 1 + rnd(3) }, () => ({ productId: prods[rnd(60)], qty: 1 + rnd(5) })), idempotencyKey: 'lt' + i }));
const ids = orders.map(o => o.orderId);
const events = await run('payment (initiate + webhook)', ids.length, 20, async i => { const att = await initiatePayment(pool, ids[i], provider, 'lt-pay-' + ids[i]); const h = hook({ eventId: 'ev-' + ids[i], type: 'payment.captured', ref: att.provider_order_ref, txn: 'tx-' + ids[i], amountPaise: att.amount_paise }); await handleWebhook(pool, provider, h.raw, h.sig); return h; });
await run('dealer context (history page)', 400, 20, i => dealerContext(pool, { type: 'EMPLOYEE', id: f.host, role: 'HOST' }, dealers[i % 40], { limit: 10 }));
const before = (await pool.query('SELECT COUNT(*)::int n, COALESCE(SUM(amount_paise),0)::bigint s FROM target_credit_ledger')).rows[0];
await run('replayed webhooks (duplicates)', events.length, 20, async i => handleWebhook(pool, provider, events[i].raw, events[i].sig));
const after = (await pool.query('SELECT COUNT(*)::int n, COALESCE(SUM(amount_paise),0)::bigint s FROM target_credit_ledger')).rows[0];
const inv = (await pool.query('SELECT COUNT(*)::int bad FROM inventory_balances WHERE reserved > on_hand OR on_hand < 0 OR reserved < 0')).rows[0].bad;
const paid = (await pool.query("SELECT COUNT(*)::int n FROM orders WHERE status='PAID_AWAITING_LOGISTICS'")).rows[0].n, caps = (await pool.query('SELECT COUNT(*)::int n FROM payment_captures')).rows[0].n;
console.log(`\nINTEGRITY: orders created=${ids.length}, paid=${paid}, captures=${caps}, inventory violations=${inv}, ledger rows before/after duplicate replay=${before.n}/${after.n}, ledger sum unchanged=${before.s === after.s}`);
const ok = ids.length === 600 && paid === caps && inv === 0 && before.n === after.n && before.s === after.s; console.log(ok ? 'RESULT: all integrity checks passed' : 'RESULT: INTEGRITY CHECK FAILED'); await pool.end(); process.exit(ok ? 0 : 1);
