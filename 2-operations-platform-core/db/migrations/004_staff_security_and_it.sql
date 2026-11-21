-- 004: staff two-factor (Google Authenticator), activity trail, IT department, custom sample lines, stock returns, document numbers
INSERT INTO departments (code, name) VALUES ('IT','IT') ON CONFLICT (code) DO NOTHING;
INSERT INTO designations (department_id, name) SELECT d.id, x FROM departments d, unnest(ARRAY['Software Developer','DevOps Engineer','Support Engineer','System Administrator','QA Engineer','Network Engineer']) x WHERE d.code='IT' ON CONFLICT DO NOTHING;

-- TOTP secrets are stored ENCRYPTED (AES-256-GCM, key from TOTP_ENC_KEY). last_step blocks re-use of a code; 5 wrong codes lock the account for 5 minutes.
CREATE TABLE staff_totp (employee_id uuid PRIMARY KEY REFERENCES employees(id) ON DELETE CASCADE, secret text NOT NULL, pending boolean NOT NULL DEFAULT true,
  enabled_at timestamptz, last_step bigint NOT NULL DEFAULT 0, failed_attempts int NOT NULL DEFAULT 0, locked_until timestamptz);

-- every notable employee action (sign-in, order placed, stock moved, invoice uploaded...) is recorded; the Host is notified for all but their own
CREATE TABLE activity_events (id bigserial PRIMARY KEY, actor_id uuid REFERENCES employees(id) ON DELETE CASCADE, action text NOT NULL, detail text, kind text NOT NULL DEFAULT 'action', created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX activity_events_recent ON activity_events (created_at DESC);

-- sample orders: the Sales employee picks the BRAND and types a custom product name; no catalogue product, no stock reservation
ALTER TABLE sample_order_items ALTER COLUMN product_id DROP NOT NULL;
ALTER TABLE sample_order_items ADD COLUMN brand_id uuid REFERENCES brands(id), ADD COLUMN custom_name text;
ALTER TABLE sample_order_items ADD CONSTRAINT sample_item_kind CHECK (product_id IS NOT NULL OR (brand_id IS NOT NULL AND length(btrim(custom_name)) >= 2));

ALTER TABLE inventory_balances ADD COLUMN returned_total int NOT NULL DEFAULT 0;
ALTER TABLE documents ADD COLUMN doc_number text;     -- invoice number / e-way bill number typed at upload
