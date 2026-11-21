import crypto from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(crypto.scrypt) as (pw: string, salt: Buffer, len: number, o: crypto.ScryptOptions) => Promise<Buffer>;

/* ---------- passwords: salted scrypt, constant-time compare. Cost is configurable (SCRYPT_N); raise it on strong hardware. ---------- */
const COST = () => Number(process.env.SCRYPT_N || 32768), R = 8, P = 1, KEYLEN = 64;
export async function hashPassword(pw: string): Promise<string> {
  const n = COST(), salt = crypto.randomBytes(16), dk = await scrypt(pw, salt, KEYLEN, { N: n, r: R, p: P, maxmem: 256 * n * R });
  return `scrypt$${n}$${R}$${P}$${salt.toString('base64')}$${dk.toString('base64')}`;
}
export async function verifyPassword(pw: string, stored: string | null | undefined): Promise<boolean> {
  const dummy = !stored || !stored.startsWith('scrypt$'); const s = dummy ? await dummyHash() : stored!; const [, n, r, p, salt, hash] = s.split('$');
  const want = Buffer.from(hash, 'base64'); const got = await scrypt(pw, Buffer.from(salt, 'base64'), want.length, { N: +n, r: +r, p: +p, maxmem: 256 * +n * +r });
  return crypto.timingSafeEqual(got, want) && !dummy;
}
let dummyP: Promise<string> | null = null;
/** an unknown account still costs one hash, so response time does not reveal whether an ID exists */
const dummyHash = () => (dummyP ??= hashPassword(crypto.randomBytes(12).toString('hex')));
export const needsRehash = (stored: string) => { const n = Number(stored.split('$')[1]); return n < COST(); };
const COMMON = new Set(['password', 'password1', 'password123', '1234567890', 'qwertyuiop', 'admin12345', 'admin123', 'letmein123', 'welcome123', 'iloveyou12', 'seleven123', 'demo123', 'demo456', 'demo789']);
export function passwordProblem(pw: unknown, loginId = ''): string | null {
  if (typeof pw !== 'string') return 'Enter a password.';
  if (pw.length < 10) return 'Use at least 10 characters.'; if (pw.length > 128) return 'Use at most 128 characters.';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'Use letters and at least one number.';
  if (COMMON.has(pw.toLowerCase())) return 'That password is too common.';
  if (loginId && pw.toLowerCase().includes(loginId.toLowerCase())) return 'The password must not contain your ID.';
  return null;
}
/** one-time password given to a person by an administrator: shown once, never retrievable, must be changed at first sign-in */
export function temporaryPassword(): string {
  const U = 'ABCDEFGHJKMNPQRSTUVWXYZ', L = 'abcdefghjkmnpqrstuvwxyz', N = '23456789', ALL = U + L + N, pick = (s: string) => s[crypto.randomInt(s.length)];
  const o = [pick(U), pick(L), pick(N)]; while (o.length < 14) o.push(pick(ALL)); for (let i = o.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [o[i], o[j]] = [o[j], o[i]]; } return o.join('');
}

/* ---------- tokens ---------- */
export const newToken = () => crypto.randomBytes(32).toString('base64url');
export const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
/** CSRF token bound to the session: HMAC of the session hash. Needs no storage and cannot be guessed without the server key. */
export const csrfFor = (tokenHash: string, key: Buffer) => crypto.createHmac('sha256', key).update('csrf:' + tokenHash).digest('base64url');
export const safeEqual = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); };

/* ---------- sealing secrets at rest (AES-256-GCM) ---------- */
export function secretsKey(): Buffer {
  const hex = process.env.SECRETS_KEY || ''; if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error('SECRETS_KEY must be 64 hex characters (32 random bytes). Generate one with: openssl rand -hex 32');
  return Buffer.from(hex, 'hex');
}
export function seal(plain: string, key: Buffer): string { const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key, iv), ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]); return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), ct.toString('base64')].join('.'); }
export function open(sealed: string, key: Buffer): string { const [v, iv, tag, ct] = sealed.split('.'); if (v !== 'v1') throw new Error('bad format'); const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64')); d.setAuthTag(Buffer.from(tag, 'base64')); return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8'); }

/* ---------- rate limiting (sliding window, in memory; use one instance per server process, or move to Redis when you run several) ---------- */
export class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor() { const t = setInterval(() => { const now = Date.now(); for (const [k, v] of this.hits) { const keep = v.filter(x => now - x < 3600_000); if (keep.length) this.hits.set(k, keep); else this.hits.delete(k); } }, 60_000); t.unref(); }
  /** returns seconds to wait when over the limit, else 0 */
  hit(key: string, limit: number, windowMs: number): number {
    const now = Date.now(), v = (this.hits.get(key) || []).filter(x => now - x < windowMs); v.push(now); this.hits.set(key, v);
    return v.length > limit ? Math.max(1, Math.ceil((windowMs - (now - v[0])) / 1000)) : 0;
  }
  reset(key: string) { this.hits.delete(key); }
}

/* ---------- headers ---------- */
export function securityHeaders(https: boolean): Record<string, string> {
  const h: Record<string, string> = {
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob:; connect-src 'self'; frame-src https://docs.google.com; frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'self'",
    'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Resource-Policy': 'same-origin', 'X-Permitted-Cross-Domain-Policies': 'none' };
  if (https) h['Strict-Transport-Security'] = 'max-age=63072000; includeSubDomains';
  return h;
}
