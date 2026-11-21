-- Server-side authentication, sessions, lockout, audit and protected integration secrets.
-- Passwords are NEVER stored: only salted scrypt hashes. Nothing in this schema can return a password.

CREATE TABLE dealer_credentials (
  dealer_id uuid PRIMARY KEY REFERENCES dealers(id) ON DELETE CASCADE,
  password_hash text NOT NULL,
  must_change boolean NOT NULL DEFAULT true,
  failed_count int NOT NULL DEFAULT 0,
  locked_until timestamptz,
  password_changed_at timestamptz NOT NULL DEFAULT now());

-- employees.password_hash already exists (unused until now)
ALTER TABLE employees
  ADD COLUMN failed_count int NOT NULL DEFAULT 0,
  ADD COLUMN locked_until timestamptz,
  ADD COLUMN must_change boolean NOT NULL DEFAULT false,
  ADD COLUMN password_changed_at timestamptz;

-- dealer sessions (employee sessions live in portal_sessions, which also drives attendance)
CREATE TABLE dealer_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dealer_id uuid NOT NULL REFERENCES dealers(id) ON DELETE CASCADE,
  token_hash text UNIQUE NOT NULL,                      -- sha256 of the cookie value; the cookie value itself is never stored
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,                      -- absolute lifetime
  ended_at timestamptz,
  end_reason text CHECK (end_reason IN ('LOGOUT','EXPIRED','ADMIN','PASSWORD_CHANGED','DEACTIVATED')),
  ip text, user_agent text);
CREATE INDEX dealer_sessions_active ON dealer_sessions (dealer_id) WHERE ended_at IS NULL;

CREATE TABLE login_attempts (
  id bigserial PRIMARY KEY, at timestamptz NOT NULL DEFAULT now(),
  kind text NOT NULL, login_id text NOT NULL, ip text, ok boolean NOT NULL, reason text);
CREATE INDEX login_attempts_recent ON login_attempts (at);

CREATE TABLE security_audit (
  id bigserial PRIMARY KEY, at timestamptz NOT NULL DEFAULT now(),
  actor_type text, actor_id text, action text NOT NULL, target text, ip text, ok boolean NOT NULL DEFAULT true, detail jsonb);
CREATE INDEX security_audit_at ON security_audit (at);

-- secrets the browser must never see (for example the Google Apps Script secret): AES-256-GCM sealed with SECRETS_KEY from the environment
CREATE TABLE integration_secrets (
  key text PRIMARY KEY, ciphertext text NOT NULL, meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by text, updated_at timestamptz NOT NULL DEFAULT now());

-- which Google Sheet each department has linked (the server only ever writes to a linked sheet)
CREATE TABLE sheet_links (dept text PRIMARY KEY, sheet_id text NOT NULL, linked_by text NOT NULL, linked_at timestamptz NOT NULL DEFAULT now());
