import type pg from 'pg';
import { tx, DomainError } from '../db.js';
import { Actor, assertCan } from '../permissions.js';
import { transition } from './orders.js';
import { assertTransition } from '../stateMachine.js';

/** Start Packing: builds the checklist (every product line AND every freebie) and moves the order to PACKING_IN_PROGRESS. */
export async function startPacking(pool: pg.Pool, orderId: string, actor: Actor) {
  assertCan(actor, 'packing.update');
  return tx(pool, async c => {
    await transition(c, orderId, 'PACKING_IN_PROGRESS', { type: 'EMPLOYEE', id: actor.id });
    await c.query("INSERT INTO packing_items (order_id, source, ref_id, product_id, sku, name, required_qty) SELECT order_id, 'ITEM', id, product_id, sku, name, qty FROM order_items WHERE order_id=$1 ON CONFLICT DO NOTHING", [orderId]);
    await c.query("INSERT INTO packing_items (order_id, source, ref_id, product_id, sku, name, required_qty) SELECT f.order_id, 'FREEBIE', f.id, f.product_id, p.sku, p.name || ' (freebie)', f.qty FROM order_freebies f JOIN products p ON p.id=f.product_id WHERE f.order_id=$1 ON CONFLICT DO NOTHING", [orderId]);
  });
}
export async function packingChecklist(pool: pg.Pool, orderId: string) {
  return (await pool.query(`SELECT i.id, i.source, i.sku, i.name, p.image_url, i.required_qty, i.verified_qty, i.verified_by, i.verified_at,
    (SELECT COUNT(*)::int FROM packing_discrepancies d WHERE d.packing_item_id=i.id AND d.resolved_at IS NULL) AS open_discrepancies FROM packing_items i JOIN products p ON p.id=i.product_id WHERE i.order_id=$1 ORDER BY i.source, i.name`, [orderId])).rows;
}
/** The employee physically checks and enters the packed quantity for each line: ticking one box can never vouch for several units. */
export async function verifyItem(pool: pg.Pool, a: { orderId: string; packingItemId: string; verifiedQty: number; actor: Actor }) {
  assertCan(a.actor, 'packing.update');
  return tx(pool, async c => {
    const o = (await c.query('SELECT status FROM orders WHERE id=$1', [a.orderId])).rows[0]; if (!o || o.status !== 'PACKING_IN_PROGRESS') throw new DomainError('NOT_PACKING', 'Start packing before verifying items');
    const it = (await c.query('SELECT required_qty FROM packing_items WHERE id=$1 AND order_id=$2 FOR UPDATE', [a.packingItemId, a.orderId])).rows[0]; if (!it) throw new DomainError('NOT_FOUND', 'Item not on this order');
    if (!Number.isInteger(a.verifiedQty) || a.verifiedQty < 0 || a.verifiedQty > it.required_qty) throw new DomainError('BAD_QTY', `Verified quantity must be between 0 and ${it.required_qty}`);
    await c.query('UPDATE packing_items SET verified_qty=$2, verified_by=$3, verified_at=now() WHERE id=$1', [a.packingItemId, a.verifiedQty, a.actor.id]);
  });
}
export async function reportDiscrepancy(pool: pg.Pool, a: { orderId: string; packingItemId: string; kind: 'MISSING' | 'DAMAGED' | 'SHORT'; qty: number; note?: string; actor: Actor }) {
  assertCan(a.actor, 'packing.update');
  return tx(pool, async c => {
    const id = (await c.query('INSERT INTO packing_discrepancies (order_id, packing_item_id, kind, qty, note, reported_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id', [a.orderId, a.packingItemId, a.kind, a.qty, a.note ?? null, a.actor.id])).rows[0].id as string;
    await c.query("INSERT INTO notifications (kind, recipient_department, order_id, payload) VALUES ('PACKING_DISCREPANCY','HOST',$1,$2)", [a.orderId, JSON.stringify({ kind: a.kind, qty: a.qty, note: a.note ?? '' })]);   // supervisor is told; the order stays incomplete
    return id;
  });
}
export async function resolveDiscrepancy(pool: pg.Pool, id: string, actor: Actor) { assertCan(actor, 'packing.update'); await pool.query('UPDATE packing_discrepancies SET resolved_at=now(), resolved_by=$2 WHERE id=$1 AND resolved_at IS NULL', [id, actor.id]); }
/** Mark as Packed is possible only when EVERY required quantity is verified and no discrepancy is open. */
export async function markPacked(pool: pg.Pool, orderId: string, actor: Actor, note?: string) {
  assertCan(actor, 'packing.update');
  return tx(pool, async c => {
    const o = (await c.query('SELECT status FROM orders WHERE id=$1 FOR UPDATE', [orderId])).rows[0]; if (!o) throw new DomainError('NOT_FOUND', 'Order not found'); assertTransition(o.status, 'PACKED_READY');
    const open = (await c.query('SELECT name, required_qty, verified_qty FROM packing_items WHERE order_id=$1 AND verified_qty < required_qty', [orderId])).rows;
    const disc = (await c.query('SELECT 1 FROM packing_discrepancies WHERE order_id=$1 AND resolved_at IS NULL', [orderId])).rowCount ?? 0;
    const total = (await c.query('SELECT COUNT(*)::int AS n FROM packing_items WHERE order_id=$1', [orderId])).rows[0].n as number;
    if (!total || open.length || disc) throw new DomainError('PACKING_INCOMPLETE', 'Every item must be fully verified and every discrepancy resolved', { outstanding: open, openDiscrepancies: disc });
    await transition(c, orderId, 'PACKED_READY', { type: 'EMPLOYEE', id: actor.id });
    await c.query("INSERT INTO packing_records (order_id, status, packed_by, packed_at, discrepancy_note) VALUES ($1,'PACKED',$2,now(),$3) ON CONFLICT (order_id) DO UPDATE SET status='PACKED', packed_by=$2, packed_at=now(), discrepancy_note=$3", [orderId, actor.id, note ?? null]);
  });
}
