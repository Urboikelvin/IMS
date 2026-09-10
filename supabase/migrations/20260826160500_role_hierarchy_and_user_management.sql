-- ============================================================================
-- Role hierarchy: super_admin > admin > staff
--   - super_admin: everything admin can do, PLUS create/promote/demote admins
--     and other super_admins.
--   - admin: manage items/categories, delete stock records, view all reports,
--     create/remove staff accounts. Cannot create or touch admin/super_admin
--     accounts (enforced in the create/delete-user server functions).
--   - staff: log stock in/out only. No delete, no user management.
-- ============================================================================

-- Previously UNIQUE(user_id, role) allowed a single user to hold more than one
-- role row at once, which the app never intended (useRole() assumes exactly
-- one row per user). Enforce a single role per user at the database level.
ALTER TABLE public.user_roles DROP CONSTRAINT user_roles_user_id_role_key;
ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_user_id_key UNIQUE (user_id);

-- "Admin-level" access (admin OR super_admin) - used by every policy that
-- previously only checked for 'admin'.
CREATE OR REPLACE FUNCTION public.is_admin_or_above(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(_user_id, 'admin') OR public.has_role(_user_id, 'super_admin')
$$;
REVOKE ALL ON FUNCTION public.is_admin_or_above(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin_or_above(uuid) TO authenticated;

-- The very first person to sign up becomes super_admin (was admin) so there's
-- always someone who can create further admins. Everyone after is staff.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE role_count int;
BEGIN
  INSERT INTO public.profiles (id, name, email)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email,'@',1)), COALESCE(NEW.email,''))
  ON CONFLICT (id) DO NOTHING;

  SELECT count(*) INTO role_count FROM public.user_roles;
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, CASE WHEN role_count = 0 THEN 'super_admin'::public.app_role ELSE 'staff'::public.app_role END)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- Widen every "admin write" policy to admin-or-above.
DROP POLICY IF EXISTS "categories_admin_write" ON public.categories;
CREATE POLICY "categories_admin_write" ON public.categories FOR ALL TO authenticated
  USING (public.is_admin_or_above(auth.uid())) WITH CHECK (public.is_admin_or_above(auth.uid()));

DROP POLICY IF EXISTS "items_admin_write" ON public.items;
CREATE POLICY "items_admin_write" ON public.items FOR ALL TO authenticated
  USING (public.is_admin_or_above(auth.uid())) WITH CHECK (public.is_admin_or_above(auth.uid()));

DROP POLICY IF EXISTS "stock_in_admin_update" ON public.stock_in;
CREATE POLICY "stock_in_admin_update" ON public.stock_in FOR UPDATE TO authenticated
  USING (public.is_admin_or_above(auth.uid())) WITH CHECK (public.is_admin_or_above(auth.uid()));
DROP POLICY IF EXISTS "stock_in_admin_delete" ON public.stock_in;
CREATE POLICY "stock_in_admin_delete" ON public.stock_in FOR DELETE TO authenticated
  USING (public.is_admin_or_above(auth.uid()));

DROP POLICY IF EXISTS "stock_out_admin_update" ON public.stock_out;
CREATE POLICY "stock_out_admin_update" ON public.stock_out FOR UPDATE TO authenticated
  USING (public.is_admin_or_above(auth.uid())) WITH CHECK (public.is_admin_or_above(auth.uid()));
DROP POLICY IF EXISTS "stock_out_admin_delete" ON public.stock_out;
CREATE POLICY "stock_out_admin_delete" ON public.stock_out FOR DELETE TO authenticated
  USING (public.is_admin_or_above(auth.uid()));

-- Audit log: admins/super_admins see everything ("view all reports"); staff
-- only see their own logged actions (was previously open to everyone).
DROP POLICY IF EXISTS "audit_select" ON public.audit_log;
CREATE POLICY "audit_select" ON public.audit_log FOR SELECT TO authenticated
  USING (public.is_admin_or_above(auth.uid()) OR user_id = auth.uid());

-- user_roles: anyone can see their own role; admin-or-above can see everyone's
-- (needed for the Users page). Direct writes are reserved for super_admin only
-- -- regular-admin user management (create/remove staff) goes through the
-- service-role server functions instead, which enforce the same hierarchy in
-- application code before touching this table.
DROP POLICY IF EXISTS "user_roles_select_own_or_admin" ON public.user_roles;
CREATE POLICY "user_roles_select_own_or_admin" ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin_or_above(auth.uid()));

DROP POLICY IF EXISTS "user_roles_admin_manage" ON public.user_roles;
CREATE POLICY "user_roles_super_admin_manage" ON public.user_roles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

-- Guard against ever ending up with zero super_admins (would permanently lock
-- everyone out of admin creation).
CREATE OR REPLACE FUNCTION public.prevent_last_super_admin_removal()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE remaining int;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.role = 'super_admin' THEN
      SELECT count(*) INTO remaining FROM public.user_roles WHERE role = 'super_admin' AND user_id <> OLD.user_id;
      IF remaining = 0 THEN
        RAISE EXCEPTION 'Cannot remove the last super admin.';
      END IF;
    END IF;
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.role = 'super_admin' AND NEW.role <> 'super_admin' THEN
      SELECT count(*) INTO remaining FROM public.user_roles WHERE role = 'super_admin' AND user_id <> OLD.user_id;
      IF remaining = 0 THEN
        RAISE EXCEPTION 'Cannot demote the last super admin.';
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.prevent_last_super_admin_removal() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS protect_last_super_admin ON public.user_roles;
CREATE TRIGGER protect_last_super_admin
BEFORE UPDATE OR DELETE ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.prevent_last_super_admin_removal();
