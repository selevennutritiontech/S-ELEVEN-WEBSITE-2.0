import type pg from 'pg';
import { tx, DomainError } from '../db.js';
import { roundDiv } from '../money.js';
import { resolvePrice, PriceRule } from '../pricing.js';
import { Actor, assertCan, can } from '../permissions.js';

const ds = (b: bigint) => b.toString();
async function setting(c: pg.Pool | pg.PoolClient, key: string) { return (await c.query('SELECT value FROM app_settings WHERE key=$1', [key])).rows[0].value as any; }

/** Pre-order (pay later): for products that are out of stock and have preorders enabled. Pricing is snapshotted now; nothing is paid, reserved or credited yet. */
export async function createPreorder(pool: pg.Pool, a: { dealerId: string; actor: Actor; items: { productId: string; qty: number }[]; idempotencyKey: string; expectedAvailability?: string; now?: Date }) {
  assertCan(a.actor, a.actor.role === 'DEALER' ? 'preorder.create.own' : 'preorder.create'); if (a.actor.role === 'DEALER' && a.actor.id !== a.dealerId) throw new DomainError('FORBIDDEN', 'A dealer can only create their own preorders');
  const now = a.now ?? new Date();
  return tx(pool, async c => {
    const dup = await c.query('SELECT id, preorder_number FROM preorders WHERE dealer_id=$1 AND idempotency_key=$2', [a.dealerId, a.idempotencyKey]); if (dup.rowCount) return { duplicate: true, id: dup.rows[0].id as string, number: dup.rows[0].preorder_number as string };
    const dealer = (await c.query('SELECT * FROM dealers WHERE id=$1', [a.dealerId])).rows[0]; if (!dealer || dealer.status !== 'ACTIVE') throw new DomainError('DEALER_INACTIVE', 'Dealer is not active');
    if (!a.items.length) throw new DomainError('EMPTY_ORDER', 'Add at least one product');
    const rules: PriceRule[] = (await c.query('SELECT * FROM dealer_price_rules WHERE dealer_id=$1', [a.dealerId])).rows.map(r => ({ productId: r.product_id, brandId: r.brand_id, discountBp: r.discount_bp, fixedPaise: r.fixed_price_paise, from: r.effective_from, to: r.effective_to }));
    const num = (await c.query("SELECT 'PO-' || to_char($1::timestamptz AT TIME ZONE 'Asia/Kolkata','YYMMDD') || '-' || nextval('preorder_number_seq') AS n", [now])).rows[0].n as string;
    const pre = (await c.query('INSERT INTO preorders (preorder_number, dealer_id, created_by_employee_id, sales_employee_id, needs_manual_attribution, idempotency_key, expected_availability, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',
      [num, a.dealerId, a.actor.type === 'EMPLOYEE' ? a.actor.id : null, dealer.sales_employee_id, !dealer.sales_employee_id, a.idempotencyKey, a.expectedAvailability ?? null, now])).rows[0];
    for (const it of a.items) {
      if (!Number.isInteger(it.qty) || it.qty < 1) throw new DomainError('BAD_QTY', 'Bad quantity');
      const p = (await c.query('SELECT p.*, COALESCE(ib.on_hand - ib.reserved, 0) AS avail FROM products p LEFT JOIN inventory_balances ib ON ib.product_id=p.id WHERE p.id=$1 AND p.active', [it.productId])).rows[0];
      if (!p) throw new DomainError('UNKNOWN_PRODUCT', 'Product not found'); if (!p.allow_preorder) throw new DomainError('PREORDER_NOT_ALLOWED', `${p.name} cannot be preordered`);
      if (Number(p.avail) >= it.qty) throw new DomainError('STOCK_AVAILABLE_USE_ORDER_NOW', `${p.name} is in stock: use Order Now`);
      const pr = resolvePrice({ basePaise: p.base_price_paise, productId: p.id, brandId: p.brand_id }, rules, now);
      await c.query('INSERT INTO preorder_items (preorder_id, product_id, qty, base_price_paise, discount_bp, unit_price_paise, price_source) VALUES ($1,$2,$3,$4,$5,$6,$7)', [pre.id, p.id, it.qty, ds(p.base_price_paise), pr.discountBp, ds(pr.unitPaise), pr.source]);
    }
    return { duplicate: false, id: pre.id as string, number: num };
  });
}

/** Stock became available: allocate to the OLDEST waiting preorders that can be fully served, reserve atomically, create a payable order, notify the dealer and the Sales owner. */
export async function allocatePreorders(pool: pg.Pool, productIds: string[] | undefined, now: Date): Promise<number> {
  const cfg = await setting(pool, 'preorder');
  const ids = (await pool.query(`SELECT p.id FROM preorders p WHERE p.status='WAITING_STOCK' AND ($1::uuid[] IS NULL OR EXISTS (SELECT 1 FROM preorder_items i WHERE i.preorder_id=p.id AND i.product_id = ANY($1))) ORDER BY p.created_at, p.id`, [productIds ?? null])).rows.map(r => r.id as string);
  let n = 0;
  for (const id of ids) {
    try {
      await tx(pool, async c => {
        const p = (await c.query("SELECT * FROM preorders WHERE id=$1 AND status='WAITING_STOCK' FOR UPDATE", [id])).rows[0]; if (!p) return;
        const items = (await c.query('SELECT i.*, pr.sku, pr.name, pr.brand_id, pr.gst_rate_bp, b.code AS brand_code FROM preorder_items i JOIN products pr ON pr.id=i.product_id JOIN brands b ON b.id=pr.brand_id WHERE i.preorder_id=$1 ORDER BY i.product_id', [id])).rows;
        for (const it of items) { const r = await c.query('UPDATE inventory_balances SET reserved = reserved + $2, updated_at=now() WHERE product_id=$1 AND on_hand - reserved >= $2', [it.product_id, it.qty]); if (!r.rowCount) throw new DomainError('NOT_ENOUGH_YET'); }
        let merch = 0n, tax = 0n; const rows = items.map(it => { const line = (it.unit_price_paise as bigint) * BigInt(it.qty), base = roundDiv(line * 10000n, 10000n + BigInt(it.gst_rate_bp)), t = line - base; merch += line; tax += t; return { it, line, t }; });
        const num = (await c.query("SELECT 'SE-' || to_char($1::timestamptz AT TIME ZONE 'Asia/Kolkata','YYMMDD') || '-' || nextval('order_number_seq') AS n", [now])).rows[0].n;
        const expires = new Date(now.getTime() + cfg.paymentWindowMinutes * 60000);
        const o = (await c.query(`INSERT INTO orders (order_number, dealer_id, created_by_employee_id, sales_employee_id, needs_manual_attribution, idempotency_key, merchandise_paise, tax_paise, total_paise, expires_at, created_at, source)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$7,$9,$10,'PREORDER') RETURNING id`, [num, p.dealer_id, p.created_by_employee_id, p.sales_employee_id, p.needs_manual_attribution, 'preorder:' + id, ds(merch), ds(tax), expires, now])).rows[0];
        for (const r of rows) {
          await c.query(`INSERT INTO order_items (order_id, product_id, sku, name, brand_id, brand_code, qty, base_price_paise, discount_bp, unit_price_paise, price_source, gst_rate_bp, line_total_paise, tax_paise, eligible_paise)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`, [o.id, r.it.product_id, r.it.sku, r.it.name, r.it.brand_id, r.it.brand_code, r.it.qty, ds(r.it.base_price_paise), r.it.discount_bp, ds(r.it.unit_price_paise), r.it.price_source, r.it.gst_rate_bp, ds(r.line), ds(r.t), ds(r.line - r.t)]);
          await c.query('INSERT INTO inventory_reservations (order_id, product_id, qty) VALUES ($1,$2,$3)', [o.id, r.it.product_id, r.it.qty]);
        }
        await c.query("INSERT INTO order_status_history (order_id, from_status, to_status, actor_type, reason) VALUES ($1,NULL,'PENDING_PAYMENT','SYSTEM','preorder stock allocated')", [o.id]);
        await c.query("UPDATE preorders SET status='ALLOCATED', order_id=$2, allocated_at=$3 WHERE id=$1", [id, o.id, now]);
        await c.query("INSERT INTO notifications (kind, order_id, recipient_dealer_id, payload) VALUES ('PREORDER_STOCK_READY',$1,$2,$3)", [o.id, p.dealer_id, JSON.stringify({ preorder: p.preorder_number, order: num, payBefore: expires.toISOString() })]);
        if (p.sales_employee_id) await c.query("INSERT INTO notifications (kind, order_id, recipient_employee_id, payload) VALUES ('PREORDER_ALLOCATED',$1,$2,$3)", [o.id, p.sales_employee_id, JSON.stringify({ preorder: p.preorder_number })]);
        n++;
      });
    } catch (e: any) { if (e?.code !== 'NOT_ENOUGH_YET') throw e; }
  }
  return n;
}

/** Keeps preorders in step with their orders: paid -> PAID, expired/cancelled -> released and the stock is offered to the next waiting preorder. */
export async function syncPreorders(pool: pg.Pool, now: Date) {
  const paid = await pool.query("UPDATE preorders p SET status='PAID' FROM orders o WHERE p.order_id=o.id AND p.status='ALLOCATED' AND o.paid_at IS NOT NULL");
  const lost = await pool.query("UPDATE preorders p SET status='EXPIRED' FROM orders o WHERE p.order_id=o.id AND p.status='ALLOCATED' AND o.status IN ('EXPIRED','CANCELLED')");
  const reallocated = (lost.rowCount ?? 0) ? await allocatePreorders(pool, undefined, now) : 0;
  return { paid: paid.rowCount ?? 0, expired: lost.rowCount ?? 0, reallocated };
}
/** Payment reminders for allocated preorders: every `reminderMinutes` while the order is unpaid; they stop by themselves once paid, expired or cancelled. */
export async function preorderReminderTick(pool: pg.Pool, now: Date): Promise<number> {
  const cfg = await setting(pool, 'preorder'), every = cfg.reminderMinutes * 60000;
  const rows = (await pool.query("SELECT p.id, p.dealer_id, p.sales_employee_id, p.allocated_at, o.id AS order_id FROM preorders p JOIN orders o ON o.id=p.order_id WHERE p.status='ALLOCATED' AND o.status='PENDING_PAYMENT' AND o.expires_at > $1", [now])).rows; let n = 0;
  for (const r of rows) {
    const slot = Math.floor((now.getTime() - r.allocated_at.getTime()) / every); if (slot < 1) continue;
    const ins = await pool.query("INSERT INTO notifications (kind, order_id, slot, recipient_dealer_id, recipient_employee_id) VALUES ('PREORDER_PAYMENT_REMINDER',$1,$2,$3,$4) ON CONFLICT (order_id, kind, slot) WHERE slot IS NOT NULL DO NOTHING", [r.order_id, slot, r.dealer_id, r.sales_employee_id]); n += ins.rowCount || 0;
  }
  return n;
}
export async function cancelPreorder(pool: pg.Pool, id: string, actor: Actor) {
  return tx(pool, async c => {
    const p = (await c.query('SELECT * FROM preorders WHERE id=$1 FOR UPDATE', [id])).rows[0]; if (!p) throw new DomainError('NOT_FOUND', 'Preorder not found');
    if (actor.role === 'DEALER' ? actor.id !== p.dealer_id : !can(actor, 'preorder.create')) throw new DomainError('FORBIDDEN', 'Not allowed');
    if (p.status !== 'WAITING_STOCK') throw new DomainError('NOT_CANCELLABLE', 'Only waiting preorders can be cancelled here'); await c.query("UPDATE preorders SET status='CANCELLED' WHERE id=$1", [id]);
  });
}
