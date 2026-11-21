-- S-ELEVEN operations platform: initial schema. All money is stored as integer PAISE (bigint). Timestamps are timestamptz (UTC).
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE order_status AS ENUM ('PENDING_PAYMENT','PAID_AWAITING_LOGISTICS','INVOICE_ATTACHED','AWAITING_WAREHOUSE','PACKING_IN_PROGRESS','PACKED_READY','READY_FOR_DISPATCH','SHIPPED','DELIVERED','ON_HOLD','CANCELLED','EXPIRED');
CREATE TYPE payment_status AS ENUM ('CREATED','PENDING','CAPTURED','FAILED','EXPIRED');

-- ---------- people, roles, permissions ----------
CREATE TABLE departments (id serial PRIMARY KEY, code text UNIQUE NOT NULL, name text NOT NULL);
CREATE TABLE roles (id serial PRIMARY KEY, code text UNIQUE NOT NULL, name text NOT NULL, department_id int REFERENCES departments(id));
CREATE TABLE permissions (id serial PRIMARY KEY, code text UNIQUE NOT NULL);
CREATE TABLE role_permissions (role_id int REFERENCES roles(id) ON DELETE CASCADE, permission_id int REFERENCES permissions(id) ON DELETE CASCADE, PRIMARY KEY (role_id, permission_id));
CREATE TABLE employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), employee_code text UNIQUE NOT NULL, name text NOT NULL, email text UNIQUE NOT NULL, mobile text,
  department_id int REFERENCES departments(id), designation text, role_id int REFERENCES roles(id), manager_id uuid REFERENCES employees(id),
  status text NOT NULL DEFAULT 'INVITED' CHECK (status IN ('INVITED','ACTIVE','SUSPENDED','INACTIVE')), password_hash text, joined_on date, mfa_enabled boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE brands (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text UNIQUE NOT NULL, name text NOT NULL, active boolean NOT NULL DEFAULT true);
CREATE TABLE employee_brands (employee_id uuid REFERENCES employees(id) ON DELETE CASCADE, brand_id uuid REFERENCES brands(id), PRIMARY KEY (employee_id, brand_id));

-- ---------- catalogue + dealers ----------
CREATE TABLE products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), sku text UNIQUE NOT NULL, name text NOT NULL, brand_id uuid NOT NULL REFERENCES brands(id),
  base_price_paise bigint NOT NULL CHECK (base_price_paise >= 0), gst_rate_bp int NOT NULL DEFAULT 500 CHECK (gst_rate_bp >= 0), hsn text, image_url text, active boolean NOT NULL DEFAULT true);
CREATE TABLE dealers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), dealer_code text UNIQUE NOT NULL, name text NOT NULL, contact_name text, phone text, email text, gstin text, category text,
  sales_employee_id uuid REFERENCES employees(id), status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED','INACTIVE')), payment_terms text NOT NULL DEFAULT 'ADVANCE', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE dealer_addresses (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), dealer_id uuid NOT NULL REFERENCES dealers(id) ON DELETE CASCADE, kind text NOT NULL CHECK (kind IN ('BILLING','SHIPPING')), line1 text NOT NULL, city text, state text, pincode text);
CREATE TABLE dealer_brands (dealer_id uuid REFERENCES dealers(id) ON DELETE CASCADE, brand_id uuid REFERENCES brands(id), PRIMARY KEY (dealer_id, brand_id));
-- pricing: a FIXED dealer rate for one product, or a PERCENT discount (dealer-wide or per brand). Fixed beats percent. Effective-dated.
CREATE TABLE dealer_price_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), dealer_id uuid NOT NULL REFERENCES dealers(id), brand_id uuid REFERENCES brands(id), product_id uuid REFERENCES products(id),
  discount_bp int CHECK (discount_bp BETWEEN 0 AND 10000), fixed_price_paise bigint CHECK (fixed_price_paise >= 0),
  effective_from timestamptz NOT NULL DEFAULT now(), effective_to timestamptz, created_by uuid REFERENCES employees(id), created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(discount_bp, fixed_price_paise) = 1),
  CHECK (fixed_price_paise IS NULL OR product_id IS NOT NULL),
  CHECK (effective_to IS NULL OR effective_to > effective_from));

-- ---------- freebies ----------
CREATE TABLE freebie_slabs (id serial PRIMARY KEY, min_cart_paise bigint NOT NULL CHECK (min_cart_paise > 0), max_allowance_paise bigint NOT NULL CHECK (max_allowance_paise >= 0), active boolean NOT NULL DEFAULT true, UNIQUE (min_cart_paise));
CREATE TABLE freebie_schemes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, priority int NOT NULL DEFAULT 100, all_dealers boolean NOT NULL DEFAULT false, min_cart_paise bigint NOT NULL DEFAULT 0,
  max_allowance_paise bigint, starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL, active boolean NOT NULL DEFAULT true, created_by uuid REFERENCES employees(id), CHECK (ends_at > starts_at));
CREATE TABLE freebie_scheme_dealers (scheme_id uuid REFERENCES freebie_schemes(id) ON DELETE CASCADE, dealer_id uuid REFERENCES dealers(id), PRIMARY KEY (scheme_id, dealer_id));
CREATE TABLE freebie_scheme_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), scheme_id uuid NOT NULL REFERENCES freebie_schemes(id) ON DELETE CASCADE, product_id uuid NOT NULL REFERENCES products(id),
  valuation_paise bigint NOT NULL CHECK (valuation_paise >= 0), max_qty_per_order int NOT NULL DEFAULT 1 CHECK (max_qty_per_order > 0), UNIQUE (scheme_id, product_id));

-- ---------- central inventory ----------
CREATE TABLE inventory_balances (
  product_id uuid PRIMARY KEY REFERENCES products(id), on_hand int NOT NULL DEFAULT 0 CHECK (on_hand >= 0), reserved int NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(), CHECK (reserved <= on_hand));
CREATE TABLE stock_movements (id bigserial PRIMARY KEY, product_id uuid NOT NULL REFERENCES products(id), delta int NOT NULL, kind text NOT NULL, ref_type text, ref_id text, reason text, actor_id uuid, created_at timestamptz NOT NULL DEFAULT now());

-- ---------- orders (item rows are immutable snapshots) ----------
CREATE TABLE orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_number text UNIQUE NOT NULL, dealer_id uuid NOT NULL REFERENCES dealers(id),
  created_by_employee_id uuid REFERENCES employees(id), sales_employee_id uuid REFERENCES employees(id), needs_manual_attribution boolean NOT NULL DEFAULT false,
  status order_status NOT NULL DEFAULT 'PENDING_PAYMENT', idempotency_key text NOT NULL,
  merchandise_paise bigint NOT NULL, tax_paise bigint NOT NULL, shipping_paise bigint NOT NULL DEFAULT 0, freebie_value_paise bigint NOT NULL DEFAULT 0, total_paise bigint NOT NULL,
  currency char(3) NOT NULL DEFAULT 'INR', requires_packing boolean NOT NULL DEFAULT true, expires_at timestamptz, paid_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (dealer_id, idempotency_key));
CREATE TABLE order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL REFERENCES orders(id), product_id uuid NOT NULL REFERENCES products(id), sku text NOT NULL, name text NOT NULL,
  brand_id uuid NOT NULL REFERENCES brands(id), brand_code text NOT NULL, qty int NOT NULL CHECK (qty > 0), base_price_paise bigint NOT NULL, discount_bp int NOT NULL DEFAULT 0,
  unit_price_paise bigint NOT NULL, price_source text NOT NULL CHECK (price_source IN ('FIXED','PERCENT','BASE')), gst_rate_bp int NOT NULL, line_total_paise bigint NOT NULL,
  tax_paise bigint NOT NULL, eligible_paise bigint NOT NULL);
CREATE TABLE order_freebies (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL REFERENCES orders(id), scheme_id uuid NOT NULL REFERENCES freebie_schemes(id), product_id uuid NOT NULL REFERENCES products(id), qty int NOT NULL CHECK (qty > 0), valuation_paise bigint NOT NULL);
CREATE TABLE order_status_history (id bigserial PRIMARY KEY, order_id uuid NOT NULL REFERENCES orders(id), from_status order_status, to_status order_status NOT NULL, actor_type text NOT NULL, actor_id text, reason text, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE inventory_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL REFERENCES orders(id), product_id uuid NOT NULL REFERENCES products(id), qty int NOT NULL CHECK (qty > 0), is_freebie boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','RELEASED','CONSUMED')), created_at timestamptz NOT NULL DEFAULT now(), settled_at timestamptz, UNIQUE (order_id, product_id, is_freebie));

-- ---------- payments (provider events are idempotent) ----------
CREATE TABLE payment_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL REFERENCES orders(id), provider text NOT NULL, provider_order_ref text UNIQUE, idempotency_key text UNIQUE NOT NULL,
  amount_paise bigint NOT NULL CHECK (amount_paise > 0), currency char(3) NOT NULL DEFAULT 'INR', status payment_status NOT NULL DEFAULT 'CREATED', qr_payload text, expires_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX one_active_attempt_per_order ON payment_attempts (order_id) WHERE status IN ('CREATED','PENDING');
CREATE TABLE payment_webhooks (id bigserial PRIMARY KEY, provider text NOT NULL, provider_event_id text NOT NULL, payload jsonb NOT NULL, received_at timestamptz NOT NULL DEFAULT now(), outcome text, UNIQUE (provider, provider_event_id));
CREATE TABLE payment_captures (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), attempt_id uuid NOT NULL REFERENCES payment_attempts(id), order_id uuid NOT NULL REFERENCES orders(id), provider_txn_ref text UNIQUE NOT NULL, amount_paise bigint NOT NULL CHECK (amount_paise > 0), captured_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE refunds (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), capture_id uuid NOT NULL REFERENCES payment_captures(id), order_id uuid NOT NULL REFERENCES orders(id), amount_paise bigint NOT NULL CHECK (amount_paise > 0), kind text NOT NULL CHECK (kind IN ('REFUND','CHARGEBACK')), provider_refund_ref text UNIQUE NOT NULL, reason text, created_at timestamptz NOT NULL DEFAULT now());

-- ---------- sales targets: Host-managed targets + append-only credit ledger ----------
CREATE TABLE employee_targets (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), employee_id uuid NOT NULL REFERENCES employees(id), brand_id uuid NOT NULL REFERENCES brands(id), month date NOT NULL CHECK (month = date_trunc('month', month)::date), target_paise bigint NOT NULL CHECK (target_paise >= 0), created_by uuid REFERENCES employees(id), UNIQUE (employee_id, brand_id, month));
CREATE TABLE target_credit_ledger (
  id bigserial PRIMARY KEY, source_event_key text UNIQUE NOT NULL, employee_id uuid NOT NULL REFERENCES employees(id), brand_id uuid NOT NULL REFERENCES brands(id), month date NOT NULL,
  amount_paise bigint NOT NULL CHECK (amount_paise <> 0), kind text NOT NULL CHECK (kind IN ('CREDIT','REFUND_REVERSAL','CHARGEBACK_REVERSAL','ADJUSTMENT')), order_id uuid REFERENCES orders(id), created_at timestamptz NOT NULL DEFAULT now());

-- ---------- documents, shipments ----------
CREATE TABLE documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL REFERENCES orders(id), kind text NOT NULL CHECK (kind IN ('INVOICE','EWAY_BILL')), version int NOT NULL, storage_key text NOT NULL, filename text NOT NULL,
  content_type text NOT NULL, size_bytes bigint NOT NULL CHECK (size_bytes > 0), sha256 text NOT NULL, uploaded_by uuid REFERENCES employees(id), uploaded_at timestamptz NOT NULL DEFAULT now(), is_current boolean NOT NULL DEFAULT true, UNIQUE (order_id, kind, version));
CREATE UNIQUE INDEX one_current_document ON documents (order_id, kind) WHERE is_current;
CREATE TABLE shipments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid UNIQUE NOT NULL REFERENCES orders(id), courier text NOT NULL, tracking_number text NOT NULL, tracking_url text, dispatched_on date, eway_bill_no text, created_by uuid REFERENCES employees(id), created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE tracking_events (id bigserial PRIMARY KEY, shipment_id uuid NOT NULL REFERENCES shipments(id), event text NOT NULL, occurred_at timestamptz NOT NULL DEFAULT now());

-- ---------- warehouse ----------
CREATE TABLE warehouse_shifts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), warehouse_code text NOT NULL DEFAULT 'MAIN', opened_by uuid REFERENCES employees(id), opened_at timestamptz NOT NULL DEFAULT now(), closed_by uuid REFERENCES employees(id), closed_at timestamptz, status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED')), close_kind text CHECK (close_kind IN ('NORMAL','HOST_OVERRIDE')));
CREATE UNIQUE INDEX one_open_shift_per_warehouse ON warehouse_shifts (warehouse_code) WHERE status = 'OPEN';
CREATE TABLE packing_records (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid UNIQUE NOT NULL REFERENCES orders(id), status text NOT NULL DEFAULT 'PENDING', packed_by uuid REFERENCES employees(id), packed_at timestamptz, discrepancy_note text);
CREATE TABLE shift_overrides (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shift_id uuid NOT NULL REFERENCES warehouse_shifts(id), host_id uuid NOT NULL REFERENCES employees(id), reason text NOT NULL CHECK (length(btrim(reason)) >= 10), blocking_orders jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());

-- ---------- notifications, reminders, audit ----------
CREATE TABLE notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), kind text NOT NULL, recipient_department text, order_id uuid REFERENCES orders(id), slot int, payload jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), read_at timestamptz);
CREATE UNIQUE INDEX one_reminder_per_slot ON notifications (order_id, kind, slot) WHERE slot IS NOT NULL;
CREATE TABLE notification_deliveries (id bigserial PRIMARY KEY, notification_id uuid NOT NULL REFERENCES notifications(id), channel text NOT NULL, attempt int NOT NULL DEFAULT 1, status text NOT NULL, error text, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE reminder_state (order_id uuid NOT NULL REFERENCES orders(id), kind text NOT NULL CHECK (kind IN ('MISSING_INVOICE','MISSING_TRACKING')), eligible_at timestamptz NOT NULL, resolved_at timestamptz, PRIMARY KEY (order_id, kind));
CREATE TABLE audit_logs (id bigserial PRIMARY KEY, actor_type text NOT NULL, actor_id text, action text NOT NULL, entity text NOT NULL, entity_id text, before jsonb, after jsonb, created_at timestamptz NOT NULL DEFAULT now());

-- ---------- append-only / immutability guards ----------
CREATE FUNCTION forbid_change() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION '% is append-only (% not allowed)', TG_TABLE_NAME, TG_OP; END $$;
CREATE TRIGGER ledger_append_only BEFORE UPDATE OR DELETE ON target_credit_ledger FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER audit_append_only BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER status_history_append_only BEFORE UPDATE OR DELETE ON order_status_history FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER order_items_immutable BEFORE UPDATE OR DELETE ON order_items FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER shift_overrides_append_only BEFORE UPDATE OR DELETE ON shift_overrides FOR EACH ROW EXECUTE FUNCTION forbid_change();
-- pricing changes are audited automatically
CREATE FUNCTION audit_price_rule() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  INSERT INTO audit_logs (actor_type, actor_id, action, entity, entity_id, before, after) VALUES ('SYSTEM', NULL, 'PRICE_RULE_' || TG_OP, 'dealer_price_rules', COALESCE(NEW.id, OLD.id)::text, CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END, CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END);
  RETURN COALESCE(NEW, OLD); END $$;
CREATE TRIGGER price_rule_audit AFTER INSERT OR UPDATE OR DELETE ON dealer_price_rules FOR EACH ROW EXECUTE FUNCTION audit_price_rule();

CREATE INDEX orders_status_idx ON orders (status, created_at);
CREATE INDEX orders_dealer_idx ON orders (dealer_id, created_at DESC);
CREATE INDEX orders_sales_emp_idx ON orders (sales_employee_id);
CREATE INDEX ledger_emp_month_idx ON target_credit_ledger (employee_id, month, brand_id);
CREATE INDEX stock_movements_product_idx ON stock_movements (product_id, created_at);
CREATE INDEX price_rules_lookup_idx ON dealer_price_rules (dealer_id, product_id, brand_id, effective_from);
CREATE INDEX audit_entity_idx ON audit_logs (entity, entity_id);

-- seed: departments, default freebie slabs (Host-configurable)
INSERT INTO departments (code, name) VALUES ('HOST','Host / Admin'),('SALES','Sales'),('LOGISTICS','Logistics'),('WAREHOUSE','Warehouse'),('FINANCE','Finance');
INSERT INTO freebie_slabs (min_cart_paise, max_allowance_paise) VALUES (500000, 30000), (1000000, 60000), (2000000, 100000), (3000000, 150000), (4000000, 200000), (5000000, 250000);
