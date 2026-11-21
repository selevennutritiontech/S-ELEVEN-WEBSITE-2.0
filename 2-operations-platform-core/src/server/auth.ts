import type pg from 'pg';
import type { Actor, Role } from '../permissions.js';
import { DomainError } from '../db.js';
import { startPortalSession, touchPortalSession, endPortalSession, expireIdleSessions } from '../services/sessions.js';
import { verifyLogin } from '../services/twofa.js';
import { hashPassword, verifyPassword, needsRehash, passwordProblem, newToken, sha256, csrfFor, RateLimiter, temporaryPassword } from './security.js';

export interface Cfg {
  cookieName: string; secure: boolean; csrfKey: Buffer; secretsKey: Buffer;
  dealerIdleMin: number; dealerAbsHours: number; staffIdleMin: number;
  maxFails: number; lockMinutes: number; loginPerIp: number; loginPerId: number; apiPerIp: number;
  trustProxy: boolean; origin?: string; portalDir?: string; allowInsecureGoogleUrl?: boolean; maxBody: number; maxUploadBody: number;
}
export interface Session { kind: 'dealer' | 'staff'; actor: Actor; code: string; name: string; sessionId: string; tokenHash: string; csrf: string; mustChange: boolean }
export const ROLES: Role[] = ['HOST', 'SALES', 'LOGISTICS', 'WAREHOUSE', 'FINANCE', 'BRANDING', 'IT'];

export const audit = async (pool: pg.Pool, e: { actor?: Actor | null; action: string; target?: string; ip?: string; ok?: boolean; detail?: unknown }) => {
  try { await pool.query('INSERT INTO security_audit (actor_type, actor_id, action, target, ip, ok, detail) VALUES ($1,$2,$3,$4,$5,$6,$7)', [e.actor?.type ?? null, e.actor?.id ?? null, e.action, e.target ?? null, e.ip ?? null, e.ok ?? true, e.detail ? JSON.stringify(e.detail) : null]); } catch { /* auditing must never break a request */ }
};
const tooMany = (s: number) => new DomainError('TOO_MANY_ATTEMPTS', `Too many attempts. Try again in ${Math.ceil(s / 60) > 1 ? Math.ceil(s / 60) + ' minutes' : s + ' seconds'}.`, { retryAfter: s });
const generic = () => new DomainError('INVALID_CREDENTIALS', 'Invalid ID or password.');

/* an ID that does not exist locks after the same number of attempts as one that does, so the lock message cannot be used to discover accounts */
const unknownFails = new Map<string, { n: number; until: number }>();

interface Account { id: string; code: string; name: string; hash: string | null; failed: number; lockedUntil: Date | null; active: boolean; role: Role | null; mfa: boolean; mustChange: boolean }
async function findAccount(pool: pg.Pool, kind: 'dealer' | 'staff', code: string): Promise<Account | null> {
  if (kind === 'dealer') {
    const r = (await pool.query('SELECT d.id, d.dealer_code, d.name, d.status, c.password_hash, COALESCE(c.failed_count,0) AS failed, c.locked_until, COALESCE(c.must_change,false) AS must_change FROM dealers d LEFT JOIN dealer_credentials c ON c.dealer_id=d.id WHERE upper(d.dealer_code)=$1', [code])).rows[0];
    return r ? { id: r.id, code: r.dealer_code, name: r.name, hash: r.password_hash, failed: r.failed, lockedUntil: r.locked_until, active: r.status === 'ACTIVE', role: 'DEALER', mfa: false, mustChange: r.must_change } : null;
  }
  const r = (await pool.query('SELECT e.id, e.employee_code, e.name, e.status, e.password_hash, e.failed_count, e.locked_until, e.mfa_enabled, e.must_change, upper(d.code) AS dept FROM employees e LEFT JOIN departments d ON d.id=e.department_id WHERE upper(e.employee_code)=$1', [code])).rows[0];
  if (!r) return null; const role = (ROLES as string[]).includes(r.dept) ? (r.dept as Role) : null;
  return { id: r.id, code: r.employee_code, name: r.name, hash: r.password_hash, failed: r.failed_count, lockedUntil: r.locked_until, active: r.status === 'ACTIVE' && !!role, role, mfa: !!r.mfa_enabled, mustChange: r.must_change };
}
const failTable = (kind: 'dealer' | 'staff') => kind === 'dealer' ? { t: 'dealer_credentials', k: 'dealer_id' } : { t: 'employees', k: 'id' };

export async function login(pool: pg.Pool, cfg: Cfg, lim: RateLimiter, a: { kind: unknown; id: unknown; password: unknown; otp?: unknown; ip: string; ua?: string }) {
  const kind: 'dealer' | 'staff' = a.kind === 'staff' ? 'staff' : 'dealer';
  const code = typeof a.id === 'string' ? a.id.trim().toUpperCase().slice(0, 40) : '', pw = typeof a.password === 'string' ? a.password.slice(0, 200) : '', key = `${kind}:${code}`;
  const rec = async (ok: boolean, reason: string) => { try { await pool.query('INSERT INTO login_attempts (kind, login_id, ip, ok, reason) VALUES ($1,$2,$3,$4,$5)', [kind, code.slice(0, 40), a.ip, ok, reason]); } catch { /* ignore */ } };
  let w = lim.hit('login-ip:' + a.ip, cfg.loginPerIp, 10 * 60_000); if (w) { await rec(false, 'IP_THROTTLED'); throw tooMany(w); }
  w = lim.hit('login-id:' + key, cfg.loginPerId, 10 * 60_000); if (w) { await rec(false, 'ID_THROTTLED'); throw tooMany(w); }
  if (!code || !pw) throw generic();
  const acc = await findAccount(pool, kind, code), now = Date.now();
  if (!acc) {
    const u = unknownFails.get(key); if (u && u.until > now) { await rec(false, 'LOCKED'); throw tooMany(Math.ceil((u.until - now) / 1000)); }
    await verifyPassword(pw, null);                               // same cost as a real check
    const n = (u && u.until === 0 ? u.n : 0) + 1; unknownFails.set(key, n >= cfg.maxFails ? { n: 0, until: now + cfg.lockMinutes * 60_000 } : { n, until: 0 });
    await rec(false, 'UNKNOWN_ID'); throw generic();
  }
  if (acc.lockedUntil && acc.lockedUntil.getTime() > now) { await rec(false, 'LOCKED'); throw tooMany(Math.ceil((acc.lockedUntil.getTime() - now) / 1000)); }
  const ok = await verifyPassword(pw, acc.hash), ft = failTable(kind);
  if (!ok) {
    const lock = acc.failed + 1 >= cfg.maxFails;
    await pool.query(`UPDATE ${ft.t} SET failed_count=$2, locked_until=$3 WHERE ${ft.k}=$1`, [acc.id, lock ? 0 : acc.failed + 1, lock ? new Date(now + cfg.lockMinutes * 60_000) : null]);
    await rec(false, 'BAD_PASSWORD'); await audit(pool, { action: 'login.failed', target: key, ip: a.ip, ok: false, detail: { locked: lock } }); throw generic();
  }
  if (!acc.active) { await rec(false, 'DISABLED'); throw new DomainError('ACCOUNT_DISABLED', 'This account is deactivated. Please contact S-ELEVEN.'); }
  if (acc.mfa) {
    const otp = typeof a.otp === 'string' ? a.otp.trim() : ''; if (!/^\d{6}$/.test(otp)) { await rec(false, 'OTP_REQUIRED'); throw new DomainError('OTP_REQUIRED', 'Enter the 6-digit code from your authenticator app.'); }
    try { await verifyLogin(pool, { employeeId: acc.id, token: otp }); } catch { await rec(false, 'BAD_OTP'); throw new DomainError('OTP_INVALID', 'That code is not valid.'); }
  }
  await pool.query(`UPDATE ${ft.t} SET failed_count=0, locked_until=NULL WHERE ${ft.k}=$1`, [acc.id]); unknownFails.delete(key); lim.reset('login-id:' + key);
  if (acc.hash && needsRehash(acc.hash)) { const h = await hashPassword(pw); await pool.query(kind === 'dealer' ? 'UPDATE dealer_credentials SET password_hash=$2 WHERE dealer_id=$1' : 'UPDATE employees SET password_hash=$2 WHERE id=$1', [acc.id, h]); }
  const token = newToken(), th = sha256(token), actor: Actor = { type: kind === 'dealer' ? 'DEALER' : 'EMPLOYEE', id: acc.id, role: acc.role! };
  if (kind === 'dealer') await pool.query('INSERT INTO dealer_sessions (dealer_id, token_hash, expires_at, ip, user_agent) VALUES ($1,$2,$3,$4,$5)', [acc.id, th, new Date(now + cfg.dealerAbsHours * 3600_000), a.ip, (a.ua || '').slice(0, 300)]);
  else await startPortalSession(pool, { actor, tokenHash: th, userAgent: (a.ua || '').slice(0, 300) });
  await rec(true, 'OK'); await audit(pool, { actor, action: 'login.ok', target: key, ip: a.ip });
  return { token, user: { type: actor.type, role: actor.role, code: acc.code, name: acc.name, mustChange: acc.mustChange }, csrf: csrfFor(th, cfg.csrfKey) };
}

/** Who is calling? Decided ONLY from the session cookie. Nothing the browser sends can change it. */
export async function resolve(pool: pg.Pool, cfg: Cfg, token: string | undefined): Promise<Session | null> {
  if (!token || token.length < 30 || token.length > 100) return null; const th = sha256(token), now = new Date();
  const d = (await pool.query('SELECT s.id, s.dealer_id, s.last_seen_at, s.expires_at, d.dealer_code, d.name, d.status, COALESCE(c.must_change,false) AS must_change FROM dealer_sessions s JOIN dealers d ON d.id=s.dealer_id LEFT JOIN dealer_credentials c ON c.dealer_id=d.id WHERE s.token_hash=$1 AND s.ended_at IS NULL', [th])).rows[0];
  if (d) {
    const idle = now.getTime() - new Date(d.last_seen_at).getTime() > cfg.dealerIdleMin * 60_000, over = new Date(d.expires_at) <= now;
    if (idle || over || d.status !== 'ACTIVE') { await pool.query("UPDATE dealer_sessions SET ended_at=now(), end_reason=$2 WHERE id=$1", [d.id, d.status !== 'ACTIVE' ? 'DEACTIVATED' : 'EXPIRED']); return null; }
    await pool.query('UPDATE dealer_sessions SET last_seen_at=now() WHERE id=$1', [d.id]);
    return { kind: 'dealer', actor: { type: 'DEALER', id: d.dealer_id, role: 'DEALER' }, code: d.dealer_code, name: d.name, sessionId: d.id, tokenHash: th, csrf: csrfFor(th, cfg.csrfKey), mustChange: d.must_change };
  }
  const e = (await pool.query('SELECT s.id, s.last_seen_at, e.id AS emp, e.employee_code, e.name, e.status, e.must_change, upper(dp.code) AS dept FROM portal_sessions s JOIN employees e ON e.id=s.employee_id LEFT JOIN departments dp ON dp.id=e.department_id WHERE s.token_hash=$1 AND s.ended_at IS NULL', [th])).rows[0];
  if (!e) return null;
  const role = (ROLES as string[]).includes(e.dept) ? (e.dept as Role) : null;
  if (now.getTime() - new Date(e.last_seen_at).getTime() > cfg.staffIdleMin * 60_000 || e.status !== 'ACTIVE' || !role) { await expireIdleSessions(pool).catch(() => undefined); if (e.status !== 'ACTIVE' || !role) await pool.query("UPDATE portal_sessions SET ended_at=now(), end_reason='ADMIN' WHERE id=$1 AND ended_at IS NULL", [e.id]); return null; }
  await touchPortalSession(pool, th).catch(() => undefined);
  return { kind: 'staff', actor: { type: 'EMPLOYEE', id: e.emp, role }, code: e.employee_code, name: e.name, sessionId: e.id, tokenHash: th, csrf: csrfFor(th, cfg.csrfKey), mustChange: e.must_change };
}

export async function logout(pool: pg.Pool, s: Session) {
  if (s.kind === 'dealer') await pool.query("UPDATE dealer_sessions SET ended_at=now(), end_reason='LOGOUT' WHERE id=$1 AND ended_at IS NULL", [s.sessionId]);
  else await endPortalSession(pool, { tokenHash: s.tokenHash }).catch(() => undefined);
}
export async function endAllSessions(pool: pg.Pool, kind: 'dealer' | 'staff', id: string, reason: 'ADMIN' | 'PASSWORD_CHANGED' | 'DEACTIVATED', exceptTokenHash?: string) {
  if (kind === 'dealer') await pool.query('UPDATE dealer_sessions SET ended_at=now(), end_reason=$2 WHERE dealer_id=$1 AND ended_at IS NULL AND ($3::text IS NULL OR token_hash<>$3)', [id, reason, exceptTokenHash ?? null]);
  else await pool.query("UPDATE portal_sessions SET ended_at=now(), end_reason='ADMIN' WHERE employee_id=$1 AND ended_at IS NULL AND ($2::text IS NULL OR token_hash<>$2)", [id, exceptTokenHash ?? null]);
}

export async function changePassword(pool: pg.Pool, s: Session, a: { current: unknown; next: unknown }) {
  const cur = typeof a.current === 'string' ? a.current : '', next = a.next, kind = s.kind;
  const row = (await pool.query(kind === 'dealer' ? 'SELECT password_hash FROM dealer_credentials WHERE dealer_id=$1' : 'SELECT password_hash FROM employees WHERE id=$1', [s.actor.id])).rows[0];
  if (!(await verifyPassword(cur, row?.password_hash))) throw new DomainError('INVALID_CREDENTIALS', 'The current password is not correct.');
  const bad = passwordProblem(next, s.code); if (bad) throw new DomainError('WEAK_PASSWORD', bad);
  if (typeof next === 'string' && next === cur) throw new DomainError('WEAK_PASSWORD', 'Choose a password you have not used just now.');
  const h = await hashPassword(next as string);
  await pool.query(kind === 'dealer' ? 'UPDATE dealer_credentials SET password_hash=$2, must_change=false, password_changed_at=now(), failed_count=0, locked_until=NULL WHERE dealer_id=$1' : 'UPDATE employees SET password_hash=$2, must_change=false, password_changed_at=now(), failed_count=0, locked_until=NULL WHERE id=$1', [s.actor.id, h]);
  await endAllSessions(pool, kind, s.actor.id, 'PASSWORD_CHANGED', s.tokenHash);
}

/** Administrator sets a one-time password. It is returned ONCE here and is never stored or shown again. */
export async function setTemporaryPassword(pool: pg.Pool, kind: 'dealer' | 'staff', id: string) {
  const temp = temporaryPassword(), h = await hashPassword(temp);
  if (kind === 'dealer') await pool.query('INSERT INTO dealer_credentials (dealer_id, password_hash, must_change) VALUES ($1,$2,true) ON CONFLICT (dealer_id) DO UPDATE SET password_hash=$2, must_change=true, failed_count=0, locked_until=NULL, password_changed_at=now()', [id, h]);
  else await pool.query('UPDATE employees SET password_hash=$2, must_change=true, failed_count=0, locked_until=NULL, password_changed_at=now() WHERE id=$1', [id, h]);
  await endAllSessions(pool, kind, id, 'ADMIN'); return temp;
}

/* ---------- cookies ---------- */
export const parseCookies = (h: string | undefined) => { const o: Record<string, string> = {}; for (const p of (h || '').split(';')) { const i = p.indexOf('='); if (i > 0) o[p.slice(0, i).trim()] = p.slice(i + 1).trim(); } return o; };
export const sessionCookie = (cfg: Cfg, token: string, maxAgeS: number) => `${cfg.cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeS}${cfg.secure ? '; Secure' : ''}`;
export const clearCookie = (cfg: Cfg) => `${cfg.cookieName}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${cfg.secure ? '; Secure' : ''}`;
