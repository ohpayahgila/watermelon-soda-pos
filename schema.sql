-- ============================================================
-- WATERMELON SODA POS
-- Secure Supabase database schema
-- ============================================================

-- Needed for UUID generation and secure hashing
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- ENUM TYPES
-- ============================================================

CREATE TYPE staff_role AS ENUM (
  'cashier',
  'manager',
  'owner'
);

CREATE TYPE payment_method_type AS ENUM (
  'cash',
  'card',
  'qr'
);

CREATE TYPE sale_status_type AS ENUM (
  'completed',
  'refunded',
  'voided'
);

CREATE TYPE shift_status_type AS ENUM (
  'active',
  'closed'
);

-- ============================================================
-- OUTLETS
-- ============================================================

CREATE TABLE public.outlets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  location TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  manager_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- STAFF
-- Each staff member must be connected to Supabase Auth.
-- ============================================================

CREATE TABLE public.staff (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- This connects the staff profile to auth.users
  auth_user_id UUID UNIQUE NOT NULL
    REFERENCES auth.users(id) ON DELETE CASCADE,

  outlet_id UUID
    REFERENCES public.outlets(id) ON DELETE SET NULL,

  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  role staff_role NOT NULL DEFAULT 'cashier',

  -- Never store the real PIN.
  pin_hash TEXT,

  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.outlets
ADD CONSTRAINT outlets_manager_id_fkey
FOREIGN KEY (manager_id)
REFERENCES public.staff(id)
ON DELETE SET NULL;

-- ============================================================
-- PRODUCTS
-- ============================================================

CREATE TABLE public.products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  sku TEXT UNIQUE,
  description TEXT,
  category TEXT,
  price NUMERIC(10,2) NOT NULL CHECK (price >= 0),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- INVENTORY
-- ============================================================

CREATE TABLE public.inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  product_id UUID NOT NULL
    REFERENCES public.products(id) ON DELETE CASCADE,

  outlet_id UUID NOT NULL
    REFERENCES public.outlets(id) ON DELETE CASCADE,

  quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  reorder_level INTEGER NOT NULL DEFAULT 10 CHECK (reorder_level >= 0),
  last_restock TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (product_id, outlet_id)
);

-- ============================================================
-- SHIFTS
-- ============================================================

CREATE TABLE public.shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  staff_id UUID NOT NULL
    REFERENCES public.staff(id) ON DELETE RESTRICT,

  outlet_id UUID NOT NULL
    REFERENCES public.outlets(id) ON DELETE RESTRICT,

  start_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  end_time TIMESTAMPTZ,

  opening_cash NUMERIC(10,2) DEFAULT 0 CHECK (opening_cash >= 0),
  closing_cash NUMERIC(10,2) CHECK (closing_cash >= 0),

  status shift_status_type NOT NULL DEFAULT 'active',

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CHECK (end_time IS NULL OR end_time >= start_time)
);

-- ============================================================
-- SALES
-- ============================================================

CREATE TABLE public.sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  staff_id UUID NOT NULL
    REFERENCES public.staff(id) ON DELETE RESTRICT,

  outlet_id UUID NOT NULL
    REFERENCES public.outlets(id) ON DELETE RESTRICT,

  shift_id UUID
    REFERENCES public.shifts(id) ON DELETE SET NULL,

  subtotal NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  discount NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (discount >= 0),
  tax NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (tax >= 0),
  total NUMERIC(10,2) NOT NULL CHECK (total >= 0),

  payment_method payment_method_type NOT NULL,
  status sale_status_type NOT NULL DEFAULT 'completed',

  receipt_number TEXT UNIQUE NOT NULL,
  notes TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CHECK (discount <= subtotal)
);

-- ============================================================
-- SALE ITEMS
-- ============================================================

CREATE TABLE public.sale_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  sale_id UUID NOT NULL
    REFERENCES public.sales(id) ON DELETE CASCADE,

  product_id UUID
    REFERENCES public.products(id) ON DELETE SET NULL,

  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(10,2) NOT NULL CHECK (unit_price >= 0),
  subtotal NUMERIC(10,2) NOT NULL CHECK (subtotal >= 0),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- REFUNDS
-- ============================================================

CREATE TABLE public.refunds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  sale_id UUID NOT NULL
    REFERENCES public.sales(id) ON DELETE RESTRICT,

  processed_by UUID NOT NULL
    REFERENCES public.staff(id) ON DELETE RESTRICT,

  amount NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'completed',

  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- PAYMENT TRANSACTIONS
-- Do not store full card numbers, CVV, or banking credentials.
-- ============================================================

CREATE TABLE public.payment_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  sale_id UUID NOT NULL
    REFERENCES public.sales(id) ON DELETE RESTRICT,

  provider TEXT,
  external_transaction_id TEXT,
  payment_method payment_method_type NOT NULL,
  amount NUMERIC(10,2) NOT NULL CHECK (amount >= 0),
  status TEXT NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- AUDIT LOG
-- ============================================================

CREATE TABLE public.audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  staff_id UUID
    REFERENCES public.staff(id) ON DELETE SET NULL,

  outlet_id UUID
    REFERENCES public.outlets(id) ON DELETE SET NULL,

  action TEXT NOT NULL,
  table_name TEXT,
  record_id UUID,
  details JSONB NOT NULL DEFAULT '{}'::JSONB,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- DEVICE SYNC LOG
-- ============================================================

CREATE TABLE public.sync_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  outlet_id UUID
    REFERENCES public.outlets(id) ON DELETE CASCADE,

  device_id TEXT NOT NULL,
  action TEXT NOT NULL,
  table_name TEXT,
  record_id UUID,
  status TEXT NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX idx_staff_auth_user
  ON public.staff(auth_user_id);

CREATE INDEX idx_staff_outlet
  ON public.staff(outlet_id);

CREATE INDEX idx_inventory_product
  ON public.inventory(product_id);

CREATE INDEX idx_inventory_outlet
  ON public.inventory(outlet_id);

CREATE INDEX idx_shifts_staff
  ON public.shifts(staff_id);

CREATE INDEX idx_shifts_outlet
  ON public.shifts(outlet_id);

CREATE INDEX idx_sales_staff
  ON public.sales(staff_id);

CREATE INDEX idx_sales_outlet
  ON public.sales(outlet_id);

CREATE INDEX idx_sales_shift
  ON public.sales(shift_id);

CREATE INDEX idx_sales_created_at
  ON public.sales(created_at);

CREATE INDEX idx_sale_items_sale
  ON public.sale_items(sale_id);

CREATE INDEX idx_refunds_sale
  ON public.refunds(sale_id);

CREATE INDEX idx_audit_staff
  ON public.audit_log(staff_id);

CREATE INDEX idx_audit_outlet
  ON public.audit_log(outlet_id);

CREATE INDEX idx_audit_created_at
  ON public.audit_log(created_at);

-- ============================================================
-- AUTOMATIC updated_at FUNCTION
-- ============================================================

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER outlets_set_updated_at
BEFORE UPDATE ON public.outlets
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER staff_set_updated_at
BEFORE UPDATE ON public.staff
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER products_set_updated_at
BEFORE UPDATE ON public.products
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER inventory_set_updated_at
BEFORE UPDATE ON public.inventory
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER shifts_set_updated_at
BEFORE UPDATE ON public.shifts
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER sales_set_updated_at
BEFORE UPDATE ON public.sales
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- PRIVATE SECURITY-HELPER FUNCTIONS
-- ============================================================

CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION private.current_staff_id()
RETURNS UUID
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT id
  FROM public.staff
  WHERE auth_user_id = (SELECT auth.uid())
    AND active = TRUE
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION private.current_staff_role()
RETURNS public.staff_role
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT role
  FROM public.staff
  WHERE auth_user_id = (SELECT auth.uid())
    AND active = TRUE
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION private.current_outlet_id()
RETURNS UUID
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT outlet_id
  FROM public.staff
  WHERE auth_user_id = (SELECT auth.uid())
    AND active = TRUE
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION private.current_staff_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.current_staff_role() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.current_outlet_id() FROM PUBLIC;

GRANT USAGE ON SCHEMA private TO authenticated;
GRANT EXECUTE ON FUNCTION private.current_staff_id() TO authenticated;
GRANT EXECUTE ON FUNCTION private.current_staff_role() TO authenticated;
GRANT EXECUTE ON FUNCTION private.current_outlet_id() TO authenticated;

-- ============================================================
-- ENABLE ROW LEVEL SECURITY ON EVERY APP TABLE
-- ============================================================

ALTER TABLE public.outlets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_log ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- STAFF POLICIES
-- ============================================================

CREATE POLICY "Staff can view permitted staff profiles"
ON public.staff
FOR SELECT
TO authenticated
USING (
  auth_user_id = (SELECT auth.uid())
  OR private.current_staff_role() = 'owner'
  OR (
    private.current_staff_role() = 'manager'
    AND outlet_id = private.current_outlet_id()
  )
);

CREATE POLICY "Owners can create staff profiles"
ON public.staff
FOR INSERT
TO authenticated
WITH CHECK (
  private.current_staff_role() = 'owner'
);

CREATE POLICY "Owners and managers can update permitted staff"
ON public.staff
FOR UPDATE
TO authenticated
USING (
  private.current_staff_role() = 'owner'
  OR (
    private.current_staff_role() = 'manager'
    AND outlet_id = private.current_outlet_id()
    AND role = 'cashier'
  )
)
WITH CHECK (
  private.current_staff_role() = 'owner'
  OR (
    private.current_staff_role() = 'manager'
    AND outlet_id = private.current_outlet_id()
    AND role = 'cashier'
  )
);

-- ============================================================
-- OUTLET POLICIES
-- ============================================================

CREATE POLICY "Staff can view their outlet"
ON public.outlets
FOR SELECT
TO authenticated
USING (
  id = private.current_outlet_id()
  OR private.current_staff_role() = 'owner'
);

CREATE POLICY "Owners can create outlets"
ON public.outlets
FOR INSERT
TO authenticated
WITH CHECK (
  private.current_staff_role() = 'owner'
);

CREATE POLICY "Owners can update outlets"
ON public.outlets
FOR UPDATE
TO authenticated
USING (
  private.current_staff_role() = 'owner'
)
WITH CHECK (
  private.current_staff_role() = 'owner'
);

-- ============================================================
-- PRODUCT POLICIES
-- ============================================================

CREATE POLICY "Authenticated staff can view active products"
ON public.products
FOR SELECT
TO authenticated
USING (
  active = TRUE
  OR private.current_staff_role() IN ('manager', 'owner')
);

CREATE POLICY "Managers and owners can create products"
ON public.products
FOR INSERT
TO authenticated
WITH CHECK (
  private.current_staff_role() IN ('manager', 'owner')
);

CREATE POLICY "Managers and owners can update products"
ON public.products
FOR UPDATE
TO authenticated
USING (
  private.current_staff_role() IN ('manager', 'owner')
)
WITH CHECK (
  private.current_staff_role() IN ('manager', 'owner')
);

-- ============================================================
-- INVENTORY POLICIES
-- ============================================================

CREATE POLICY "Staff can view their outlet inventory"
ON public.inventory
FOR SELECT
TO authenticated
USING (
  outlet_id = private.current_outlet_id()
  OR private.current_staff_role() = 'owner'
);

CREATE POLICY "Managers and owners can create inventory"
ON public.inventory
FOR INSERT
TO authenticated
WITH CHECK (
  private.current_staff_role() = 'owner'
  OR (
    private.current_staff_role() = 'manager'
    AND outlet_id = private.current_outlet_id()
  )
);

CREATE POLICY "Managers and owners can update inventory"
ON public.inventory
FOR UPDATE
TO authenticated
USING (
  private.current_staff_role() = 'owner'
  OR (
    private.current_staff_role() = 'manager'
    AND outlet_id = private.current_outlet_id()
  )
)
WITH CHECK (
  private.current_staff_role() = 'owner'
  OR (
    private.current_staff_role() = 'manager'
    AND outlet_id = private.current_outlet_id()
  )
);

-- ============================================================
-- SHIFT POLICIES
-- ============================================================

CREATE POLICY "Staff can view permitted shifts"
ON public.shifts
FOR SELECT
TO authenticated
USING (
  staff_id = private.current_staff_id()
  OR private.current_staff_role() = 'owner'
  OR (
    private.current_staff_role() = 'manager'
    AND outlet_id = private.current_outlet_id()
  )
);

CREATE POLICY "Staff can start their own shift"
ON public.shifts
FOR INSERT
TO authenticated
WITH CHECK (
  staff_id = private.current_staff_id()
  AND outlet_id = private.current_outlet_id()
);

CREATE POLICY "Staff can update permitted shifts"
ON public.shifts
FOR UPDATE
TO authenticated
USING (
  staff_id = private.current_staff_id()
  OR private.current_staff_role() = 'owner'
  OR (
    private.current_staff_role() = 'manager'
    AND outlet_id = private.current_outlet_id()
  )
)
WITH CHECK (
  staff_id = private.current_staff_id()
  OR private.current_staff_role() = 'owner'
  OR (
    private.current_staff_role() = 'manager'
    AND outlet_id = private.current_outlet_id()
  )
);

-- ============================================================
-- SALES POLICIES
-- ============================================================

CREATE POLICY "Staff can view permitted sales"
ON public.sales
FOR SELECT
TO authenticated
USING (
  staff_id = private.current_staff_id()
  OR private.current_staff_role() = 'owner'
  OR (
    private.current_staff_role() = 'manager'
    AND outlet_id = private.current_outlet_id()
  )
);

CREATE POLICY "Staff can create their own outlet sales"
ON public.sales
FOR INSERT
TO authenticated
WITH CHECK (
  staff_id = private.current_staff_id()
  AND outlet_id = private.current_outlet_id()
);

CREATE POLICY "Managers and owners can update sales"
ON public.sales
FOR UPDATE
TO authenticated
USING (
  private.current_staff_role() = 'owner'
  OR (
    private.current_staff_role() = 'manager'
    AND outlet_id = private.current_outlet_id()
  )
)
WITH CHECK (
  private.current_staff_role() = 'owner'
  OR (
    private.current_staff_role() = 'manager'
    AND outlet_id = private.current_outlet_id()
  )
);

-- ============================================================
-- SALE ITEM POLICIES
-- ============================================================

CREATE POLICY "Staff can view permitted sale items"
ON public.sale_items
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.sales
    WHERE sales.id = sale_items.sale_id
  )
);

CREATE POLICY "Staff can add items to their own sales"
ON public.sale_items
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.sales
    WHERE sales.id = sale_items.sale_id
      AND sales.staff_id = private.current_staff_id()
      AND sales.outlet_id = private.current_outlet_id()
  )
);

-- ============================================================
-- REFUND POLICIES
-- ============================================================

CREATE POLICY "Managers and owners can view refunds"
ON public.refunds
FOR SELECT
TO authenticated
USING (
  private.current_staff_role() = 'owner'
  OR EXISTS (
    SELECT 1
    FROM public.sales
    WHERE sales.id = refunds.sale_id
      AND sales.outlet_id = private.current_outlet_id()
      AND private.current_staff_role() = 'manager'
  )
);

CREATE POLICY "Managers and owners can create refunds"
ON public.refunds
FOR INSERT
TO authenticated
WITH CHECK (
  processed_by = private.current_staff_id()
  AND private.current_staff_role() IN ('manager', 'owner')
);

-- ============================================================
-- PAYMENT TRANSACTION POLICIES
-- ============================================================

CREATE POLICY "Managers and owners can view payment transactions"
ON public.payment_transactions
FOR SELECT
TO authenticated
USING (
  private.current_staff_role() = 'owner'
  OR EXISTS (
    SELECT 1
    FROM public.sales
    WHERE sales.id = payment_transactions.sale_id
      AND sales.outlet_id = private.current_outlet_id()
      AND private.current_staff_role() = 'manager'
  )
);

CREATE POLICY "Staff can create payment transactions for their sales"
ON public.payment_transactions
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.sales
    WHERE sales.id = payment_transactions.sale_id
      AND sales.staff_id = private.current_staff_id()
      AND sales.outlet_id = private.current_outlet_id()
  )
);

-- ============================================================
-- AUDIT LOG POLICIES
-- ============================================================

CREATE POLICY "Managers and owners can view audit logs"
ON public.audit_log
FOR SELECT
TO authenticated
USING (
  private.current_staff_role() = 'owner'
  OR (
    private.current_staff_role() = 'manager'
    AND outlet_id = private.current_outlet_id()
  )
);

CREATE POLICY "Authenticated staff can create audit logs"
ON public.audit_log
FOR INSERT
TO authenticated
WITH CHECK (
  staff_id = private.current_staff_id()
  AND outlet_id = private.current_outlet_id()
);

-- ============================================================
-- SYNC LOG POLICIES
-- ============================================================

CREATE POLICY "Managers and owners can view sync logs"
ON public.sync_log
FOR SELECT
TO authenticated
USING (
  private.current_staff_role() = 'owner'
  OR (
    private.current_staff_role() = 'manager'
    AND outlet_id = private.current_outlet_id()
  )
);

CREATE POLICY "Staff can create sync records for their outlet"
ON public.sync_log
FOR INSERT
TO authenticated
WITH CHECK (
  outlet_id = private.current_outlet_id()
);

-- ============================================================
-- PERMISSIONS
-- No database access is given to anonymous visitors.
-- ============================================================

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;

GRANT SELECT, INSERT, UPDATE
ON public.outlets,
   public.staff,
   public.products,
   public.inventory,
   public.shifts,
   public.sales,
   public.sale_items,
   public.refunds,
   public.payment_transactions,
   public.audit_log,
   public.sync_log
TO authenticated;
