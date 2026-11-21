import type pg from 'pg';
import { tx, DomainError } from '../db.js';
import { roundDiv, allocate } from '../money.js';
import { evaluatePromo, loadPromoByCode, promoUsage, freebieEligibility, Promo, Line } from '../promotions.js';
import { resolvePrice, PriceRule } from '../pricing.js';
import { allowanceFor, validatePicks, Pick } from '../freebies.js';
import { assertTransition, OrderStatus } from '../stateMachine.js';

export interface CreateOrderInput {
  dealerId: string; actor: { type: 'DEALER' | 'EMPLOYEE'; id: string; role?: string }; couponCode?: string;
  /** Any price a client sends is IGNORED: the server computes every price. */
  items: { productId: string; qty: number; [ignored: string]: unknown }[];
  freebies?: { schemeProductId: string; qty: number }[]; shippingPaise?: bigint; idempotencyKey: string; now?: Date; ttlMinutes?: number;
}
const ds = (b: bigint) => b.toString();

export async function transition(c: pg.PoolClient, orderId: string, to: OrderStatus, actor: { type: string; id: string | null }, reason?: string) {
  const r = await c.query('SELECT status FROM orders WHERE id=$1 FOR UPDATE', [orderId]);
  if (!r.rowCount) throw new DomainError('NOT_FOUND', 'Order not found');
  const from = r.rows[0].status as OrderStatus; assertTransition(from, to);
  await c.query('UPDATE orders SET status=$2 WHERE id=$1', [orderId, to]);
  await c.query('INSERT INTO order_status_history (order_id, from_status, to_status, actor_type, actor_id, reason) VALUES ($1,$2,$3,$4,$5,$6)', [orderId, from, to, actor.type, actor.id, reason ?? null]);
}

export async function createOrder(pool: pg.Pool, input: CreateOrderInput) {
  const now = input.now ?? new Date();
  return tx(pool, async (c) => {
    const dup = await c.query('SELECT id, order_number, total_paise, status FROM orders WHERE dealer_id=$1 AND idempotency_key=$2', [input.dealerId, input.idempotencyKey]);
    if (dup.rowCount) return { duplicate: true, orderId: dup.rows[0].id as string, orderNumber: dup.rows[0].order_number as string, totalPaise: dup.rows[0].total_paise as bigint };
    const dealer = (await c.query('SELECT * FROM dealers WHERE id=$1', [input.dealerId])).rows[0];
    if (!dealer || dealer.status !== 'ACTIVE') throw new DomainError('DEALER_INACTIVE', 'Dealer is not active');
    if (!input.items.length) throw new DomainError('EMPTY_ORDER', 'Add at least one product');
    const qtyBy = new Map<string, number>(); for (const i of input.items) { if (!Number.isInteger(i.qty) || i.qty < 1 || i.qty > 10000) throw new DomainError('BAD_QTY', 'Quantity must be 1 to 10000'); qtyBy.set(i.productId, (qtyBy.get(i.productId) || 0) + i.qty); }
    const prods = (await c.query('SELECT p.*, b.code AS brand_code FROM products p JOIN brands b ON b.id=p.brand_id WHERE p.id = ANY($1) AND p.active ORDER BY p.id', [[...qtyBy.keys()]])).rows;
    if (prods.length !== qtyBy.size) throw new DomainError('UNKNOWN_PRODUCT', 'A product is missing or inactive');
    const allowedBrands = (await c.query('SELECT brand_id FROM dealer_brands WHERE dealer_id=$1', [input.dealerId])).rows.map(r => r.brand_id);
    if (allowedBrands.length && prods.some(p => !allowedBrands.includes(p.brand_id))) throw new DomainError('BRAND_NOT_ALLOWED', 'A product is not available to this dealer');
    const rules: PriceRule[] = (await c.query('SELECT * FROM dealer_price_rules WHERE dealer_id=$1', [input.dealerId])).rows.map(r => ({ productId: r.product_id, brandId: r.brand_id, discountBp: r.discount_bp, fixedPaise: r.fixed_price_paise, from: r.effective_from, to: r.effective_to }));
    let merch = 0n; const lines = prods.map(p => { const qty = qtyBy.get(p.id)!, pr = resolvePrice({ basePaise: p.base_price_paise, productId: p.id, brandId: p.brand_id }, rules, now), line = pr.unitPaise * BigInt(qty); merch += line; return { p, qty, pr, line, disc: 0n, tax: 0n, eligible: 0n }; });
    const plines: Line[] = lines.map(l => ({ id: l.p.id, productId: l.p.id, brandId: l.p.brand_id, qty: l.qty, totalPaise: l.line }));
    // coupon: validated here, on the server, against the authoritative cart
    let promo: Promo | null = null, couponDiscount = 0n, blocked = new Set<string>();
    if (input.couponCode) {
      promo = await loadPromoByCode(c, input.couponCode); if (!promo) throw new DomainError('COUPON_INVALID', 'This coupon code is not valid');
      const u = await promoUsage(c, promo.id, input.dealerId), res = evaluatePromo(promo, { dealerId: input.dealerId, lines: plines, now, usedTotal: u.total, usedByDealer: u.byDealer });
      if (!res.ok) throw new DomainError('COUPON_' + res.reason, res.message);
      couponDiscount = res.discountPaise; if (res.blocksFreebies) blocked = new Set(res.touched);
      const touched = lines.filter(l => res.touched.includes(l.p.id)), parts = allocate(couponDiscount, touched.map(l => l.line)); touched.forEach((l, i) => { l.disc = parts[i]; });
    }
    let tax = 0n; for (const l of lines) { const net = l.line - l.disc, base = roundDiv(net * 10000n, 10000n + BigInt(l.p.gst_rate_bp)); l.tax = net - base; l.eligible = base; tax += l.tax; }
    // freebies: eligibility is decided per order line; excluded lines do not count towards the qualifying value
    const ex = (await c.query('SELECT product_id, brand_id, dealer_id FROM freebie_exclusions')).rows;
    const fe = freebieEligibility(plines, blocked, { productIds: new Set(ex.filter(x => x.product_id).map(x => x.product_id as string)), brandIds: new Set(ex.filter(x => x.brand_id).map(x => x.brand_id as string)), dealerBlocked: ex.some(x => x.dealer_id === input.dealerId) });
    const fbBase = lines.filter(l => fe.get(l.p.id)!.eligible).reduce((a, l) => a + l.line, 0n);
    const slabs = (await c.query('SELECT min_cart_paise, max_allowance_paise FROM freebie_slabs WHERE active')).rows.map(r => ({ minCartPaise: r.min_cart_paise as bigint, maxAllowancePaise: r.max_allowance_paise as bigint }));
    const allowance = allowanceFor(slabs, fbBase); const wanted = input.freebies ?? []; let freebieValue = 0n; const fbRows: { sp: any; qty: number }[] = [];
    if (wanted.length) {
      const sps = (await c.query(`SELECT sp.id AS sp_id, sp.product_id, sp.valuation_paise, sp.max_qty_per_order, s.id AS scheme_id, s.min_cart_paise, s.max_allowance_paise,
        COALESCE(ib.on_hand - ib.reserved, 0) AS avail FROM freebie_scheme_products sp JOIN freebie_schemes s ON s.id=sp.scheme_id LEFT JOIN inventory_balances ib ON ib.product_id=sp.product_id
        WHERE sp.id = ANY($1) AND s.active AND s.starts_at<=$2 AND s.ends_at>$2 AND (s.all_dealers OR EXISTS (SELECT 1 FROM freebie_scheme_dealers d WHERE d.scheme_id=s.id AND d.dealer_id=$3))`, [wanted.map(w => w.schemeProductId), now, input.dealerId])).rows;
      const picks: Pick[] = wanted.map(w => {
        const sp = sps.find(x => x.sp_id === w.schemeProductId); if (!sp) throw new DomainError('FREEBIE_NOT_ELIGIBLE', 'This freebie is not available to the dealer');
        if (fbBase === 0n) throw new DomainError('FREEBIE_EXCLUDED', 'None of the products in this order can receive freebies');
        if (fbBase < sp.min_cart_paise) throw new DomainError('FREEBIE_NOT_QUALIFIED', 'Cart value is below the scheme minimum');
        if (!Number.isInteger(w.qty) || w.qty < 1) throw new DomainError('BAD_QTY', 'Bad freebie quantity'); fbRows.push({ sp, qty: w.qty });
        return { schemeId: sp.scheme_id, valuationPaise: sp.valuation_paise, qty: w.qty, maxQty: sp.max_qty_per_order, schemeCapPaise: sp.max_allowance_paise, stockAvailable: Number(sp.avail) };
      });
      freebieValue = validatePicks(allowance, picks).used;
    }
    const reserve = new Map<string, number>(); const need = new Map<string, { qty: number; free: boolean }[]>();
    const add = (pid: string, qty: number, free: boolean) => { reserve.set(pid, (reserve.get(pid) || 0) + qty); const l = need.get(pid) || []; l.push({ qty, free }); need.set(pid, l); };
    lines.forEach(l => add(l.p.id, l.qty, false)); fbRows.forEach(f => add(f.sp.product_id, f.qty, true));
    for (const pid of [...reserve.keys()].sort()) {
      const r = await c.query('UPDATE inventory_balances SET reserved = reserved + $2, updated_at = now() WHERE product_id=$1 AND on_hand - reserved >= $2', [pid, reserve.get(pid)]);
      if (!r.rowCount) throw new DomainError('INSUFFICIENT_STOCK', 'Not enough stock available', { productId: pid });
    }
    const shipping = input.shippingPaise ?? 0n, total = merch - couponDiscount + shipping;   // freebies never add to the payable amount
    const num = (await c.query("SELECT 'SE-' || to_char($1::timestamptz AT TIME ZONE 'Asia/Kolkata','YYMMDD') || '-' || nextval('order_number_seq') AS n", [now])).rows[0].n;
    const expires = new Date(now.getTime() + (input.ttlMinutes ?? 30) * 60000);
    const order = (await c.query(`INSERT INTO orders (order_number, dealer_id, created_by_employee_id, sales_employee_id, needs_manual_attribution, idempotency_key, merchandise_paise, tax_paise, shipping_paise, freebie_value_paise, total_paise, expires_at, created_at, coupon_code, coupon_discount_paise, created_by_role)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`, [num, input.dealerId, input.actor.type === 'EMPLOYEE' ? input.actor.id : null, dealer.sales_employee_id, !dealer.sales_employee_id, input.idempotencyKey, ds(merch), ds(tax), ds(shipping), ds(freebieValue), ds(total), expires, now, promo ? promo.code : null, ds(couponDiscount), input.actor.role ?? input.actor.type])).rows[0];
    for (const l of lines) { const f = fe.get(l.p.id)!; await c.query(`INSERT INTO order_items (order_id, product_id, sku, name, brand_id, brand_code, qty, base_price_paise, discount_bp, unit_price_paise, price_source, gst_rate_bp, line_total_paise, tax_paise, eligible_paise, discount_paise, freebie_eligible, freebie_block_reason)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`, [order.id, l.p.id, l.p.sku, l.p.name, l.p.brand_id, l.p.brand_code, l.qty, ds(l.p.base_price_paise), l.pr.discountBp, ds(l.pr.unitPaise), l.pr.source, l.p.gst_rate_bp, ds(l.line), ds(l.tax), ds(l.eligible), ds(l.disc), f.eligible, f.reason]); }
    for (const f of fbRows) await c.query('INSERT INTO order_freebies (order_id, scheme_id, product_id, qty, valuation_paise) VALUES ($1,$2,$3,$4,$5)', [order.id, f.sp.scheme_id, f.sp.product_id, f.qty, ds(f.sp.valuation_paise)]);
    for (const [pid, parts] of need) for (const free of [false, true]) { const q = parts.filter(x => x.free === free).reduce((a, b) => a + b.qty, 0); if (q) await c.query('INSERT INTO inventory_reservations (order_id, product_id, qty, is_freebie) VALUES ($1,$2,$3,$4)', [order.id, pid, q, free]); }
    if (promo) await c.query('INSERT INTO promotion_redemptions (promotion_id, order_id, dealer_id, amount_paise) VALUES ($1,$2,$3,$4)', [promo.id, order.id, input.dealerId, ds(couponDiscount)]);
    await c.query("INSERT INTO order_status_history (order_id, from_status, to_status, actor_type, actor_id) VALUES ($1,NULL,'PENDING_PAYMENT',$2,$3)", [order.id, input.actor.type, input.actor.id]);
    return { duplicate: false, orderId: order.id as string, orderNumber: num as string, totalPaise: total, merchandisePaise: merch, couponDiscountPaise: couponDiscount, allowancePaise: allowance, freebieValuePaise: freebieValue, needsManualAttribution: !dealer.sales_employee_id };
  });
}

/** Release ACTIVE reservations. Safe to call any number of times: only ACTIVE rows are touched. */
export async function releaseReservations(c: pg.PoolClient, orderId: string): Promise<number> {
  const rows = (await c.query("UPDATE inventory_reservations SET status='RELEASED', settled_at=now() WHERE order_id=$1 AND status='ACTIVE' RETURNING product_id, qty", [orderId])).rows;
  for (const r of rows) await c.query('UPDATE inventory_balances SET reserved = reserved - $2, updated_at=now() WHERE product_id=$1', [r.product_id, r.qty]);
  return rows.length;
}
export async function cancelOrder(pool: pg.Pool, orderId: string, actor: { type: string; id: string }, reason: string) {
  return tx(pool, async c => { await transition(c, orderId, 'CANCELLED', actor, reason); await releaseReservations(c, orderId); await c.query("UPDATE payment_attempts SET status='EXPIRED' WHERE order_id=$1 AND status IN ('CREATED','PENDING')", [orderId]); });
}
export async function expireOrders(pool: pg.Pool, now: Date): Promise<number> {
  const ids = (await pool.query("SELECT id FROM orders WHERE status='PENDING_PAYMENT' AND expires_at <= $1", [now])).rows.map(r => r.id as string); let n = 0;
  for (const id of ids) await tx(pool, async c => {
    const r = await c.query("SELECT id FROM orders WHERE id=$1 AND status='PENDING_PAYMENT' AND expires_at <= $2 FOR UPDATE SKIP LOCKED", [id, now]); if (!r.rowCount) return;
    await transition(c, id, 'EXPIRED', { type: 'SYSTEM', id: null }, 'payment window expired'); await releaseReservations(c, id);
    await c.query("UPDATE payment_attempts SET status='EXPIRED' WHERE order_id=$1 AND status IN ('CREATED','PENDING')", [id]); n++;
  });
  return n;
}
