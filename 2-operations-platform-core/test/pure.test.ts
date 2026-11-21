import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolvePrice, PriceRule } from '../src/pricing.js';
import { allowanceFor } from '../src/freebies.js';
import { allocate } from '../src/money.js';
import { assertTransition } from '../src/stateMachine.js';
import { trackingStart, invoiceSlot, trackingSlot, zonedToUtc } from '../src/reminders.js';
import { can } from '../src/permissions.js';

const T = new Date('2026-10-19T10:00:00Z'), past = new Date('2026-01-01T00:00:00Z');
const P = { basePaise: 100000n, productId: 'p1', brandId: 'b1' };
const pct = (bp: number, o: Partial<PriceRule> = {}): PriceRule => ({ productId: null, brandId: null, discountBp: bp, fixedPaise: null, from: past, to: null, ...o });
const fixed = (paise: bigint, o: Partial<PriceRule> = {}): PriceRule => ({ productId: 'p1', brandId: null, discountBp: null, fixedPaise: paise, from: past, to: null, ...o });

describe('1. pricing engine', () => {
  it('the spec example: base 1000, 15% -> 850', () => assert.deepEqual(resolvePrice(P, [pct(1500)], T), { unitPaise: 85000n, discountBp: 1500, source: 'PERCENT' }));
  it('fixed dealer rate takes precedence over any percentage', () => { const r = resolvePrice(P, [pct(1500), fixed(80000n)], T); assert.equal(r.unitPaise, 80000n); assert.equal(r.source, 'FIXED'); });
  it('expired and future-dated fixed rates are ignored', () => {
    assert.equal(resolvePrice(P, [pct(1500), fixed(80000n, { to: new Date('2026-06-01') })], T).source, 'PERCENT');
    assert.equal(resolvePrice(P, [pct(1500), fixed(80000n, { from: new Date('2027-01-01') })], T).source, 'PERCENT');
  });
  it('product percent beats brand percent beats dealer-wide percent; no rule -> base', () => {
    assert.equal(resolvePrice(P, [pct(1000), pct(2000, { brandId: 'b1' }), pct(3000, { productId: 'p1' })], T).discountBp, 3000);
    assert.equal(resolvePrice(P, [pct(1000), pct(2000, { brandId: 'b1' })], T).discountBp, 2000);
    assert.deepEqual(resolvePrice(P, [], T), { unitPaise: 100000n, discountBp: 0, source: 'BASE' });
  });
});
describe('3. freebie allowance at slab boundaries', () => {
  const slabs = [[500000n, 30000n], [1000000n, 60000n], [2000000n, 100000n], [3000000n, 150000n], [5000000n, 250000n]].map(([a, b]) => ({ minCartPaise: a, maxAllowancePaise: b }));
  it('boundaries are inclusive and the highest slab wins', () => {
    for (const [cart, want] of [[0n, 0n], [499999n, 0n], [500000n, 30000n], [999999n, 30000n], [1000000n, 60000n], [1999999n, 60000n], [2000000n, 100000n], [3000000n, 150000n], [4999999n, 150000n], [9000000n, 250000n]]) assert.equal(allowanceFor(slabs, cart), want, `cart ${cart}`);
  });
});
describe('8. allocation is exact', () => {
  it('spec example: 9,000 across 6,000 / 4,000 -> 5,400 / 3,600', () => assert.deepEqual(allocate(900000n, [600000n, 400000n]), [540000n, 360000n]));
  it('parts always sum to the total, with deterministic ties', () => {
    assert.deepEqual(allocate(10001n, [1n, 1n, 1n]), [3334n, 3334n, 3333n]);
    for (let i = 0; i < 500; i++) { const w = [BigInt(1 + (i * 7919) % 9973), BigInt(1 + (i * 104729) % 7001), BigInt(1 + (i * 13) % 997)], t = BigInt(1 + (i * 99991) % 1000003); assert.equal(allocate(t, w).reduce((a, b) => a + b, 0n), t); assert.equal(allocate(-t, w).reduce((a, b) => a + b, 0n), -t); }
  });
});
describe('order state machine', () => {
  it('rejects invalid transitions', () => { for (const [a, b] of [['SHIPPED', 'PACKED_READY'], ['DELIVERED', 'SHIPPED'], ['PENDING_PAYMENT', 'SHIPPED'], ['CANCELLED', 'PAID_AWAITING_LOGISTICS'], ['AWAITING_WAREHOUSE', 'PACKED_READY']] as const) assert.throws(() => assertTransition(a, b), /Cannot move/); });
  it('allows the normal path', () => { const p = ['PENDING_PAYMENT', 'PAID_AWAITING_LOGISTICS', 'INVOICE_ATTACHED', 'AWAITING_WAREHOUSE', 'PACKING_IN_PROGRESS', 'PACKED_READY', 'READY_FOR_DISPATCH', 'SHIPPED', 'DELIVERED'] as const; for (let i = 0; i < p.length - 1; i++) assertTransition(p[i], p[i + 1]); });
});
describe('11/12. reminder timing', () => {
  it('invoice reminders: none before +15 min, then one slot per 15 min', () => {
    const e = new Date('2026-10-19T10:00:00Z'); assert.equal(invoiceSlot(e, new Date(e.getTime() + 14 * 60000)), null);
    assert.equal(invoiceSlot(e, new Date(e.getTime() + 15 * 60000)), 1); assert.equal(invoiceSlot(e, new Date(e.getTime() + 29 * 60000)), 1); assert.equal(invoiceSlot(e, new Date(e.getTime() + 30 * 60000)), 2);
  });
  it('tracking reminders start 10:00 the next LOCAL day in the company timezone', () => {
    assert.equal(trackingStart(new Date('2026-10-19T18:00:00Z'), 'Asia/Kolkata').toISOString(), '2026-10-20T04:30:00.000Z');   // 23:30 IST on the 19th -> 10:00 IST on the 20th
    assert.equal(trackingStart(new Date('2026-10-19T02:00:00Z'), 'Asia/Kolkata').toISOString(), '2026-10-20T04:30:00.000Z');   // 07:30 IST on the 19th -> same
    assert.equal(trackingStart(new Date('2026-10-19T19:00:00Z'), 'Asia/Kolkata').toISOString(), '2026-10-21T04:30:00.000Z');   // 00:30 IST on the 20th -> 10:00 on the 21st
    const ny = trackingStart(new Date('2026-03-07T20:00:00Z'), 'America/New_York');                                              // DST starts 8 Mar: 10:00 local = 14:00Z
    assert.equal(ny.toISOString(), '2026-03-08T14:00:00.000Z'); assert.equal(zonedToUtc(2026, 1, 15, 10, 0, 'America/New_York').toISOString(), '2026-01-15T15:00:00.000Z');
    const s = new Date('2026-10-20T04:30:00Z'); assert.equal(trackingSlot(s, new Date(s.getTime() - 1)), null); assert.equal(trackingSlot(s, s), 0); assert.equal(trackingSlot(s, new Date(s.getTime() + 15 * 60000)), 1);
  });
});
describe('permissions', () => { it('only HOST holds every permission', () => { assert.ok(can({ type: 'EMPLOYEE', id: 'x', role: 'HOST' }, 'shift.override')); assert.ok(!can({ type: 'EMPLOYEE', id: 'x', role: 'SALES' }, 'shift.override')); assert.ok(!can({ type: 'DEALER', id: 'x', role: 'DEALER' }, 'finance.read')); }); });
