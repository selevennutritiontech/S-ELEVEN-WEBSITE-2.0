import { recordActivity } from './activity.js';
import type pg from 'pg';
import { tx, DomainError } from '../db.js';
import { Actor, assertCan } from '../permissions.js';

/** Sample orders are FREE: they never create payment attempts, never credit targets, and use a stock pool separate from saleable inventory. */
export async function receiveSampleStock(pool: pg.Pool, a: { productId: string; qty: number; actor: Actor; reason?: string }) {
  assertCan(a.actor, 'sample.stock.edit'); if (!Number.isInteger(a.qty) || a.qty < 1) throw new DomainError('BAD_QTY', 'Quantity must be at least 1');
  const r = await tx(pool, async c => {
    await c.query('INSERT INTO sample_inventory (product_id) VALUES ($1) ON CONFLICT DO NOTHING', [a.productId]);
    const b = (await c.query('SELECT on_hand FROM sample_inventory WHERE product_id=$1 FOR UPDATE', [a.productId])).rows[0]; const after = b.on_hand + a.qty;
    await c.query('UPDATE sample_inventory SET on_hand=$2, updated_by=$3, updated_at=now() WHERE product_id=$1', [a.productId, after, a.actor.id]);
    await c.query("INSERT INTO sample_movements (product_id, delta, kind, reason, actor_id, qty_before, qty_after) VALUES ($1,$2,'RECEIPT',$3,$4,$5,$6)", [a.productId, a.qty, a.reason ?? 'sample stock received', a.actor.id, b.on_hand, after]);
    return { before: b.on_hand as number, after };
  });
  const served = await allocateWaitingSamples(pool); return { ...r, samplesAllocated: served };
}
export async function createSampleOrder(pool: pg.Pool, a: { actor: Actor; recipientDealerId?: string; recipientName: string; address: string; items: { productId: string; qty: number }[] }) {
  assertCan(a.actor, 'sample.create'); if (!a.items.length) throw new DomainError('EMPTY_ORDER', 'Add at least one sample product'); if (a.address.trim().length < 10) throw new DomainError('BAD_ADDRESS', 'Enter the delivery address');
  return tx(pool, async c => {
    const num = (await c.query("SELECT 'SMP-' || nextval('sample_number_seq') AS n")).rows[0].n as string; let val = 0n; const lines: { pid: string; qty: number; v: bigint }[] = [];
    for (const it of a.items) { if (!Number.isInteger(it.qty) || it.qty < 1) throw new DomainError('BAD_QTY', 'Bad quantity'); const p = (await c.query('SELECT base_price_paise FROM products WHERE id=$1', [it.productId])).rows[0]; if (!p) throw new DomainError('UNKNOWN_PRODUCT', 'Product not found'); const v = (p.base_price_paise as bigint) * BigInt(it.qty); val += v; lines.push({ pid: it.productId, qty: it.qty, v }); }
    const so = (await c.query('INSERT INTO sample_orders (sample_number, recipient_dealer_id, recipient_name, delivery_address, valuation_paise, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id', [num, a.recipientDealerId ?? null, a.recipientName, a.address, val.toString(), a.actor.id])).rows[0];
    for (const l of lines) await c.query('INSERT INTO sample_order_items (sample_order_id, product_id, qty, valuation_paise) VALUES ($1,$2,$3,$4)', [so.id, l.pid, l.qty, l.v.toString()]);
    return { id: so.id as string, number: num, valuationPaise: val };
  });
}
async function reserveSamples(c: pg.PoolClient, id: string): Promise<boolean> {
  const items = (await c.query('SELECT product_id, qty FROM sample_order_items WHERE sample_order_id=$1 ORDER BY product_id', [id])).rows;
  for (const it of items) { const r = await c.query('UPDATE sample_inventory SET reserved = reserved + $2, updated_at=now() WHERE product_id=$1 AND on_hand - reserved >= $2', [it.product_id, it.qty]); if (!r.rowCount) return false; }
  return true;
}
export async function approveSample(pool: pg.Pool, id: string, actor: Actor) {
  assertCan(actor, 'sample.approve');
  return tx(pool, async c => {
    const s = (await c.query('SELECT * FROM sample_orders WHERE id=$1 FOR UPDATE', [id])).rows[0]; if (!s) throw new DomainError('NOT_FOUND', 'Sample order not found');
    if (s.status !== 'PENDING_APPROVAL') throw new DomainError('INVALID_TRANSITION', 'Only pending samples can be approved');
    await c.query('SAVEPOINT r'); const ok = await reserveSamples(c, id);
    if (!ok) { await c.query('ROLLBACK TO SAVEPOINT r'); await c.query("UPDATE sample_orders SET status='AWAITING_STOCK', approved_by=$2 WHERE id=$1", [id, actor.id]); return 'AWAITING_STOCK'; }
    await c.query("UPDATE sample_orders SET status='APPROVED', reserved=true, approved_by=$2 WHERE id=$1", [id, actor.id]); return 'APPROVED';
  });
}
export async function allocateWaitingSamples(pool: pg.Pool): Promise<number> {
  const ids = (await pool.query("SELECT id FROM sample_orders WHERE status='AWAITING_STOCK' ORDER BY created_at, id")).rows.map(r => r.id as string); let n = 0;
  for (const id of ids) await tx(pool, async c => { await c.query('SAVEPOINT r'); if (await reserveSamples(c, id)) { await c.query("UPDATE sample_orders SET status='APPROVED', reserved=true WHERE id=$1", [id]); n++; } else await c.query('ROLLBACK TO SAVEPOINT r'); });
  return n;
}
const NEXT: Record<string, string[]> = { APPROVED: ['READY_FOR_PACKING', 'CANCELLED'], AWAITING_STOCK: ['CANCELLED'], PENDING_APPROVAL: ['CANCELLED'], READY_FOR_PACKING: ['PACKING', 'CANCELLED'], PACKING: ['PACKED'], PACKED: ['SHIPPED'], SHIPPED: ['DELIVERED'] };
export async function advanceSample(pool: pg.Pool, id: string, to: string, actor: Actor) {
  assertCan(actor, to === 'CANCELLED' ? 'sample.create' : 'packing.update');
  return tx(pool, async c => {
    const s = (await c.query('SELECT * FROM sample_orders WHERE id=$1 FOR UPDATE', [id])).rows[0]; if (!s) throw new DomainError('NOT_FOUND', 'Sample order not found');
    if (!(NEXT[s.status] || []).includes(to)) throw new DomainError('INVALID_TRANSITION', `Cannot move a sample order from ${s.status} to ${to}`);
    const items = (await c.query('SELECT product_id, qty FROM sample_order_items WHERE sample_order_id=$1', [id])).rows;
    if (to === 'CANCELLED' && s.reserved) for (const it of items) await c.query('UPDATE sample_inventory SET reserved = reserved - $2, updated_at=now() WHERE product_id=$1', [it.product_id, it.qty]);
    if (to === 'SHIPPED') for (const it of items) {
      const b = (await c.query('UPDATE sample_inventory SET on_hand = on_hand - $2, reserved = reserved - $2, dispatched = dispatched + $2, updated_at=now() WHERE product_id=$1 RETURNING on_hand', [it.product_id, it.qty])).rows[0];
      await c.query("INSERT INTO sample_movements (product_id, delta, kind, ref_id, reason, actor_id, qty_before, qty_after) VALUES ($1,$2,'DISPATCH',$3,'sample shipped',$4,$5,$6)", [it.product_id, -it.qty, id, actor.id, b.on_hand + it.qty, b.on_hand]);
    }
    await c.query('UPDATE sample_orders SET status=$2, reserved = CASE WHEN $2 IN (\'CANCELLED\',\'SHIPPED\',\'DELIVERED\') THEN false ELSE reserved END WHERE id=$1', [id, to]);
    // the packing checklist and Sales-target rules do not apply: there is no payment and no target credit for a free sample
  });
}

/** Sample order with a CUSTOM product name: only the brand is chosen. It goes straight to the Warehouse and Logistics; nothing is reserved and no payment or target credit exists. */
export async function createCustomSampleOrder(pool: pg.Pool, a: { actor: Actor; recipientDealerId?: string; recipientName: string; address: string; lines: { brandId: string; name: string; qty: number; unitValuePaise?: number }[] }) {
  assertCan(a.actor, 'sample.create');
  if (!a.lines.length) throw new DomainError('EMPTY_ORDER', 'Add at least one sample product'); if (!a.recipientName.trim() || a.address.trim().length < 10) throw new DomainError('BAD_ADDRESS', 'Enter the recipient and the delivery address');
  for (const l of a.lines) { if (!l.brandId) throw new DomainError('BRAND_REQUIRED', 'Choose the brand'); if (!l.name || l.name.trim().length < 2) throw new DomainError('NAME_REQUIRED', 'Type the product name'); if (!Number.isInteger(l.qty) || l.qty < 1) throw new DomainError('BAD_QTY', 'Bad quantity'); }
  const out = await tx(pool, async c => {
    let val = 0; for (const l of a.lines) { if (!(await c.query('SELECT 1 FROM brands WHERE id=$1', [l.brandId])).rowCount) throw new DomainError('UNKNOWN_BRAND', 'Unknown brand'); val += (l.unitValuePaise ?? 0) * l.qty; }
    const num = (await c.query("SELECT 'SMP-' || nextval('sample_number_seq') AS n")).rows[0].n as string;
    const so = (await c.query("INSERT INTO sample_orders (sample_number, recipient_dealer_id, recipient_name, delivery_address, status, valuation_paise, created_by) VALUES ($1,$2,$3,$4,'READY_FOR_PACKING',$5,$6) RETURNING id", [num, a.recipientDealerId ?? null, a.recipientName.trim(), a.address.trim(), String(val), a.actor.id])).rows[0];
    for (const l of a.lines) await c.query('INSERT INTO sample_order_items (sample_order_id, product_id, brand_id, custom_name, qty, valuation_paise) VALUES ($1,NULL,$2,$3,$4,$5)', [so.id, l.brandId, l.name.trim(), l.qty, String((l.unitValuePaise ?? 0) * l.qty)]);
    for (const dept of ['WAREHOUSE', 'LOGISTICS']) await c.query("INSERT INTO notifications (kind, recipient_department, payload) VALUES ('SAMPLE_ORDER',$1,$2)", [dept, JSON.stringify({ sampleId: so.id, number: num })]);
    return { id: so.id as string, number: num };
  });
  await recordActivity(pool, { actorId: a.actor.id, action: 'Sample order created', detail: out.number, kind: 'sample' }); return out;
}
