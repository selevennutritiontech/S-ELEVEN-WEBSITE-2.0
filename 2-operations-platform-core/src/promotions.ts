import type pg from 'pg';
import { roundDiv } from './money.js';
export interface Promo { id: string; code: string | null; name: string; kind: 'PERCENT' | 'FIXED' | 'COMBO' | 'PRODUCT'; percentBp: number | null; fixedPaise: bigint | null; minOrderPaise: bigint; startsAt: Date; endsAt: Date; active: boolean;
  maxUses: number | null; maxUsesPerDealer: number | null; brandId: string | null; allDealers: boolean; dealerIds: string[]; excludeFreebies: boolean | null; required: { productId: string; qty: number }[]; eligible: string[] }
export interface Line { id: string; productId: string; brandId: string; qty: number; totalPaise: bigint }
export type PromoResult = { ok: false; reason: string; message: string } | { ok: true; discountPaise: bigint; touched: string[]; blocksFreebies: boolean };
const no = (reason: string, message: string): PromoResult => ({ ok: false, reason, message });
/** Pure, deterministic coupon check. The server runs this at checkout: nothing the browser says about a discount is trusted. */
export function evaluatePromo(p: Promo, c: { dealerId: string; lines: Line[]; now: Date; usedTotal: number; usedByDealer: number }): PromoResult {
  if (!p.active) return no('INACTIVE', 'This coupon is not active'); if (c.now < p.startsAt) return no('NOT_STARTED', 'This coupon is not valid yet'); if (c.now >= p.endsAt) return no('EXPIRED', 'This coupon has expired');
  if (!p.allDealers && !p.dealerIds.includes(c.dealerId)) return no('NOT_ELIGIBLE', 'This coupon is not available for your account');
  if (p.maxUses !== null && c.usedTotal >= p.maxUses) return no('USAGE_LIMIT', 'This coupon has reached its usage limit'); if (p.maxUsesPerDealer !== null && c.usedByDealer >= p.maxUsesPerDealer) return no('USAGE_LIMIT_DEALER', 'You have already used this coupon the maximum number of times');
  const cart = c.lines.reduce((a, l) => a + l.totalPaise, 0n); if (cart < p.minOrderPaise) return no('BELOW_MINIMUM', `Add more to your order: the minimum for this coupon is ${(Number(p.minOrderPaise) / 100).toFixed(2)}`);
  let base: Line[];
  if (p.kind === 'COMBO') {
    for (const r of p.required) { const have = c.lines.filter(l => l.productId === r.productId).reduce((a, l) => a + l.qty, 0); if (have < r.qty) return no('COMBO_INCOMPLETE', 'Add every product of the combo to use this coupon'); }
    base = c.lines.filter(l => p.required.some(r => r.productId === l.productId));
  } else if (p.kind === 'PRODUCT') base = c.lines.filter(l => p.eligible.includes(l.productId)); else base = p.brandId ? c.lines.filter(l => l.brandId === p.brandId) : c.lines;
  if (!base.length) return no('NOT_APPLICABLE', 'This coupon does not apply to the products in your cart');
  const baseTotal = base.reduce((a, l) => a + l.totalPaise, 0n);
  let d = p.kind === 'COMBO' || p.kind === 'FIXED' || (p.kind === 'PRODUCT' && p.fixedPaise !== null) ? (p.fixedPaise ?? 0n) : roundDiv(baseTotal * BigInt(p.percentBp ?? 0), 10000n);
  if (d > baseTotal) d = baseTotal; if (d <= 0n) return no('NO_DISCOUNT', 'This coupon gives no discount on this order');
  return { ok: true, discountPaise: d, touched: base.map(l => l.id), blocksFreebies: p.excludeFreebies ?? (p.kind === 'COMBO' || p.kind === 'PRODUCT') };   // combo and product-specific coupons exclude their products from freebies by default
}
export async function loadPromoByCode(c: pg.PoolClient, code: string): Promise<Promo | null> {
  const r = (await c.query('SELECT * FROM promotions WHERE upper(code)=upper($1) FOR UPDATE', [code])).rows[0]; if (!r) return null;
  const dl = (await c.query('SELECT dealer_id FROM promotion_dealers WHERE promotion_id=$1', [r.id])).rows.map(x => x.dealer_id as string), pr = (await c.query('SELECT product_id, role, required_qty FROM promotion_products WHERE promotion_id=$1', [r.id])).rows;
  return { id: r.id, code: r.code, name: r.name, kind: r.kind, percentBp: r.percent_bp, fixedPaise: r.fixed_paise, minOrderPaise: r.min_order_paise, startsAt: r.starts_at, endsAt: r.ends_at, active: r.active, maxUses: r.max_uses, maxUsesPerDealer: r.max_uses_per_dealer,
    brandId: r.brand_id, allDealers: r.all_dealers, dealerIds: dl, excludeFreebies: r.exclude_freebies, required: pr.filter(x => x.role === 'REQUIRED').map(x => ({ productId: x.product_id, qty: x.required_qty })), eligible: pr.filter(x => x.role === 'ELIGIBLE').map(x => x.product_id) };
}
export async function promoUsage(c: pg.PoolClient, promoId: string, dealerId: string) {
  const q = (extra: string, p: unknown[]) => c.query(`SELECT COUNT(*)::int AS n FROM promotion_redemptions r JOIN orders o ON o.id=r.order_id WHERE r.promotion_id=$1 AND o.status NOT IN ('CANCELLED','EXPIRED') ${extra}`, p).then(x => x.rows[0].n as number);
  return { total: await q('', [promoId]), byDealer: await q('AND r.dealer_id=$2', [promoId, dealerId]) };
}
/** Line-level freebie eligibility. Reasons are returned so the screen can say WHY a product cannot receive freebies. */
export function freebieEligibility(lines: Line[], blocked: Set<string>, ex: { productIds: Set<string>; brandIds: Set<string>; dealerBlocked: boolean }) {
  const out = new Map<string, { eligible: boolean; reason: string | null }>();
  for (const l of lines) {
    let reason: string | null = null;
    if (ex.dealerBlocked) reason = 'This dealer is not eligible for freebies'; else if (blocked.has(l.id)) reason = 'Product is part of a combo or specific-product coupon';
    else if (ex.productIds.has(l.productId)) reason = 'Product is excluded from freebies'; else if (ex.brandIds.has(l.brandId)) reason = 'Brand is excluded from freebies';
    out.set(l.id, { eligible: reason === null, reason });
  }
  return out;
}
