/** RFC 6238 TOTP (SHA-1, 6 digits, 30 s) as used by Google Authenticator, plus AES-256-GCM sealing of the stored secret. */
import { createHmac, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { DomainError } from './db.js';
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const STEP_SECONDS = 30;
export function base32Encode(buf: Buffer): string { let bits = 0, val = 0, out = ''; for (const b of buf) { val = (val << 8) | b; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } } if (bits > 0) out += B32[(val << (5 - bits)) & 31]; return out; }
export function base32Decode(s: string): Buffer { const out: number[] = []; let bits = 0, val = 0; for (const ch of s.replace(/[\s=-]/g, '').toUpperCase()) { const x = B32.indexOf(ch); if (x < 0) continue; val = (val << 5) | x; bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } } return Buffer.from(out); }
export function hotp(secret: string, counter: number): string {
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(counter)); const h = createHmac('sha1', base32Decode(secret)).update(msg).digest(); const o = h[19] & 15;
  return String(((h[o] & 127) << 24 | h[o + 1] << 16 | h[o + 2] << 8 | h[o + 3]) % 1_000_000).padStart(6, '0');
}
export const stepOf = (now: Date) => Math.floor(now.getTime() / 1000 / STEP_SECONDS);
export const totp = (secret: string, now = new Date()) => hotp(secret, stepOf(now));
/** returns the matching time step (current +/- 1 for clock drift) or null */
export function matchStep(secret: string, token: string, now: Date): number | null {
  if (!/^\d{6}$/.test(String(token).replace(/\s/g, ''))) return null; const t = String(token).replace(/\s/g, ''), s = stepOf(now);
  for (const d of [0, -1, 1]) if (hotp(secret, s + d) === t) return s + d; return null;
}
export const newSecret = () => base32Encode(randomBytes(20));
export const otpauthUri = (account: string, secret: string, issuer = 'S-ELEVEN') => `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
function key(): Buffer {
  const hex = process.env.TOTP_ENC_KEY ?? (process.env.NODE_ENV === 'production' ? '' : '11'.repeat(32));   // production must set a real 32-byte key from the secrets manager
  const k = Buffer.from(hex, 'hex'); if (k.length !== 32) throw new DomainError('CONFIG', 'TOTP_ENC_KEY must be 32 bytes (64 hex characters)'); return k;
}
export function sealSecret(secret: string): string { const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', key(), iv), ct = Buffer.concat([c.update(secret, 'utf8'), c.final()]); return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64'); }
export function openSecret(blob: string): string { const b = Buffer.from(blob, 'base64'), d = createDecipheriv('aes-256-gcm', key(), b.subarray(0, 12)); d.setAuthTag(b.subarray(12, 28)); return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8'); }
