-- 005: Phase 1-4 of the operations update. Forward-only; no data is deleted.

-- ===================== Phase 1: Host provisioning protection (enforced in the DATABASE, not only the UI) =====================
CREATE FUNCTION is_host_dept(dept int) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT EXISTS (SELECT 1 FROM departments WHERE id = dept AND code = 'HOST') $$;
CREATE FUNCTION is_host_role(rid int) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT EXISTS (SELECT 1 FROM roles WHERE id = rid AND code = 'HOST') $$;
CREATE FUNCTION guard_host_employee() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE new_host boolean; old_host boolean := false; other_host boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF is_host_dept(OLD.department_id) OR (OLD.role_id IS NOT NULL AND is_host_role(OLD.role_id)) THEN RAISE EXCEPTION 'LAST_SUPER_ADMIN: a Host account cannot be deleted'; END IF;
    RETURN OLD;
  END IF;
  new_host := is_host_dept(NEW.department_id) OR (NEW.role_id IS NOT NULL AND is_host_role(NEW.role_id));
  IF TG_OP = 'UPDATE' THEN old_host := is_host_dept(OLD.department_id) OR (OLD.role_id IS NOT NULL AND is_host_role(OLD.role_id)); END IF;
  IF new_host AND NOT old_host AND coalesce(current_setting('app.host_provisioning', true), '') <> 'on' THEN
    SELECT EXISTS (SELECT 1 FROM employees e WHERE e.id <> NEW.id AND is_host_dept(e.department_id)) INTO other_host;
    IF other_host THEN RAISE EXCEPTION 'HOST_PROVISIONING_RESTRICTED: a Host account cannot be created or assigned through employee management'; END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND old_host AND coalesce(current_setting('app.host_recovery', true), '') <> 'on'
     AND (NOT new_host OR NEW.status <> 'ACTIVE') AND OLD.status = 'ACTIVE'
     AND NOT EXISTS (SELECT 1 FROM employees e WHERE e.id <> NEW.id AND e.status = 'ACTIVE' AND is_host_dept(e.department_id)) THEN
    RAISE EXCEPTION 'LAST_SUPER_ADMIN: the last active Host cannot be deactivated or changed without the recovery procedure';
  END IF;
  IF new_host OR old_host THEN
    INSERT INTO audit_logs (actor_type, actor_id, action, entity, entity_id, before, after)
    VALUES ('SYSTEM', nullif(current_setting('app.actor_id', true), ''), 'PRIVILEGED_ROLE_CHANGE', 'employee', NEW.id::text, CASE WHEN TG_OP = 'UPDATE' THEN jsonb_build_object('status', OLD.status, 'department_id', OLD.department_id, 'role_id', OLD.role_id) END,
            jsonb_build_object('status', NEW.status, 'department_id', NEW.department_id, 'role_id', NEW.role_id));
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER employees_host_guard BEFORE INSERT OR UPDATE OR DELETE ON employees FOR EACH ROW EXECUTE FUNCTION guard_host_employee();

-- ===================== Phase 2: attendance tied to portal sessions =====================
ALTER TABLE shift_sessions ADD COLUMN login_at timestamptz, ADD COLUMN logout_at timestamptz, ADD COLUMN needs_recovery boolean NOT NULL DEFAULT false, ADD COLUMN recovery_reason text,
  ADD COLUMN net_minutes int, ADD COLUMN late_minutes int, ADD COLUMN early_minutes int, ADD COLUMN ended_by text;
CREATE TABLE portal_sessions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), employee_id uuid NOT NULL REFERENCES employees(id), shift_session_id uuid REFERENCES shift_sessions(id),
  token_hash text UNIQUE NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), last_seen_at timestamptz NOT NULL DEFAULT now(), ended_at timestamptz,
  end_reason text CHECK (end_reason IN ('LOGOUT','EXPIRED','ADMIN')), user_agent text);
CREATE INDEX portal_sessions_active ON portal_sessions (employee_id) WHERE ended_at IS NULL;
CREATE INDEX portal_sessions_idle ON portal_sessions (last_seen_at) WHERE ended_at IS NULL;
INSERT INTO app_settings (key, value) VALUES ('attendance.policy', '{"logoutPolicy":"ALWAYS","idleMinutes":30}') ON CONFLICT (key) DO NOTHING;

-- ===================== Phase 2: sales attribution snapshots (history never changes when staff are reassigned) =====================
ALTER TABLE orders ADD COLUMN sales_employee_code text, ADD COLUMN sales_employee_name text, ADD COLUMN creator_kind text, ADD COLUMN creator_code text, ADD COLUMN creator_name text, ADD COLUMN creator_role text,
  ADD COLUMN attribution_status text NOT NULL DEFAULT 'PENDING' CHECK (attribution_status IN ('ASSIGNED','PENDING'));
CREATE FUNCTION snapshot_order_attribution() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e record; d record;
BEGIN
  IF NEW.sales_employee_id IS NULL THEN SELECT sales_employee_id INTO NEW.sales_employee_id FROM dealers WHERE id = NEW.dealer_id; END IF;   -- Host / dealer orders use the dealer's assigned Sales employee
  IF NEW.sales_employee_id IS NOT NULL THEN SELECT employee_code, name INTO e FROM employees WHERE id = NEW.sales_employee_id; NEW.sales_employee_code := e.employee_code; NEW.sales_employee_name := e.name; NEW.attribution_status := 'ASSIGNED';
  ELSE NEW.attribution_status := 'PENDING'; NEW.needs_manual_attribution := true; END IF;
  IF NEW.created_by_employee_id IS NOT NULL THEN SELECT e2.employee_code, e2.name, dp.code INTO e FROM employees e2 LEFT JOIN departments dp ON dp.id = e2.department_id WHERE e2.id = NEW.created_by_employee_id; NEW.creator_kind := 'EMPLOYEE'; NEW.creator_code := e.employee_code; NEW.creator_name := e.name; NEW.creator_role := e.code;
  ELSE SELECT dealer_code, name INTO d FROM dealers WHERE id = NEW.dealer_id; NEW.creator_kind := 'DEALER'; NEW.creator_code := d.dealer_code; NEW.creator_name := d.name; NEW.creator_role := 'DEALER'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER orders_snapshot BEFORE INSERT ON orders FOR EACH ROW EXECUTE FUNCTION snapshot_order_attribution();
CREATE FUNCTION guard_order_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.creator_kind, NEW.creator_code, NEW.creator_name, NEW.creator_role) IS DISTINCT FROM (OLD.creator_kind, OLD.creator_code, OLD.creator_name, OLD.creator_role) THEN RAISE EXCEPTION 'SNAPSHOT_IMMUTABLE: order creator is historical'; END IF;
  IF OLD.attribution_status = 'ASSIGNED' AND (NEW.sales_employee_id, NEW.sales_employee_code, NEW.sales_employee_name) IS DISTINCT FROM (OLD.sales_employee_id, OLD.sales_employee_code, OLD.sales_employee_name) THEN RAISE EXCEPTION 'SNAPSHOT_IMMUTABLE: sales attribution is historical'; END IF;
  RETURN NEW;
END $$;
UPDATE orders o SET sales_employee_code = e.employee_code, sales_employee_name = e.name, attribution_status = 'ASSIGNED' FROM employees e WHERE e.id = o.sales_employee_id AND o.sales_employee_code IS NULL;
UPDATE orders o SET creator_kind = 'EMPLOYEE', creator_code = e.employee_code, creator_name = e.name, creator_role = dp.code FROM employees e LEFT JOIN departments dp ON dp.id = e.department_id WHERE e.id = o.created_by_employee_id AND o.creator_kind IS NULL;
UPDATE orders o SET creator_kind = 'DEALER', creator_code = d.dealer_code, creator_name = d.name, creator_role = 'DEALER' FROM dealers d WHERE d.id = o.dealer_id AND o.creator_kind IS NULL;
-- the guard is switched on only AFTER the one-time backfill above
CREATE TRIGGER orders_snapshot_guard BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION guard_order_snapshot();
CREATE INDEX orders_dealer_created ON orders (dealer_id, created_at DESC); CREATE INDEX orders_sales_created ON orders (sales_employee_id, created_at DESC); CREATE INDEX orders_status_created ON orders (status, created_at DESC);

-- ===================== Phase 2: money received per order (Razorpay captures AND verified manual proofs) =====================
ALTER TABLE orders ADD COLUMN paid_paise bigint NOT NULL DEFAULT 0 CHECK (paid_paise >= 0);
UPDATE orders o SET paid_paise = greatest(0, coalesce((SELECT sum(amount_paise) FROM payment_captures c WHERE c.order_id = o.id), 0) - coalesce((SELECT sum(amount_paise) FROM refunds r WHERE r.order_id = o.id), 0));
CREATE FUNCTION bump_paid_on_capture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN UPDATE orders SET paid_paise = paid_paise + NEW.amount_paise WHERE id = NEW.order_id; RETURN NEW; END $$;
CREATE TRIGGER captures_paid AFTER INSERT ON payment_captures FOR EACH ROW EXECUTE FUNCTION bump_paid_on_capture();
CREATE FUNCTION drop_paid_on_refund() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN UPDATE orders SET paid_paise = greatest(0, paid_paise - NEW.amount_paise) WHERE id = NEW.order_id; RETURN NEW; END $$;
CREATE TRIGGER refunds_paid AFTER INSERT ON refunds FOR EACH ROW EXECUTE FUNCTION drop_paid_on_refund();
CREATE TABLE payment_proofs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL REFERENCES orders(id),
  method text NOT NULL CHECK (method IN ('UPI','BANK_TRANSFER','CHEQUE','CASH_DEPOSIT','OTHER')), reference text NOT NULL CHECK (length(btrim(reference)) >= 6), paid_on date NOT NULL,
  claimed_paise bigint NOT NULL CHECK (claimed_paise > 0), storage_key text NOT NULL, filename text NOT NULL, content_type text NOT NULL CHECK (content_type IN ('image/png','image/jpeg','application/pdf')),
  size_bytes bigint NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 10485760), sha256 text NOT NULL, uploaded_by_employee_id uuid REFERENCES employees(id), uploaded_by_dealer_id uuid REFERENCES dealers(id), uploaded_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'AWAITING_VERIFICATION' CHECK (status IN ('AWAITING_VERIFICATION','VERIFIED','REJECTED')), verified_paise bigint CHECK (verified_paise IS NULL OR verified_paise > 0),
  decided_by uuid REFERENCES employees(id), decided_at timestamptz, notes text, rejection_reason text, supersedes uuid REFERENCES payment_proofs(id), capture_id uuid REFERENCES payment_captures(id),
  CHECK (uploaded_by_employee_id IS NOT NULL OR uploaded_by_dealer_id IS NOT NULL));
CREATE UNIQUE INDEX payment_proofs_live_reference ON payment_proofs (lower(btrim(reference))) WHERE status <> 'REJECTED';     -- one UTR can back only one live claim
CREATE INDEX payment_proofs_queue ON payment_proofs (status, uploaded_at) WHERE status = 'AWAITING_VERIFICATION'; CREATE INDEX payment_proofs_order ON payment_proofs (order_id);

-- ===================== Phase 3: batch inventory =====================
CREATE TABLE inventory_batches (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), product_id uuid NOT NULL REFERENCES products(id), batch_number text NOT NULL CHECK (length(btrim(batch_number)) >= 1), location text NOT NULL DEFAULT 'MAIN',
  mfg_date date, expiry_date date, unit text NOT NULL DEFAULT 'PCS', supplier text, receipt_ref text, unit_cost_paise bigint CHECK (unit_cost_paise IS NULL OR unit_cost_paise >= 0),
  qty_received int NOT NULL DEFAULT 0 CHECK (qty_received >= 0), qty_on_hand int NOT NULL DEFAULT 0 CHECK (qty_on_hand >= 0), qty_damaged int NOT NULL DEFAULT 0 CHECK (qty_damaged >= 0), qty_quarantined int NOT NULL DEFAULT 0 CHECK (qty_quarantined >= 0),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','QUARANTINED','EXPIRED','CLOSED')), received_by uuid REFERENCES employees(id), received_at timestamptz NOT NULL DEFAULT now(), document_key text,
  CHECK (mfg_date IS NULL OR expiry_date IS NULL OR mfg_date <= expiry_date), CHECK (batch_number = 'OPENING-LEGACY' OR (mfg_date IS NOT NULL AND expiry_date IS NOT NULL)), UNIQUE (product_id, batch_number, location));
CREATE INDEX inventory_batches_fefo ON inventory_batches (product_id, expiry_date NULLS LAST, received_at) WHERE status = 'ACTIVE' AND qty_on_hand > 0;
CREATE TABLE batch_movements (id bigserial PRIMARY KEY, batch_id uuid NOT NULL REFERENCES inventory_batches(id), product_id uuid NOT NULL REFERENCES products(id),
  kind text NOT NULL CHECK (kind IN ('OPENING','STOCK_IN','STOCK_OUT','ISSUE_ORDER','ADJUSTMENT','COUNT_ADJUSTMENT','RETURN_IN','DAMAGE','QUARANTINE','RELEASE_QUARANTINE','EXPIRE')),
  delta_on_hand int NOT NULL DEFAULT 0, delta_damaged int NOT NULL DEFAULT 0, delta_quarantined int NOT NULL DEFAULT 0, on_hand_before int NOT NULL, on_hand_after int NOT NULL, reason text, ref_type text, ref_id text, actor_id uuid REFERENCES employees(id), created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX batch_movements_batch ON batch_movements (batch_id, id); CREATE INDEX batch_movements_product ON batch_movements (product_id, id);
CREATE FUNCTION forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'IMMUTABLE_HISTORY: % on % is not allowed', TG_OP, TG_TABLE_NAME; END $$;
CREATE TRIGGER batch_movements_immutable BEFORE UPDATE OR DELETE ON batch_movements FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
/* the product-level balance that orders reserve against is the SUM of saleable batch stock (active, not expired). Reserved stays order-driven. */
CREATE FUNCTION sync_product_balance(pid uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE saleable int;
BEGIN
  SELECT coalesce(sum(qty_on_hand), 0) INTO saleable FROM inventory_batches WHERE product_id = pid AND status = 'ACTIVE' AND (expiry_date IS NULL OR expiry_date >= current_date);
  INSERT INTO inventory_balances (product_id, on_hand, reserved) VALUES (pid, saleable, 0) ON CONFLICT (product_id) DO UPDATE SET on_hand = EXCLUDED.on_hand, updated_at = now();
END $$;
CREATE FUNCTION batch_sync_trigger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM sync_product_balance(NEW.product_id); RETURN NEW; END $$;
CREATE TRIGGER batches_sync AFTER INSERT OR UPDATE OF qty_on_hand, status, expiry_date ON inventory_batches FOR EACH ROW EXECUTE FUNCTION batch_sync_trigger();
-- stock already on the shelf becomes an explicit OPENING-LEGACY batch so nothing is lost when batch tracking starts
INSERT INTO inventory_batches (product_id, batch_number, qty_received, qty_on_hand) SELECT product_id, 'OPENING-LEGACY', on_hand, on_hand FROM inventory_balances WHERE on_hand > 0;
INSERT INTO batch_movements (batch_id, product_id, kind, delta_on_hand, on_hand_before, on_hand_after, reason) SELECT id, product_id, 'OPENING', qty_on_hand, 0, qty_on_hand, 'Opening balance migrated from product-level stock' FROM inventory_batches WHERE batch_number = 'OPENING-LEGACY';
CREATE TABLE stock_adjustment_requests (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), kind text NOT NULL CHECK (kind IN ('COUNT','ADJUST')), batch_id uuid NOT NULL REFERENCES inventory_batches(id), product_id uuid NOT NULL REFERENCES products(id),
  system_qty int NOT NULL, new_qty int NOT NULL CHECK (new_qty >= 0), reason text NOT NULL CHECK (length(btrim(reason)) >= 5), document_key text, status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED','CONFLICT')),
  requested_by uuid NOT NULL REFERENCES employees(id), requested_at timestamptz NOT NULL DEFAULT now(), decided_by uuid REFERENCES employees(id), decided_at timestamptz, decision_note text, movement_id bigint REFERENCES batch_movements(id));
CREATE INDEX stock_adjustments_open ON stock_adjustment_requests (status, requested_at) WHERE status IN ('PENDING','CONFLICT');

-- ===================== Phase 4: Warehouse "seen" indicator =====================
CREATE TABLE order_view_events (id bigserial PRIMARY KEY, order_id uuid NOT NULL REFERENCES orders(id), employee_id uuid NOT NULL REFERENCES employees(id), kind text NOT NULL CHECK (kind IN ('VIEWED','ACKNOWLEDGED')), at timestamptz NOT NULL DEFAULT now());
CREATE INDEX order_view_events_order ON order_view_events (order_id, id);
CREATE TABLE order_warehouse_seen (order_id uuid PRIMARY KEY REFERENCES orders(id), first_seen_at timestamptz NOT NULL, first_seen_by uuid NOT NULL REFERENCES employees(id), last_seen_at timestamptz NOT NULL, last_seen_by uuid NOT NULL REFERENCES employees(id), seen_count int NOT NULL DEFAULT 1);
