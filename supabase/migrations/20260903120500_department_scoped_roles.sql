-- Departments feature, part 2 of 2 (CORRECTED ORDERING — safe to re-run,
-- including on top of a previous partial failure, since every statement
-- below is idempotent: create-if-not-exists, drop-before-create for
-- policies/constraints, create-or-replace for functions).
--
-- Run this AFTER the head_staff enum value migration has fully committed.
--
-- ROLE MODEL AFTER THIS MIGRATION:
--   super_admin  - whole company, every permission including managing
--                  departments themselves (create/rename/delete) and roles.
--                  department_id is always NULL for this role.
--   head_staff   - whole company, same operational power as super_admin
--                  (view/edit every department, manage roles), but cannot
--                  create/rename/delete departments. department_id is
--                  always NULL for this role too.
--   admin        - exactly one department. Full control of that
--                  department's items/categories/stock. Cannot manage
--                  roles or see other departments at all.
--   staff        - exactly one department. Can log stock in/out for that
--                  department only. No edit/delete, no role management.
--
-- NEW USERS: only the very first person to ever register becomes
-- super_admin automatically (unchanged bootstrap behavior). Everyone after
-- that gets a profile row but NO row in user_roles — they're "pending"
-- until a super_admin/head_staff assigns them a department from the Users
-- page.

-- ----------------------------------------------------------------------------
-- Departments table (create first — everything below references it)
-- ----------------------------------------------------------------------------

create table if not exists public.departments (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);
grant select on public.departments to authenticated;
grant insert, update, delete on public.departments to authenticated;
grant all on public.departments to service_role;
alter table public.departments enable row level security;

drop policy if exists "departments_select_all" on public.departments;
create policy "departments_select_all" on public.departments
  for select to authenticated using (true);

drop policy if exists "departments_super_admin_write" on public.departments;
create policy "departments_super_admin_write" on public.departments
  for all to authenticated
  using (public.has_role(auth.uid(), 'super_admin'))
  with check (public.has_role(auth.uid(), 'super_admin'));

insert into public.departments (name) values ('General') on conflict (name) do nothing;

-- ----------------------------------------------------------------------------
-- Add department_id columns to every table that needs one BEFORE defining
-- any function/policy that references them (this ordering is the actual
-- fix for the error you hit).
-- ----------------------------------------------------------------------------

alter table public.user_roles add column if not exists department_id uuid references public.departments(id) on delete restrict;
alter table public.categories add column if not exists department_id uuid references public.departments(id) on delete restrict;
alter table public.items add column if not exists department_id uuid references public.departments(id) on delete restrict;

-- ----------------------------------------------------------------------------
-- Helper functions for department-scoped permission checks (safe now that
-- department_id columns exist above)
-- ----------------------------------------------------------------------------

create or replace function public.get_user_department(_user_id uuid)
returns uuid
language sql stable security definer set search_path = public as $$
  select department_id from public.user_roles where user_id = _user_id limit 1
$$;
revoke all on function public.get_user_department(uuid) from public, anon;
grant execute on function public.get_user_department(uuid) to authenticated;

create or replace function public.is_head_staff_or_above(_user_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_role(_user_id, 'super_admin') or public.has_role(_user_id, 'head_staff')
$$;
revoke all on function public.is_head_staff_or_above(uuid) from public, anon;
grant execute on function public.is_head_staff_or_above(uuid) to authenticated;

create or replace function public.can_view_department(_user_id uuid, _department_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_head_staff_or_above(_user_id)
      or public.get_user_department(_user_id) = _department_id
$$;
revoke all on function public.can_view_department(uuid, uuid) from public, anon;
grant execute on function public.can_view_department(uuid, uuid) to authenticated;

create or replace function public.is_dept_admin_or_above(_user_id uuid, _department_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_head_staff_or_above(_user_id)
      or (public.has_role(_user_id, 'admin') and public.get_user_department(_user_id) = _department_id)
$$;
revoke all on function public.is_dept_admin_or_above(uuid, uuid) from public, anon;
grant execute on function public.is_dept_admin_or_above(uuid, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- user_roles: backfill + constraint + policies
-- ----------------------------------------------------------------------------

update public.user_roles
set department_id = (select id from public.departments where name = 'General')
where role in ('admin', 'staff') and department_id is null;

alter table public.user_roles drop constraint if exists user_roles_department_rule;
alter table public.user_roles add constraint user_roles_department_rule check (
  (role in ('super_admin', 'head_staff') and department_id is null)
  or
  (role in ('admin', 'staff') and department_id is not null)
);

drop policy if exists "user_roles_select_own_or_admin" on public.user_roles;
drop policy if exists "user_roles_super_admin_manage" on public.user_roles;
drop policy if exists "user_roles_select_scoped" on public.user_roles;
drop policy if exists "user_roles_head_staff_manage" on public.user_roles;

create policy "user_roles_select_scoped" on public.user_roles for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_head_staff_or_above(auth.uid())
    or (public.has_role(auth.uid(), 'admin') and department_id = public.get_user_department(auth.uid()))
  );

create policy "user_roles_head_staff_manage" on public.user_roles for all to authenticated
  using (public.is_head_staff_or_above(auth.uid()))
  with check (public.is_head_staff_or_above(auth.uid()));

-- ----------------------------------------------------------------------------
-- Categories: backfill + per-department uniqueness + policies
-- ----------------------------------------------------------------------------

update public.categories set department_id = (select id from public.departments where name = 'General') where department_id is null;
alter table public.categories alter column department_id set not null;

alter table public.categories drop constraint if exists categories_name_key;
alter table public.categories drop constraint if exists categories_department_name_key;
alter table public.categories add constraint categories_department_name_key unique (department_id, name);

drop policy if exists "categories_select" on public.categories;
drop policy if exists "categories_admin_write" on public.categories;
drop policy if exists "categories_select_scoped" on public.categories;
drop policy if exists "categories_write_scoped" on public.categories;

create policy "categories_select_scoped" on public.categories for select to authenticated
  using (public.can_view_department(auth.uid(), department_id));

create policy "categories_write_scoped" on public.categories for all to authenticated
  using (public.is_dept_admin_or_above(auth.uid(), department_id))
  with check (public.is_dept_admin_or_above(auth.uid(), department_id));

-- ----------------------------------------------------------------------------
-- Items: backfill + policies
-- ----------------------------------------------------------------------------

update public.items set department_id = (select id from public.departments where name = 'General') where department_id is null;
alter table public.items alter column department_id set not null;

drop policy if exists "items_select" on public.items;
drop policy if exists "items_admin_write" on public.items;
drop policy if exists "items_select_scoped" on public.items;
drop policy if exists "items_write_scoped" on public.items;

create policy "items_select_scoped" on public.items for select to authenticated
  using (public.can_view_department(auth.uid(), department_id));

create policy "items_write_scoped" on public.items for all to authenticated
  using (public.is_dept_admin_or_above(auth.uid(), department_id))
  with check (public.is_dept_admin_or_above(auth.uid(), department_id));

-- ----------------------------------------------------------------------------
-- Stock In / Stock Out: scoped via their item's department
-- ----------------------------------------------------------------------------

drop policy if exists "stock_in_select" on public.stock_in;
drop policy if exists "stock_in_insert" on public.stock_in;
drop policy if exists "stock_in_admin_update" on public.stock_in;
drop policy if exists "stock_in_admin_delete" on public.stock_in;
drop policy if exists "stock_in_select_scoped" on public.stock_in;
drop policy if exists "stock_in_insert_scoped" on public.stock_in;
drop policy if exists "stock_in_update_scoped" on public.stock_in;
drop policy if exists "stock_in_delete_scoped" on public.stock_in;

create policy "stock_in_select_scoped" on public.stock_in for select to authenticated
  using (exists (
    select 1 from public.items i
    where i.id = stock_in.item_id and public.can_view_department(auth.uid(), i.department_id)
  ));

create policy "stock_in_insert_scoped" on public.stock_in for insert to authenticated
  with check (
    logged_by = auth.uid()
    and exists (
      select 1 from public.items i
      where i.id = stock_in.item_id and public.can_view_department(auth.uid(), i.department_id)
    )
  );

create policy "stock_in_update_scoped" on public.stock_in for update to authenticated
  using (exists (
    select 1 from public.items i
    where i.id = stock_in.item_id and public.is_dept_admin_or_above(auth.uid(), i.department_id)
  ))
  with check (exists (
    select 1 from public.items i
    where i.id = stock_in.item_id and public.is_dept_admin_or_above(auth.uid(), i.department_id)
  ));

create policy "stock_in_delete_scoped" on public.stock_in for delete to authenticated
  using (exists (
    select 1 from public.items i
    where i.id = stock_in.item_id and public.is_dept_admin_or_above(auth.uid(), i.department_id)
  ));

drop policy if exists "stock_out_select" on public.stock_out;
drop policy if exists "stock_out_insert" on public.stock_out;
drop policy if exists "stock_out_admin_update" on public.stock_out;
drop policy if exists "stock_out_admin_delete" on public.stock_out;
drop policy if exists "stock_out_select_scoped" on public.stock_out;
drop policy if exists "stock_out_insert_scoped" on public.stock_out;
drop policy if exists "stock_out_update_scoped" on public.stock_out;
drop policy if exists "stock_out_delete_scoped" on public.stock_out;

create policy "stock_out_select_scoped" on public.stock_out for select to authenticated
  using (exists (
    select 1 from public.items i
    where i.id = stock_out.item_id and public.can_view_department(auth.uid(), i.department_id)
  ));

create policy "stock_out_insert_scoped" on public.stock_out for insert to authenticated
  with check (
    logged_by = auth.uid()
    and exists (
      select 1 from public.items i
      where i.id = stock_out.item_id and public.can_view_department(auth.uid(), i.department_id)
    )
  );

create policy "stock_out_update_scoped" on public.stock_out for update to authenticated
  using (exists (
    select 1 from public.items i
    where i.id = stock_out.item_id and public.is_dept_admin_or_above(auth.uid(), i.department_id)
  ))
  with check (exists (
    select 1 from public.items i
    where i.id = stock_out.item_id and public.is_dept_admin_or_above(auth.uid(), i.department_id)
  ));

create policy "stock_out_delete_scoped" on public.stock_out for delete to authenticated
  using (exists (
    select 1 from public.items i
    where i.id = stock_out.item_id and public.is_dept_admin_or_above(auth.uid(), i.department_id)
  ));

-- ----------------------------------------------------------------------------
-- New signups: only the bootstrap super_admin gets an automatic role row.
-- ----------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare role_count int;
begin
  insert into public.profiles (id, name, email)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', split_part(new.email,'@',1)), coalesce(new.email,''))
  on conflict (id) do nothing;

  select count(*) into role_count from public.user_roles;
  if role_count = 0 then
    insert into public.user_roles (user_id, role, department_id)
    values (new.id, 'super_admin', null)
    on conflict (user_id) do nothing;
  end if;

  return new;
end;
$$;
