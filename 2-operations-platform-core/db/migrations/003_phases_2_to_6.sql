-- Phases 2-6: inventory ledger, preorders, attendance, HR leave, Branding, packing verification, promotions, samples.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ---------- departments, designations, settings ----------
INSERT INTO departments (code, name) VALUES ('BRANDING','Branding') ON CONFLICT (code) DO NOTHING;
CREATE TABLE designations (id serial PRIMARY KEY, department_id int NOT NULL REFERENCES departments(id), name text NOT NULL, UNIQUE (department_id, name));
INSERT INTO designations (department_id, name) SELECT d.id, x FROM departments d, unnest(ARRAY['Graphic Designer','UI/UX Designer','Software Developer','Social Media Manager','Content Creator','Video Editor','Brand Manager','Marketing Designer']) AS x WHERE d.code='BRANDING';
CREATE TABLE app_settings (key text PRIMARY KEY, value jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
INSERT INTO app_settings (key, value) VALUES
  ('work_schedule', '{"start":"09:30","end":"18:30","lunchMinutes":60,"standardMinutes":480,"lunchMinSpanMinutes":300,"timezone":"Asia/Kolkata","weeklyOff":[0]}'),
  ('preorder', '{"paymentWindowMinutes":120,"reminderMinutes":60}');

-- ---------- inventory ledger: before/after quantities, damaged, receipts ----------
ALTER TABLE stock_movements ADD COLUMN qty_before int, ADD COLUMN qty_after int;
ALTER TABLE inventory_balances ADD COLUMN damaged int NOT NULL DEFAULT 0 CHECK (damaged >= 0), ADD COLUMN received_total int NOT NULL DEFAULT 0, ADD COLUMN opening int NOT NULL DEFAULT 0, ADD COLUMN updated_by uuid REFERENCES employees(id);
ALTER TABLE products ADD COLUMN allow_preorder boolean NOT NULL DEFAULT false;
ALTER TABLE notifications ADD COLUMN recipient_dealer_id uuid REFERENCES dealers(id), ADD COLUMN recipient_employee_id uuid REFERENCES employees(id);

-- ---------- default freebie slabs (Host can change all of them) ----------
DELETE FROM freebie_slabs;
INSERT INTO freebie_slabs (min_cart_paise, max_allowance_paise) VALUES
  (1000000,50000),(2000000,100000),(3000000,150000),(4000000,200000),(5000000,250000),(7000000,300000),(9000000,350000),(11000000,400000),
  (13000000,450000),(15000000,500000),(20000000,600000),(25000000,700000),(30000000,800000),(35000000,900000),(40000000,1000000);

-- ---------- orders: coupons, per-line discount and freebie eligibility ----------
ALTER TABLE orders ADD COLUMN coupon_code text, ADD COLUMN coupon_discount_paise bigint NOT NULL DEFAULT 0, ADD COLUMN source text NOT NULL DEFAULT 'ORDER', ADD COLUMN created_by_role text;
ALTER TABLE order_items ADD COLUMN discount_paise bigint NOT NULL DEFAULT 0, ADD COLUMN freebie_eligible boolean NOT NULL DEFAULT true, ADD COLUMN freebie_block_reason text;

-- ---------- preorders (pay later) ----------
CREATE SEQUENCE preorder_number_seq START 5001;
CREATE TABLE preorders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), preorder_number text UNIQUE NOT NULL, dealer_id uuid NOT NULL REFERENCES dealers(id), created_by_employee_id uuid REFERENCES employees(id),
  sales_employee_id uuid REFERENCES employees(id), needs_manual_attribution boolean NOT NULL DEFAULT false, idempotency_key text NOT NULL,
  status text NOT NULL DEFAULT 'WAITING_STOCK' CHECK (status IN ('WAITING_STOCK','ALLOCATED','PAID','CANCELLED','EXPIRED')), expected_availability date,
  order_id uuid REFERENCES orders(id), created_at timestamptz NOT NULL DEFAULT now(), allocated_at timestamptz, UNIQUE (dealer_id, idempotency_key));
CREATE TABLE preorder_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), preorder_id uuid NOT NULL REFERENCES preorders(id) ON DELETE CASCADE, product_id uuid NOT NULL REFERENCES products(id), qty int NOT NULL CHECK (qty > 0),
  base_price_paise bigint NOT NULL, discount_bp int NOT NULL DEFAULT 0, unit_price_paise bigint NOT NULL, price_source text NOT NULL);
CREATE INDEX preorders_waiting_idx ON preorders (created_at) WHERE status = 'WAITING_STOCK';

-- ---------- promotions ----------
CREATE TABLE promotions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text UNIQUE, name text NOT NULL, kind text NOT NULL CHECK (kind IN ('PERCENT','FIXED','COMBO','PRODUCT')),
  percent_bp int CHECK (percent_bp BETWEEN 1 AND 10000), fixed_paise bigint CHECK (fixed_paise > 0), min_order_paise bigint NOT NULL DEFAULT 0, starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL,
  active boolean NOT NULL DEFAULT true, max_uses int, max_uses_per_dealer int, brand_id uuid REFERENCES brands(id), all_dealers boolean NOT NULL DEFAULT true,
  exclude_freebies boolean, priority int NOT NULL DEFAULT 100, created_by uuid REFERENCES employees(id), CHECK (ends_at > starts_at));
CREATE TABLE promotion_dealers (promotion_id uuid REFERENCES promotions(id) ON DELETE CASCADE, dealer_id uuid REFERENCES dealers(id), PRIMARY KEY (promotion_id, dealer_id));
CREATE TABLE promotion_products (promotion_id uuid REFERENCES promotions(id) ON DELETE CASCADE, product_id uuid REFERENCES products(id), role text NOT NULL CHECK (role IN ('REQUIRED','ELIGIBLE')), required_qty int NOT NULL DEFAULT 1, PRIMARY KEY (promotion_id, product_id));
CREATE TABLE promotion_redemptions (promotion_id uuid NOT NULL REFERENCES promotions(id), order_id uuid NOT NULL REFERENCES orders(id), dealer_id uuid NOT NULL REFERENCES dealers(id), amount_paise bigint NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (promotion_id, order_id));
CREATE TABLE freebie_exclusions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), product_id uuid REFERENCES products(id), brand_id uuid REFERENCES brands(id), dealer_id uuid REFERENCES dealers(id), scheme_id uuid REFERENCES freebie_schemes(id), reason text NOT NULL, CHECK (num_nonnulls(product_id, brand_id, dealer_id, scheme_id) >= 1));

-- ---------- attendance (every department except Host) ----------
CREATE TABLE shift_sessions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), employee_id uuid NOT NULL REFERENCES employees(id), work_date date NOT NULL, clock_in timestamptz NOT NULL, clock_out timestamptz,
  missing_clock_out boolean NOT NULL DEFAULT false, source text NOT NULL DEFAULT 'SELF', created_at timestamptz NOT NULL DEFAULT now(), CHECK (clock_out IS NULL OR clock_out > clock_in));
CREATE UNIQUE INDEX one_open_session_per_employee ON shift_sessions (employee_id) WHERE clock_out IS NULL;
CREATE INDEX shift_sessions_emp_date_idx ON shift_sessions (employee_id, work_date);
CREATE TABLE attendance_corrections (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), employee_id uuid NOT NULL REFERENCES employees(id), work_date date NOT NULL, new_clock_in timestamptz NOT NULL, new_clock_out timestamptz NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) >= 5), requested_by uuid REFERENCES employees(id), status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED')), decided_by uuid REFERENCES employees(id), decided_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), CHECK (new_clock_out > new_clock_in));
-- ---------- HR: holidays, leave ----------
CREATE TABLE holidays (day date PRIMARY KEY, name text NOT NULL);
CREATE TABLE leave_types (code text PRIMARY KEY, name text NOT NULL, paid boolean NOT NULL, yearly_days numeric(5,1) NOT NULL DEFAULT 0, carry_forward_max numeric(5,1) NOT NULL DEFAULT 0, unlimited boolean NOT NULL DEFAULT false);
INSERT INTO leave_types VALUES ('PAID','Paid leave',true,12,5,false),('SICK','Sick leave',true,6,0,false),('CASUAL','Casual leave',true,6,0,false),('UNPAID','Unpaid leave',false,0,0,true);
CREATE TABLE leave_balances (employee_id uuid NOT NULL REFERENCES employees(id), leave_type text NOT NULL REFERENCES leave_types(code), year int NOT NULL, entitled numeric(5,1) NOT NULL, carried numeric(5,1) NOT NULL DEFAULT 0, used numeric(5,1) NOT NULL DEFAULT 0,
  PRIMARY KEY (employee_id, leave_type, year), CHECK (used >= 0 AND used <= entitled + carried));
CREATE TABLE leave_requests (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), employee_id uuid NOT NULL REFERENCES employees(id), leave_type text NOT NULL REFERENCES leave_types(code), from_date date NOT NULL, to_date date NOT NULL,
  half_day boolean NOT NULL DEFAULT false, days numeric(5,1) NOT NULL CHECK (days > 0), reason text, status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED','CANCELLED')),
  decided_by uuid REFERENCES employees(id), decided_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), CHECK (to_date >= from_date), CHECK (NOT half_day OR from_date = to_date),
  CONSTRAINT no_overlapping_leave EXCLUDE USING gist (employee_id WITH =, daterange(from_date, to_date, '[]') WITH &&) WHERE (status IN ('PENDING','APPROVED')));

-- ---------- warehouse: item-level packing verification ----------
CREATE TABLE packing_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL REFERENCES orders(id), source text NOT NULL CHECK (source IN ('ITEM','FREEBIE')), ref_id uuid NOT NULL, product_id uuid NOT NULL REFERENCES products(id),
  sku text NOT NULL, name text NOT NULL, required_qty int NOT NULL CHECK (required_qty > 0), verified_qty int NOT NULL DEFAULT 0, verified_by uuid REFERENCES employees(id), verified_at timestamptz,
  UNIQUE (order_id, source, ref_id), CHECK (verified_qty >= 0 AND verified_qty <= required_qty));
CREATE TABLE packing_discrepancies (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL REFERENCES orders(id), packing_item_id uuid NOT NULL REFERENCES packing_items(id), kind text NOT NULL CHECK (kind IN ('MISSING','DAMAGED','SHORT')),
  qty int NOT NULL CHECK (qty > 0), note text, reported_by uuid REFERENCES employees(id), created_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz, resolved_by uuid REFERENCES employees(id));

-- ---------- samples: separate stock, free of cost ----------
CREATE SEQUENCE sample_number_seq START 9001;
CREATE TABLE sample_inventory (product_id uuid PRIMARY KEY REFERENCES products(id), on_hand int NOT NULL DEFAULT 0 CHECK (on_hand >= 0), reserved int NOT NULL DEFAULT 0 CHECK (reserved >= 0), dispatched int NOT NULL DEFAULT 0 CHECK (dispatched >= 0),
  damaged int NOT NULL DEFAULT 0 CHECK (damaged >= 0), updated_by uuid REFERENCES employees(id), updated_at timestamptz NOT NULL DEFAULT now(), CHECK (reserved <= on_hand));
CREATE TABLE sample_movements (id bigserial PRIMARY KEY, product_id uuid NOT NULL REFERENCES products(id), delta int NOT NULL, kind text NOT NULL, ref_id text, reason text, actor_id uuid, qty_before int, qty_after int, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE sample_orders (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), sample_number text UNIQUE NOT NULL, recipient_dealer_id uuid REFERENCES dealers(id), recipient_name text NOT NULL, delivery_address text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING_APPROVAL' CHECK (status IN ('DRAFT','PENDING_APPROVAL','APPROVED','AWAITING_STOCK','READY_FOR_PACKING','PACKING','PACKED','SHIPPED','DELIVERED','CANCELLED')),
  reserved boolean NOT NULL DEFAULT false, valuation_paise bigint NOT NULL DEFAULT 0, created_by uuid REFERENCES employees(id), approved_by uuid REFERENCES employees(id), created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE sample_order_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), sample_order_id uuid NOT NULL REFERENCES sample_orders(id) ON DELETE CASCADE, product_id uuid NOT NULL REFERENCES products(id), qty int NOT NULL CHECK (qty > 0), valuation_paise bigint NOT NULL);
