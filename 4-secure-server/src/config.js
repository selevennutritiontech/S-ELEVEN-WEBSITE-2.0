'use strict';
/* All settings come from environment variables. In production the server refuses to start with unsafe settings. */
const path = require('node:path');
const crypto = require('node:crypto');
function load(env = process.env) {
  const prod = env.NODE_ENV === 'production';
  const c = {
    prod,
    port: Number(env.PORT) || 8080,
    host: env.HOST || '127.0.0.1',
    databaseUrl: env.DATABASE_URL || '',
    siteDir: env.SITE_DIR ? path.resolve(env.SITE_DIR) : '',                       // optional: serve the whole website at / and the dealer portal at /dealer-portal/
    portalDir: path.resolve(env.PORTAL_DIR || (env.SITE_DIR ? path.join(env.SITE_DIR, 'dealer-portal') : path.join(__dirname, '..', '..', '1-website-and-dealer-portal', 'dealer-portal'))),
    staffPath: (env.STAFF_PATH || '/access/employee-server').replace(/\/+$/, ''),   // the ONLY address of the employee login; nothing on the website links to it
    seedDemo: env.SEED_DEMO === '1' && env.NODE_ENV === 'test',   // demo data exists ONLY inside the automated tests; a real or local run always starts clean
    require2fa: env.REQUIRE_2FA ? env.REQUIRE_2FA === '1' : env.SEED_DEMO !== '1',   // Google Authenticator for every department: ON in production, off in the demo unless asked
    reset2faFor: String(env.RESET_2FA_FOR || '').split(',').map(x => x.trim().toUpperCase()).filter(Boolean),   // emergency: clears these users' authenticator at start-up (a lost Host phone)
    brandFetchAllowPrivate: !prod && env.BRANDFETCH_ALLOW_PRIVATE === '1',   // tests only: lets the brand importer read a local test server
    demoPayments: env.DEMO_PAYMENTS === '1',     // lets a dealer "simulate" a payment: never in production
    cookieInsecureDev: env.COOKIE_INSECURE_DEV === '1',
    trustProxy: env.TRUST_PROXY === '1',         // set behind a reverse proxy that sets X-Forwarded-For / -Proto
    appSecretKey: env.APP_SECRET_KEY || '',      // 64 hex chars: encrypts stored third-party secrets (the Google script secret)
    initialAdminPassword: env.INITIAL_ADMIN_PASSWORD || '',
    sessionIdleMs: (Number(env.SESSION_IDLE_MIN) || 120) * 60000,
    sessionMaxMs: (Number(env.SESSION_MAX_HOURS) || 14) * 3600000,
    lockAfter: 5, lockMs: 15 * 60000,
    ipLoginLimit: Number(env.IP_LOGIN_LIMIT) || 20, ipLoginWindowMs: 10 * 60000,
    apiRateLimit: Number(env.API_RATE_LIMIT) || 900,   // requests per minute per IP
    sheetsUrlPattern: null,                                                     // tests only: replaces the Google address check
    maxBodyBytes: 8 * 1024 * 1024,
    allowedOrigins: (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean),
  };
  if (!c.appSecretKey) c.appSecretKey = crypto.randomBytes(32).toString('hex');   // development only: stored secrets do not survive a restart
  c.errors = [];
  if (!/^\/[a-z0-9][a-z0-9\-\/]{4,58}[a-z0-9]$/.test(c.staffPath) || /^\/(api|js|css|assets|admin|dealer-portal|employee|backend)(\/|$)/.test(c.staffPath)) c.errors.push('STAFF_PATH must look like /access/employee-server (lower-case letters, digits and dashes, 6 to 60 characters) and must not start with /api, /admin, /dealer-portal, /js, /css or /assets');
  if (prod) {
    if (!env.DATABASE_URL) c.errors.push('DATABASE_URL is required in production');
    if (!/^[0-9a-f]{64}$/i.test(env.APP_SECRET_KEY || '')) c.errors.push('APP_SECRET_KEY must be 64 hex characters (generate with: openssl rand -hex 32)');
    if (env.SEED_DEMO === '1') c.errors.push('SEED_DEMO must not be set in production');
    if (c.cookieInsecureDev) c.errors.push('COOKIE_INSECURE_DEV must not be set in production');
    if (c.demoPayments) c.errors.push('DEMO_PAYMENTS must not be set in production');
  }
  return c;
}
module.exports = { load };
