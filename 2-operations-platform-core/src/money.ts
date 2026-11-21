/** Integer-paise helpers. No floating point is ever used for money. */
export const roundDiv = (a: bigint, b: bigint): bigint => (a * 2n + b) / (2n * b);          // half-up, a,b >= 0
export const rupees = (n: number): bigint => BigInt(Math.round(n * 100));
export const fmt = (p: bigint): string => `\u20B9${(Number(p) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** Split `total` across `weights` with the largest-remainder method. Deterministic (ties -> lowest index) and the parts always sum to `total`. */
export function allocate(total: bigint, weights: bigint[]): bigint[] {
  const sum = weights.reduce((a, b) => a + b, 0n);
  if (total < 0n) return allocate(-total, weights).map(x => -x);
  if (sum <= 0n) throw new Error('allocate: weights must sum to a positive number');
  const parts = weights.map(w => (total * w) / sum), rem = weights.map(w => (total * w) % sum);
  let left = total - parts.reduce((a, b) => a + b, 0n);
  const order = weights.map((_, i) => i).sort((i, j) => (rem[j] > rem[i] ? 1 : rem[j] < rem[i] ? -1 : i - j));
  for (const i of order) { if (left <= 0n) break; parts[i] += 1n; left -= 1n; }
  return parts;
}
