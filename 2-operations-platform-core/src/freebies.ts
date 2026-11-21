import { DomainError } from './db.js';
export interface Slab { minCartPaise: bigint; maxAllowancePaise: bigint }
/** The allowance is the MAXIMUM freebie value of the highest slab the cart value reaches (boundary is inclusive). */
export function allowanceFor(slabs: Slab[], cartPaise: bigint): bigint {
  let best = 0n, bestMin = -1n;
  for (const s of slabs) if (cartPaise >= s.minCartPaise && s.minCartPaise > bestMin) { best = s.maxAllowancePaise; bestMin = s.minCartPaise; }
  return best;
}
export interface Pick { schemeId: string; valuationPaise: bigint; qty: number; maxQty: number; schemeCapPaise: bigint | null; stockAvailable: number; label?: string }
export function validatePicks(allowance: bigint, picks: Pick[]) {
  let used = 0n; const perScheme = new Map<string, bigint>();
  for (const p of picks) {
    if (p.qty > p.maxQty) throw new DomainError('FREEBIE_QTY_LIMIT', `Quantity above the limit of ${p.maxQty} per order`);
    if (p.qty > p.stockAvailable) throw new DomainError('INSUFFICIENT_STOCK', 'Freebie stock is not available');
    const v = p.valuationPaise * BigInt(p.qty); used += v;
    const s = (perScheme.get(p.schemeId) || 0n) + v; perScheme.set(p.schemeId, s);
    if (p.schemeCapPaise !== null && s > p.schemeCapPaise) throw new DomainError('FREEBIE_SCHEME_CAP', 'Scheme allowance exceeded');
  }
  if (used > allowance) throw new DomainError('FREEBIE_ALLOWANCE_EXCEEDED', 'Freebie value is above the allowance', { used, allowance });
  return { used, remaining: allowance - used };
}
