import crypto from 'node:crypto';
import { makePool } from '../db.js';
import { expireIdleSessions } from '../services/sessions.js';
import { buildServer } from './app.js';
import type { Cfg } from './auth.js';
import { secretsKey } from './security.js';

const env = process.env, secure = env.COOKIE_SECURE !== 'false';
const key = secretsKey();                       // refuses to start without SECRETS_KEY: there is no default secret
const cfg: Cfg = {
  cookieName: secure ? '__Host-sel_sid' : 'sel_sid', secure, secretsKey: key, csrfKey: crypto.createHmac('sha256', key).update('csrf-key').digest(),
  dealerIdleMin: Number(env.DEALER_IDLE_MIN || 30), dealerAbsHours: Number(env.SESSION_MAX_HOURS || 12), staffIdleMin: Number(env.STAFF_IDLE_MIN || 30),
  maxFails: Number(env.MAX_FAILED_LOGINS || 5), lockMinutes: Number(env.LOCK_MINUTES || 15), loginPerIp: Number(env.LOGIN_PER_IP || 30), loginPerId: Number(env.LOGIN_PER_ID || 12), apiPerIp: Number(env.API_PER_IP || 600),
  trustProxy: env.TRUST_PROXY === 'true', origin: env.ALLOWED_ORIGIN, portalDir: env.PORTAL_DIR, maxBody: 256 * 1024, maxUploadBody: 2 * 1024 * 1024 };
const pool = makePool(Number(env.DB_POOL || 20)), { server } = buildServer(pool, cfg), port = Number(env.PORT || 8443), host = env.HOST || '127.0.0.1';
setInterval(() => { expireIdleSessions(pool).catch(() => undefined); }, 60_000).unref();
server.listen(port, host, () => console.log(`S-ELEVEN server listening on ${host}:${port} (secure cookies: ${secure})`));
const stop = () => { server.close(() => pool.end().then(() => process.exit(0))); setTimeout(() => process.exit(1), 10_000).unref(); };
process.on('SIGTERM', stop); process.on('SIGINT', stop);
