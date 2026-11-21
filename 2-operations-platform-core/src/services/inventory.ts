import type pg from 'pg';
import { tx, DomainError } from '../db.js';
import { Actor, can, assertCan } from '../permissions.js';
import { allocatePreorders } from './preorders.js';
import { recordActivity } from './activity.js';

/** Availability is visible to every authorised role; only Logistics/Warehouse may edit. Host edits need an explicit, audited override. */
/** Products that have batch records must be changed through the batch services, otherwise batch balances and the product balance would drift apart. */
async function assertNotBatched(db: pg.Pool | pg.PoolClient, productId: string) { if ((await db.query("SELECT 1 FROM inventory_batches WHERE product_id=$1 AND batch_number <> 'OPENING-LEGACY' LIMIT 1", [productId])).rowCount) throw new DomainError('USE_BATCH_INVENTORY', 'This product is batch-tracked. Use the batch Stock In / Stock Out / Adjust screens.'); }
export async function availability(pool: pg.Pool | pg.PoolClient, productIds: string[]) {
  const r = await pool.query('SELECT product_id, on_hand, reserved, damaged, on_hand - reserved AS available FROM inventory_balances WHERE product_id = ANY($1)', [productIds]);
  return Object.fromEntries(r.rows.map(x => [x.product_id, { onHand: x.on_hand as number, reserved: x.reserved as number, damaged: x.damaged as number, available: Math.max(0, x.available as number) }]));
}
function authorise(actor: Actor, opts: { hostOverride?: boolean; reason?: string }) {
  if (actor.role === 'HOST') { if (!opts.hostOverride || !opts.reason || opts.reason.trim().length < 10) throw new DomainError('OVERRIDE_REQUIRED', 'Host stock edits need hostOverride and a reason of at least 10 characters'); return true; }
  assertCan(actor, 'inventory.edit'); return false;
}
export async function receiveStock(pool: pg.Pool, a: { productId: string; qty: number; actor: Actor; reason?: string; ref?: string; hostOverride?: boolean; now?: Date }) {
  await assertNotBatched(pool, a.productId);
  if (!Number.isInteger(a.qty) || a.qty < 1) throw new DomainError('BAD_QTY', 'Quantity must be a whole number of at least 1');
  const host = authorise(a.actor, { hostOverride: a.hostOverride, reason: a.reason });
  const res = await tx(pool, async c => {
    const b = (await c.query('SELECT on_hand FROM inventory_balances WHERE product_id=$1 FOR UPDATE', [a.productId])).rows[0];
    if (!b) await c.query('INSERT INTO inventory_balances (product_id, on_hand) VALUES ($1,0) ON CONFLICT DO NOTHING', [a.productId]);
    const before = b ? (b.on_hand as number) : 0, after = before + a.qty;
    await c.query('UPDATE inventory_balances SET on_hand=$2, received_total = received_total + $3, updated_by=$4, updated_at=now() WHERE product_id=$1', [a.productId, after, a.qty, a.actor.id]);
    await c.query("INSERT INTO stock_movements (product_id, delta, kind, ref_type, ref_id, reason, actor_id, qty_before, qty_after) VALUES ($1,$2,'RECEIPT','receipt',$3,$4,$5,$6,$7)", [a.productId, a.qty, a.ref ?? null, a.reason ?? 'stock received', a.actor.id, before, after]);
    if (host) await c.query("INSERT INTO audit_logs (actor_type, actor_id, action, entity, entity_id, after) VALUES ('EMPLOYEE',$1,'INVENTORY_HOST_OVERRIDE','inventory_balances',$2,$3)", [a.actor.id, a.productId, JSON.stringify({ kind: 'RECEIPT', qty: a.qty, reason: a.reason })]);
    return { before, after };
  });
  const allocated = await allocatePreorders(pool, [a.productId], a.now ?? new Date());       // stock arrived: serve the oldest waiting preorders
  return { ...res, preordersAllocated: allocated };
}
export async function adjustStock(pool: pg.Pool, a: { productId: string; newOnHand: number; actor: Actor; reason: string; hostOverride?: boolean }) {
  await assertNotBatched(pool, a.productId);
  if (!a.reason || a.reason.trim().length < 5) throw new DomainError('REASON_REQUIRED', 'A reason is required for every stock adjustment');
  const host = authorise(a.actor, { hostOverride: a.hostOverride, reason: a.reason });
  if (a.newOnHand < 0) {   // flagged OUTSIDE the transaction so the record survives the rejection
    await pool.query("INSERT INTO notifications (kind, recipient_department, payload) VALUES ('INVENTORY_DISCREPANCY','HOST',$1)", [JSON.stringify({ productId: a.productId, attempted: a.newOnHand, by: a.actor.id, reason: a.reason })]);
    throw new DomainError('NEGATIVE_STOCK', 'Physical stock cannot be negative; the discrepancy was flagged for reconciliation');
  }
  return tx(pool, async c => {
    const b = (await c.query('SELECT on_hand, reserved FROM inventory_balances WHERE product_id=$1 FOR UPDATE', [a.productId])).rows[0];
    if (!b) throw new DomainError('NOT_FOUND', 'No stock record for this product');
    if (a.newOnHand < b.reserved) throw new DomainError('BELOW_RESERVED', `Cannot go below the ${b.reserved} units reserved for orders`);
    await c.query('UPDATE inventory_balances SET on_hand=$2, updated_by=$3, updated_at=now() WHERE product_id=$1', [a.productId, a.newOnHand, a.actor.id]);
    await c.query("INSERT INTO stock_movements (product_id, delta, kind, ref_type, reason, actor_id, qty_before, qty_after) VALUES ($1,$2,'ADJUST','adjustment',$3,$4,$5,$6)", [a.productId, a.newOnHand - b.on_hand, a.reason, a.actor.id, b.on_hand, a.newOnHand]);
    if (host) await c.query("INSERT INTO audit_logs (actor_type, actor_id, action, entity, entity_id, before, after) VALUES ('EMPLOYEE',$1,'INVENTORY_HOST_OVERRIDE','inventory_balances',$2,$3,$4)", [a.actor.id, a.productId, JSON.stringify({ onHand: b.on_hand }), JSON.stringify({ onHand: a.newOnHand, reason: a.reason })]);
    return { before: b.on_hand as number, after: a.newOnHand };
  });
}
void can;

/** Stock OUT (sent for display, internal use...). Can never take stock below what is reserved for orders. */
export async function stockOut(pool: pg.Pool, a: { productId: string; qty: number; actor: Actor; reason: string; hostOverride?: boolean }) {
  await assertNotBatched(pool, a.productId);
  if (!Number.isInteger(a.qty) || a.qty < 1) throw new DomainError('BAD_QTY', 'Quantity must be a whole number of at least 1');
  if (!a.reason || a.reason.trim().length < 5) throw new DomainError('REASON_REQUIRED', 'A reason is required for stock out');
  authorise(a.actor, { hostOverride: a.hostOverride, reason: a.reason });
  const res = await tx(pool, async c => {
    const b = (await c.query('SELECT on_hand, reserved FROM inventory_balances WHERE product_id=$1 FOR UPDATE', [a.productId])).rows[0]; if (!b) throw new DomainError('NOT_FOUND', 'No stock record for this product');
    if (a.qty > b.on_hand - b.reserved) throw new DomainError('INSUFFICIENT_AVAILABLE', `Only ${b.on_hand - b.reserved} units are available (the rest are reserved for orders)`);
    const after = b.on_hand - a.qty; await c.query('UPDATE inventory_balances SET on_hand=$2, updated_by=$3, updated_at=now() WHERE product_id=$1', [a.productId, after, a.actor.id]);
    await c.query("INSERT INTO stock_movements (product_id, delta, kind, ref_type, reason, actor_id, qty_before, qty_after) VALUES ($1,$2,'STOCK_OUT','manual',$3,$4,$5,$6)", [a.productId, -a.qty, a.reason, a.actor.id, b.on_hand, after]);
    return { before: b.on_hand as number, after };
  });
  await recordActivity(pool, { actorId: a.actor.id, action: 'Stock out', detail: `${a.qty} units: ${a.reason}`, kind: 'inventory' }); return res;
}
/** Returned goods (dealer return, wrong item) come back into saleable stock and are counted separately. */
export async function stockReturn(pool: pg.Pool, a: { productId: string; qty: number; actor: Actor; reason: string; hostOverride?: boolean; now?: Date }) {
  await assertNotBatched(pool, a.productId);
  if (!Number.isInteger(a.qty) || a.qty < 1) throw new DomainError('BAD_QTY', 'Quantity must be a whole number of at least 1');
  if (!a.reason || a.reason.trim().length < 5) throw new DomainError('REASON_REQUIRED', 'A reason is required for returned stock');
  authorise(a.actor, { hostOverride: a.hostOverride, reason: a.reason });
  const res = await tx(pool, async c => {
    const b = (await c.query('SELECT on_hand FROM inventory_balances WHERE product_id=$1 FOR UPDATE', [a.productId])).rows[0]; if (!b) throw new DomainError('NOT_FOUND', 'No stock record for this product');
    const after = b.on_hand + a.qty; await c.query('UPDATE inventory_balances SET on_hand=$2, returned_total = returned_total + $3, updated_by=$4, updated_at=now() WHERE product_id=$1', [a.productId, after, a.qty, a.actor.id]);
    await c.query("INSERT INTO stock_movements (product_id, delta, kind, ref_type, reason, actor_id, qty_before, qty_after) VALUES ($1,$2,'RETURN','manual',$3,$4,$5,$6)", [a.productId, a.qty, a.reason, a.actor.id, b.on_hand, after]);
    return { before: b.on_hand as number, after };
  });
  const allocated = await allocatePreorders(pool, [a.productId], a.now ?? new Date());
  await recordActivity(pool, { actorId: a.actor.id, action: 'Stock returned', detail: `${a.qty} units: ${a.reason}`, kind: 'inventory' }); return { ...res, preordersAllocated: allocated };
}
