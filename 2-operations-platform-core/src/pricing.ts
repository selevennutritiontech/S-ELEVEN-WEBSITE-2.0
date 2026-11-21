import { roundDiv } from './money.js';
export interface PriceRule { productId: string | null; brandId: string | null; discountBp: number | null; fixedPaise: bigint | null; from: Date; to: Date | null }
export interface Priced { unitPaise: bigint; discountBp: number; source: 'FIXED' | 'PERCENT' | 'BASE' }
const active = (r: PriceRule, at: Date) => r.from <= at && (!r.to || r.to > at);
const latest = (l: PriceRule[]) => l.sort((a, b) => b.from.getTime() - a.from.getTime())[0];
/** Priority: active FIXED dealer rate for the product > PERCENT for the product > PERCENT for the brand > dealer-wide PERCENT > base price. */
export function resolvePrice(p: { basePaise: bigint; productId: string; brandId: string }, rules: PriceRule[], at: Date): Priced {
  const act = rules.filter(r => active(r, at));
  const fixed = latest(act.filter(r => r.fixedPaise !== null && r.productId === p.productId));
  if (fixed) {
    const bp = p.basePaise > 0n ? Number(roundDiv((p.basePaise - fixed.fixedPaise!) * 10000n, p.basePaise)) : 0;
    return { unitPaise: fixed.fixedPaise!, discountBp: Math.max(0, bp), source: 'FIXED' };
  }
  const pct = act.filter(r => r.discountBp !== null);
  const rule = latest(pct.filter(r => r.productId === p.productId)) || latest(pct.filter(r => !r.productId && r.brandId === p.brandId)) || latest(pct.filter(r => !r.productId && !r.brandId));
  if (!rule) return { unitPaise: p.basePaise, discountBp: 0, source: 'BASE' };
  return { unitPaise: p.basePaise - roundDiv(p.basePaise * BigInt(rule.discountBp!), 10000n), discountBp: rule.discountBp!, source: 'PERCENT' };
}
