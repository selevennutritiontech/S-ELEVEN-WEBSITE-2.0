import type pg from 'pg';
import { tx, DomainError } from '../db.js';
import { assertCan, can, type Actor } from '../permissions.js';
import { allocatePreorders } from './preorders.js';
import { recordActivity } from './activity.js';
type Db = pg.Pool | pg.PoolClient;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const validIso = (v: string) => ISO.test(v) && !isNaN(Date.parse(v + 'T00:00:00Z')) && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;   // rejects 2026-02-30

function mapPg(e: any): never {
  if (e?.code === '23514' && /inventory_balances/.test(String(e.constraint ?? e.table ?? e.message))) throw new DomainError('RESERVATION_CONFLICT', 'This would leave less saleable stock than is already reserved for orders. Resolve the reserved orders first.');
  if (e?.code === '23505' && /inventory_batches/.test(String(e.constraint ?? e.table ?? ''))) throw new DomainError('DUPLICATE_BATCH', 'This batch already exists at this location');
  throw e;
}
/** Stock that existed before batch tracking becomes an explicit OPENING-LEGACY batch, so it is never lost when the first real batch arrives. */
async function ensureOpeningBatch(c: pg.PoolClient, productId: string) {
  await c.query('INSERT INTO inventory_balances (product_id) VALUES ($1) ON CONFLICT (product_id) DO NOTHING', [productId]);
  const bal = (await c.query('SELECT on_hand FROM inventory_balances WHERE product_id=$1 FOR UPDATE', [productId])).rows[0];
  if ((await c.query('SELECT 1 FROM inventory_batches WHERE product_id=$1 LIMIT 1', [productId])).rowCount || bal.on_hand === 0) return;
  const b = (await c.query("INSERT INTO inventory_batches (product_id, batch_number, qty_received, qty_on_hand) VALUES ($1,'OPENING-LEGACY',$2,$2) RETURNING id", [productId, bal.on_hand])).rows[0];
  await c.query("INSERT INTO batch_movements (batch_id, product_id, kind, delta_on_hand, on_hand_before, on_hand_after, reason) VALUES ($1,$2,'OPENING',$3,0,$3,'Opening balance')", [b.id, productId, bal.on_hand]);
}
async function move(c: pg.PoolClient, b: { id: string; product_id: string }, kind: string, d: { on?: number; dmg?: number; q?: number }, before: number, after: number, a: { reason?: string; refType?: string; refId?: string; actorId?: string | null }) {
  return (await c.query('INSERT INTO batch_movements (batch_id, product_id, kind, delta_on_hand, delta_damaged, delta_quarantined, on_hand_before, on_hand_after, reason, ref_type, ref_id, actor_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id',
    [b.id, b.product_id, kind, d.on ?? 0, d.dmg ?? 0, d.q ?? 0, before, after, a.reason ?? null, a.refType ?? null, a.refId ?? null, a.actorId ?? null])).rows[0].id as number;
}
export interface ReceiveInput { productId: string; batchNumber: string; mfgDate: string; expiryDate: string; qty: number; unit?: string; supplier?: string; receiptRef?: string; unitCostPaise?: number; location?: string; documentKey?: string; now?: Date }
/** Stock IN with batch, manufacturing and expiry dates. The same product can have many batches. */
export async function receiveBatch(pool: pg.Pool, actor: Actor, a: ReceiveInput) {
  assertCan(actor, 'inventory.edit');
  if (!Number.isInteger(a.qty) || a.qty < 1 || a.qty > 1_000_000) throw new DomainError('BAD_QTY', 'Quantity must be a whole number from 1 to 1,000,000');
  if (!a.batchNumber || !a.batchNumber.trim()) throw new DomainError('BATCH_REQUIRED', 'Enter the batch number');
  if (!validIso(a.mfgDate) || !validIso(a.expiryDate)) throw new DomainError('BAD_DATE', 'Enter valid manufacturing and expiry dates');
  if (a.mfgDate > a.expiryDate) throw new DomainError('MFG_AFTER_EXPIRY', 'The manufacturing date cannot be after the expiry date');
  if (a.expiryDate < (a.now ?? new Date()).toISOString().slice(0, 10)) throw new DomainError('ALREADY_EXPIRED', 'This stock has already expired and cannot be received as saleable stock');
  const loc = a.location ?? 'MAIN';
  const out = await tx(pool, async c => {
    await ensureOpeningBatch(c, a.productId);
    const ex = (await c.query("SELECT *, to_char(mfg_date,'YYYY-MM-DD') AS mfg_s, to_char(expiry_date,'YYYY-MM-DD') AS exp_s FROM inventory_batches WHERE product_id=$1 AND batch_number=$2 AND location=$3 FOR UPDATE", [a.productId, a.batchNumber.trim(), loc])).rows[0];
    let b: any, before = 0;
    if (ex) {
      if (ex.mfg_s !== a.mfgDate || ex.exp_s !== a.expiryDate) throw new DomainError('BATCH_DATES_MISMATCH', 'This batch number exists with different manufacturing/expiry dates');
      before = ex.qty_on_hand; b = (await c.query('UPDATE inventory_batches SET qty_received=qty_received+$2, qty_on_hand=qty_on_hand+$2 WHERE id=$1 RETURNING *', [ex.id, a.qty])).rows[0];
    } else b = (await c.query('INSERT INTO inventory_batches (product_id, batch_number, location, mfg_date, expiry_date, unit, supplier, receipt_ref, unit_cost_paise, qty_received, qty_on_hand, received_by, document_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,$11,$12) RETURNING *',
      [a.productId, a.batchNumber.trim(), loc, a.mfgDate, a.expiryDate, a.unit ?? 'PCS', a.supplier ?? null, a.receiptRef ?? null, a.unitCostPaise ?? null, a.qty, actor.id, a.documentKey ?? null])).rows[0];
    await move(c, b, 'STOCK_IN', { on: a.qty }, before, before + a.qty, { reason: a.receiptRef ?? 'Stock in', refType: 'receipt', refId: a.receiptRef, actorId: actor.id }); return { batchId: b.id as string, onHand: b.qty_on_hand as number };
  }).catch(mapPg);
  await allocatePreorders(pool, [a.productId], a.now ?? new Date());
  await recordActivity(pool, { actorId: actor.id, action: 'Stock in (batch)', detail: `${a.qty} x batch ${a.batchNumber}`, kind: 'inventory' }); return out;
}
/** Stock OUT. Takes the chosen batch, or follows the allocation policy (FEFO: first expiry, first out). Only saleable batches can be issued. */
export async function issueStock(pool: pg.Pool, actor: Actor, a: { productId: string; qty: number; batchId?: string; reason: string; refType?: string; refId?: string }) {
  assertCan(actor, 'inventory.edit');
  if (!Number.isInteger(a.qty) || a.qty < 1) throw new DomainError('BAD_QTY', 'Quantity must be a whole number of at least 1');
  if (!a.reason || a.reason.trim().length < 5) throw new DomainError('REASON_REQUIRED', 'A destination or reason is required');
  const out = await tx(pool, async c => {
    await ensureOpeningBatch(c, a.productId);
    const bal = (await c.query('SELECT on_hand, reserved FROM inventory_balances WHERE product_id=$1 FOR UPDATE', [a.productId])).rows[0];     // serialises every stock change of this product
    if (a.qty > bal.on_hand - bal.reserved) throw new DomainError('INSUFFICIENT_AVAILABLE', `Only ${bal.on_hand - bal.reserved} units are available (the rest are reserved for orders)`);
    const rows = (a.batchId ? await c.query('SELECT *, (expiry_date IS NOT NULL AND expiry_date < current_date) AS is_expired FROM inventory_batches WHERE id=$1 AND product_id=$2 FOR UPDATE', [a.batchId, a.productId])
      : await c.query("SELECT *, false AS is_expired FROM inventory_batches WHERE product_id=$1 AND status='ACTIVE' AND qty_on_hand>0 AND (expiry_date IS NULL OR expiry_date >= current_date) ORDER BY expiry_date NULLS LAST, received_at, id FOR UPDATE", [a.productId])).rows; if (a.batchId && !rows.length) throw new DomainError('NOT_FOUND', 'Batch not found for this product');
    let left = a.qty; const taken: { batchId: string; batchNumber: string; qty: number }[] = [];
    for (const b of rows) {
      if (left === 0) break;
      if (b.status !== 'ACTIVE') throw new DomainError('BATCH_NOT_SALEABLE', `Batch ${b.batch_number} is ${b.status.toLowerCase()} and cannot be issued`);
      if (b.is_expired) throw new DomainError('BATCH_EXPIRED', `Batch ${b.batch_number} has expired`);
      const t = Math.min(left, b.qty_on_hand); if (t <= 0) { if (a.batchId) throw new DomainError('INSUFFICIENT_BATCH_STOCK', `Batch ${b.batch_number} has no stock`); continue; }
      if (a.batchId && a.qty > b.qty_on_hand) throw new DomainError('INSUFFICIENT_BATCH_STOCK', `Batch ${b.batch_number} has only ${b.qty_on_hand} units`);
      await c.query('UPDATE inventory_batches SET qty_on_hand = qty_on_hand - $2 WHERE id=$1', [b.id, t]); await move(c, b, 'STOCK_OUT', { on: -t }, b.qty_on_hand, b.qty_on_hand - t, { reason: a.reason, refType: a.refType ?? 'manual', refId: a.refId, actorId: actor.id });
      taken.push({ batchId: b.id, batchNumber: b.batch_number, qty: t }); left -= t;
    }
    if (left > 0) throw new DomainError('INSUFFICIENT_BATCH_STOCK', 'Not enough saleable (unexpired, active) batch stock'); return taken;
  }).catch(mapPg);
  await recordActivity(pool, { actorId: actor.id, action: 'Stock out (batch)', detail: `${a.qty} units: ${a.reason}`, kind: 'inventory' }); return out;
}
/** Called when an order is paid: converts the reservation into a real deduction. Batch-tracked products use FEFO; a shortfall never blocks the payment, it raises a Logistics/Finance alert instead. */
export async function consumeStockForSale(c: pg.PoolClient, productId: string, qty: number, orderId: string, _now: Date) {
  const batched = (await c.query('SELECT 1 FROM inventory_batches WHERE product_id=$1 LIMIT 1', [productId])).rowCount;
  const before = (await c.query('SELECT on_hand FROM inventory_balances WHERE product_id=$1 FOR UPDATE', [productId])).rows[0].on_hand as number;
  if (!batched) { await c.query('UPDATE inventory_balances SET on_hand = on_hand - $2, reserved = reserved - $2, updated_at=now() WHERE product_id=$1', [productId, qty]); }
  else {
    await c.query('UPDATE inventory_balances SET reserved = reserved - $2, updated_at=now() WHERE product_id=$1', [productId, qty]); let left = qty;
    const rows = (await c.query("SELECT * FROM inventory_batches WHERE product_id=$1 AND status='ACTIVE' AND qty_on_hand>0 AND (expiry_date IS NULL OR expiry_date >= current_date) ORDER BY expiry_date NULLS LAST, received_at, id FOR UPDATE", [productId])).rows;
    for (const b of rows) { if (!left) break; const t = Math.min(left, b.qty_on_hand); await c.query('UPDATE inventory_batches SET qty_on_hand = qty_on_hand - $2 WHERE id=$1', [b.id, t]); await move(c, b, 'ISSUE_ORDER', { on: -t }, b.qty_on_hand, b.qty_on_hand - t, { reason: 'order paid', refType: 'order', refId: orderId }); left -= t; }
    if (left > 0) await c.query("INSERT INTO notifications (kind, recipient_department, order_id, payload) VALUES ('BATCH_SHORTFALL','LOGISTICS',$1,$2), ('BATCH_SHORTFALL','FINANCE',$1,$2)", [orderId, JSON.stringify({ productId, short: left })]);
  }
  const after = (await c.query('SELECT on_hand FROM inventory_balances WHERE product_id=$1', [productId])).rows[0].on_hand as number;
  await c.query("INSERT INTO stock_movements (product_id, delta, kind, ref_type, ref_id, reason, qty_before, qty_after) VALUES ($1,$2,'SALE','order',$3,'payment verified',$4,$5)", [productId, -qty, orderId, before, after]);
}
export async function setBatchStatus(pool: pg.Pool, actor: Actor, batchId: string, status: 'ACTIVE' | 'QUARANTINED', reason: string) {
  assertCan(actor, 'inventory.edit'); if (!reason || reason.trim().length < 5) throw new DomainError('REASON_REQUIRED', 'A reason is required');
  await tx(pool, async c => { const b = (await c.query('SELECT * FROM inventory_batches WHERE id=$1 FOR UPDATE', [batchId])).rows[0]; if (!b) throw new DomainError('NOT_FOUND', 'Batch not found'); if (b.status === 'EXPIRED') throw new DomainError('BATCH_EXPIRED', 'Expired stock cannot be released');
    await c.query('SELECT 1 FROM inventory_balances WHERE product_id=$1 FOR UPDATE', [b.product_id]); await c.query('UPDATE inventory_batches SET status=$2 WHERE id=$1', [batchId, status]);
    await move(c, b, status === 'QUARANTINED' ? 'QUARANTINE' : 'RELEASE_QUARANTINE', {}, b.qty_on_hand, b.qty_on_hand, { reason, actorId: actor.id }); }).catch(mapPg);
}
export async function markBatchDamaged(pool: pg.Pool, actor: Actor, batchId: string, qty: number, reason: string) {
  assertCan(actor, 'inventory.edit'); if (!Number.isInteger(qty) || qty < 1) throw new DomainError('BAD_QTY', 'Quantity must be a whole number of at least 1'); if (!reason || reason.trim().length < 5) throw new DomainError('REASON_REQUIRED', 'A reason is required');
  await tx(pool, async c => { const b0 = (await c.query('SELECT product_id FROM inventory_batches WHERE id=$1', [batchId])).rows[0]; if (!b0) throw new DomainError('NOT_FOUND', 'Batch not found'); await c.query('SELECT 1 FROM inventory_balances WHERE product_id=$1 FOR UPDATE', [b0.product_id]);
    const b = (await c.query('SELECT * FROM inventory_batches WHERE id=$1 FOR UPDATE', [batchId])).rows[0]; if (qty > b.qty_on_hand) throw new DomainError('INSUFFICIENT_BATCH_STOCK', `Batch has only ${b.qty_on_hand} units`);
    await c.query('UPDATE inventory_batches SET qty_on_hand = qty_on_hand - $2, qty_damaged = qty_damaged + $2 WHERE id=$1', [batchId, qty]); await move(c, b, 'DAMAGE', { on: -qty, dmg: qty }, b.qty_on_hand, b.qty_on_hand - qty, { reason, actorId: actor.id }); }).catch(mapPg);
}
/** Nightly job: batches past their expiry date stop being saleable. A batch that cannot expire yet because orders have reserved it is reported, not forced. */
export async function expireBatches(pool: pg.Pool) {
  const due = (await pool.query("SELECT id FROM inventory_batches WHERE status='ACTIVE' AND expiry_date < current_date")).rows; let expired = 0, conflicts = 0;
  for (const r of due) { try { await tx(pool, async c => { const b0 = (await c.query('SELECT product_id FROM inventory_batches WHERE id=$1', [r.id])).rows[0]; await c.query('SELECT 1 FROM inventory_balances WHERE product_id=$1 FOR UPDATE', [b0.product_id]); const b = (await c.query('SELECT * FROM inventory_batches WHERE id=$1 FOR UPDATE', [r.id])).rows[0]; if (b.status !== 'ACTIVE') return;
    await c.query("UPDATE inventory_batches SET status='EXPIRED' WHERE id=$1", [r.id]); await move(c, b, 'EXPIRE', {}, b.qty_on_hand, b.qty_on_hand, { reason: 'Passed expiry date' }); }); expired++; } catch { conflicts++; await pool.query("INSERT INTO notifications (kind, recipient_department, payload) VALUES ('EXPIRY_CONFLICT','FINANCE',$1)", [JSON.stringify({ batchId: r.id })]); } }
  return { expired, conflicts };
}
/** Physical count or manual adjustment: ONLY a request. Nothing changes until an approver (not the requester) approves; then one immutable movement is posted. */
export async function requestAdjustment(pool: pg.Pool, actor: Actor, a: { batchId: string; newQty: number; reason: string; kind?: 'COUNT' | 'ADJUST'; documentKey?: string }) {
  assertCan(actor, 'inventory.edit'); if (!Number.isInteger(a.newQty) || a.newQty < 0) throw new DomainError('BAD_QTY', 'The quantity must be zero or more'); if (!a.reason || a.reason.trim().length < 5) throw new DomainError('REASON_REQUIRED', 'Record the reason for the variance');
  const b = (await pool.query('SELECT id, product_id, qty_on_hand FROM inventory_batches WHERE id=$1', [a.batchId])).rows[0]; if (!b) throw new DomainError('NOT_FOUND', 'Batch not found');
  const r = (await pool.query("INSERT INTO stock_adjustment_requests (kind, batch_id, product_id, system_qty, new_qty, reason, document_key, requested_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id", [a.kind ?? 'ADJUST', b.id, b.product_id, b.qty_on_hand, a.newQty, a.reason.trim(), a.documentKey ?? null, actor.id])).rows[0];
  return { requestId: r.id as string, systemQty: b.qty_on_hand as number, variance: a.newQty - b.qty_on_hand };
}
export async function decideAdjustment(pool: pg.Pool, actor: Actor, requestId: string, approve: boolean, note: string) {
  assertCan(actor, 'inventory.approve'); if (!note || note.trim().length < 3) throw new DomainError('NOTE_REQUIRED', 'Add a decision note');
  const res = await tx(pool, async c => {
    const r = (await c.query('SELECT * FROM stock_adjustment_requests WHERE id=$1 FOR UPDATE', [requestId])).rows[0]; if (!r) throw new DomainError('NOT_FOUND', 'Request not found');
    if (!['PENDING', 'CONFLICT'].includes(r.status)) return { already: true as const, status: r.status as string };
    if (r.requested_by === actor.id && actor.role !== 'HOST') throw new DomainError('SELF_APPROVAL', 'The person who requested an adjustment cannot approve it');
    if (!approve) { await c.query("UPDATE stock_adjustment_requests SET status='REJECTED', decided_by=$2, decided_at=now(), decision_note=$3 WHERE id=$1", [requestId, actor.id, note]); return { already: false as const, status: 'REJECTED' }; }
    await c.query('SELECT 1 FROM inventory_balances WHERE product_id=$1 FOR UPDATE', [r.product_id]); const b = (await c.query('SELECT * FROM inventory_batches WHERE id=$1 FOR UPDATE', [r.batch_id])).rows[0];
    if (b.qty_on_hand !== r.system_qty) { await c.query("UPDATE stock_adjustment_requests SET status='CONFLICT', decision_note=$2 WHERE id=$1", [requestId, 'Stock moved since the request was made. Recount.']); return { already: false as const, status: 'CONFLICT' }; }
    const delta = r.new_qty - b.qty_on_hand; await c.query('UPDATE inventory_batches SET qty_on_hand=$2 WHERE id=$1', [b.id, r.new_qty]);
    const mv = await move(c, b, r.kind === 'COUNT' ? 'COUNT_ADJUSTMENT' : 'ADJUSTMENT', { on: delta }, b.qty_on_hand, r.new_qty, { reason: r.reason, refType: 'adjustment_request', refId: requestId, actorId: actor.id });
    await c.query("UPDATE stock_adjustment_requests SET status='APPROVED', decided_by=$2, decided_at=now(), decision_note=$3, movement_id=$4 WHERE id=$1", [requestId, actor.id, note, mv]); return { already: false as const, status: 'APPROVED' };
  }).catch(async (e: any) => { try { mapPg(e); } catch (m) { if (m instanceof DomainError && m.code === 'RESERVATION_CONFLICT') await pool.query("UPDATE stock_adjustment_requests SET status='CONFLICT', decision_note='Reserved stock conflict: resolve the reserved orders first' WHERE id=$1", [requestId]); throw m; } });
  return res!;
}
/** Dealers and Sales see only the status. Costs are returned only to roles with inventory.cost.read. */
export async function batchInventoryView(pool: pg.Pool, actor: Actor, productId?: string) {
  assertCan(actor, 'inventory.read'); const rows = (await pool.query("SELECT b.id, p.sku, p.name, b.batch_number, b.location, b.mfg_date, b.expiry_date, b.unit, b.qty_received, b.qty_on_hand, b.qty_damaged, b.qty_quarantined, b.status, b.unit_cost_paise FROM inventory_batches b JOIN products p ON p.id=b.product_id WHERE ($1::uuid IS NULL OR b.product_id=$1) ORDER BY p.sku, b.expiry_date NULLS LAST, b.batch_number", [productId ?? null])).rows;
  const cost = can(actor, 'inventory.cost.read'); return rows.map(r => { const { unit_cost_paise, ...rest } = r; return cost ? { ...rest, unit_cost_paise } : rest; });
}
export type StockStatus = 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK' | 'EXPIRED' | 'QUARANTINED' | 'PREORDER_AVAILABLE';
export async function stockStatus(db: Db, productId: string, lowAt = 10): Promise<StockStatus> {
  const b = (await db.query('SELECT on_hand, reserved FROM inventory_balances WHERE product_id=$1', [productId])).rows[0], avail = b ? b.on_hand - b.reserved : 0;
  if (avail > lowAt) return 'IN_STOCK'; if (avail > 0) return 'LOW_STOCK';
  const o = (await db.query("SELECT bool_or(status='EXPIRED') AS ex, bool_or(status='QUARANTINED') AS qu FROM inventory_batches WHERE product_id=$1 AND qty_on_hand > 0", [productId])).rows[0];
  return o?.qu ? 'QUARANTINED' : o?.ex ? 'EXPIRED' : 'OUT_OF_STOCK';
}
