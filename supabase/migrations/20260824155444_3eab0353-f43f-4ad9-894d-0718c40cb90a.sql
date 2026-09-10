-- Roles
CREATE TYPE public.app_role AS ENUM ('admin','staff');

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles_select_all" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE POLICY "user_roles_select_own_or_admin" ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "user_roles_admin_manage" ON public.user_roles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
GRANT INSERT, UPDATE, DELETE ON public.user_roles TO authenticated;

-- Auto profile + first user becomes admin
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE role_count int;
BEGIN
  INSERT INTO public.profiles (id, name, email)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email,'@',1)), COALESCE(NEW.email,''))
  ON CONFLICT (id) DO NOTHING;

  SELECT count(*) INTO role_count FROM public.user_roles;
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, CASE WHEN role_count = 0 THEN 'admin'::public.app_role ELSE 'staff'::public.app_role END)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Categories
CREATE TABLE public.categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.categories TO authenticated;
GRANT ALL ON public.categories TO service_role;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "categories_select" ON public.categories FOR SELECT TO authenticated USING (true);
CREATE POLICY "categories_admin_write" ON public.categories FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Items
CREATE TABLE public.items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  unit text NOT NULL DEFAULT 'pieces',
  reorder_threshold numeric NOT NULL DEFAULT 10 CHECK (reorder_threshold >= 0),
  unit_price numeric NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  expiry_date date,
  current_balance numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.items TO authenticated;
GRANT ALL ON public.items TO service_role;
ALTER TABLE public.items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "items_select" ON public.items FOR SELECT TO authenticated USING (true);
CREATE POLICY "items_admin_write" ON public.items FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Stock In
CREATE TABLE public.stock_in (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  quantity numeric NOT NULL CHECK (quantity > 0),
  date date NOT NULL DEFAULT CURRENT_DATE,
  supplier text,
  notes text,
  logged_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stock_in TO authenticated;
GRANT ALL ON public.stock_in TO service_role;
ALTER TABLE public.stock_in ENABLE ROW LEVEL SECURITY;
CREATE POLICY "stock_in_select" ON public.stock_in FOR SELECT TO authenticated USING (true);
CREATE POLICY "stock_in_insert" ON public.stock_in FOR INSERT TO authenticated WITH CHECK (logged_by = auth.uid());
CREATE POLICY "stock_in_admin_update" ON public.stock_in FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "stock_in_admin_delete" ON public.stock_in FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'admin'));

-- Stock Out
CREATE TABLE public.stock_out (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  quantity numeric NOT NULL CHECK (quantity > 0),
  date date NOT NULL DEFAULT CURRENT_DATE,
  recipient text,
  notes text,
  logged_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stock_out TO authenticated;
GRANT ALL ON public.stock_out TO service_role;
ALTER TABLE public.stock_out ENABLE ROW LEVEL SECURITY;
CREATE POLICY "stock_out_select" ON public.stock_out FOR SELECT TO authenticated USING (true);
CREATE POLICY "stock_out_insert" ON public.stock_out FOR INSERT TO authenticated WITH CHECK (logged_by = auth.uid());
CREATE POLICY "stock_out_admin_update" ON public.stock_out FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "stock_out_admin_delete" ON public.stock_out FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'admin'));

-- Audit log
CREATE TABLE public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity text NOT NULL,
  entity_id uuid,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.audit_log TO authenticated;
GRANT ALL ON public.audit_log TO service_role;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit_select" ON public.audit_log FOR SELECT TO authenticated USING (true);
CREATE POLICY "audit_insert" ON public.audit_log FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

-- Balance maintenance
CREATE OR REPLACE FUNCTION public.recalc_item_balance(_item_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.items i
  SET current_balance = COALESCE((SELECT sum(quantity) FROM public.stock_in WHERE item_id = _item_id),0)
                      - COALESCE((SELECT sum(quantity) FROM public.stock_out WHERE item_id = _item_id),0),
      updated_at = now()
  WHERE i.id = _item_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.stock_movement_after()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.recalc_item_balance(OLD.item_id);
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.item_id <> NEW.item_id THEN
    PERFORM public.recalc_item_balance(OLD.item_id);
  END IF;
  PERFORM public.recalc_item_balance(NEW.item_id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER stock_in_balance AFTER INSERT OR UPDATE OR DELETE ON public.stock_in
FOR EACH ROW EXECUTE FUNCTION public.stock_movement_after();
CREATE TRIGGER stock_out_balance AFTER INSERT OR UPDATE OR DELETE ON public.stock_out
FOR EACH ROW EXECUTE FUNCTION public.stock_movement_after();

-- Prevent over-issuing
CREATE OR REPLACE FUNCTION public.validate_stock_out()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE available numeric;
BEGIN
  SELECT COALESCE((SELECT sum(quantity) FROM public.stock_in WHERE item_id = NEW.item_id),0)
       - COALESCE((SELECT sum(quantity) FROM public.stock_out WHERE item_id = NEW.item_id AND (TG_OP = 'INSERT' OR id <> NEW.id)),0)
  INTO available;
  IF NEW.quantity > available THEN
    RAISE EXCEPTION 'Insufficient stock: only % available', available;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER stock_out_validate BEFORE INSERT OR UPDATE ON public.stock_out
FOR EACH ROW EXECUTE FUNCTION public.validate_stock_out();

-- Seed data
INSERT INTO public.categories (id, name) VALUES
  ('11111111-1111-1111-1111-111111111111','Safety Equipment'),
  ('22222222-2222-2222-2222-222222222222','Consumables'),
  ('33333333-3333-3333-3333-333333333333','Packaging');

INSERT INTO public.items (id, name, category_id, unit, reorder_threshold, unit_price, expiry_date) VALUES
  ('aaaaaaa1-0000-4000-8000-000000000001','Latex Gloves (Medium)','11111111-1111-1111-1111-111111111111','boxes',20,12.50,'2027-06-30'),
  ('aaaaaaa1-0000-4000-8000-000000000002','Respirator Filters','11111111-1111-1111-1111-111111111111','pieces',20,8.00,NULL),
  ('aaaaaaa1-0000-4000-8000-000000000003','Industrial Adhesive 5L','22222222-2222-2222-2222-222222222222','bottles',10,42.00,'2026-12-31'),
  ('aaaaaaa1-0000-4000-8000-000000000004','Pallet Wrap (Clear)','33333333-3333-3333-3333-333333333333','rolls',15,18.75,NULL),
  ('aaaaaaa1-0000-4000-8000-000000000005','Safety Helmets (Yellow)','11111111-1111-1111-1111-111111111111','pieces',10,25.00,NULL);

INSERT INTO public.stock_in (item_id, quantity, date, supplier, notes) VALUES
  ('aaaaaaa1-0000-4000-8000-000000000001',200,CURRENT_DATE - 3,'SafeSupply Co','Opening stock'),
  ('aaaaaaa1-0000-4000-8000-000000000002',24,CURRENT_DATE - 3,'SafeSupply Co','Opening stock'),
  ('aaaaaaa1-0000-4000-8000-000000000003',40,CURRENT_DATE - 2,'ChemLine Ltd','Opening stock'),
  ('aaaaaaa1-0000-4000-8000-000000000004',30,CURRENT_DATE - 2,'PackRight','Opening stock'),
  ('aaaaaaa1-0000-4000-8000-000000000005',60,CURRENT_DATE - 1,'SafeSupply Co','Opening stock');

INSERT INTO public.stock_out (item_id, quantity, date, recipient, notes) VALUES
  ('aaaaaaa1-0000-4000-8000-000000000001',35,CURRENT_DATE - 1,'Production Floor A','Daily issuance'),
  ('aaaaaaa1-0000-4000-8000-000000000002',20,CURRENT_DATE - 1,'Maintenance','Filter change'),
  ('aaaaaaa1-0000-4000-8000-000000000003',15,CURRENT_DATE,'Fabrication','Daily issuance'),
  ('aaaaaaa1-0000-4000-8000-000000000004',18,CURRENT_DATE,'Dispatch','Daily issuance'),
  ('aaaaaaa1-0000-4000-8000-000000000005',10,CURRENT_DATE,'New hires','Kit issue');