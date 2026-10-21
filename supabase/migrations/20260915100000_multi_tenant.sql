-- ============================================================================
-- Multi-tenancy: one shared deployment, many client organizations ("centers").
--
-- Everything runs inside ONE transaction. If any statement fails, nothing is
-- applied and your database is exactly as it was — fix the error and re-run.
-- Every statement is also idempotent, so re-running after success is harmless.
--
-- MODEL
--   organizations     one row per client center
--   platform_admins   you (the vendor). Manage clients; CANNOT read any
--                     client's inventory through the app — metadata only.
--   user_roles        now carries organization_id: every person belongs to
--                     exactly one organization
--   departments       belong to an organization (name unique per organization)
--   items/categories/stock_*  inherit their organization through their
--                     department, via the permission helper functions below —
--                     so isolation is enforced by Postgres RLS, not the UI.
--
-- EXISTING DATA: all current rows are assigned to a new organization called
-- "Maslow", so nothing changes for the current users.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. Tenant tables
-- ----------------------------------------------------------------------------

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0),
  status text not null default 'active' check (status in ('active', 'suspended')),
  contact_name text,
  contact_email text,
  contact_phone text,
  subscription_ends_on date,
  notes text,
  created_at timestamptz not null default now()
);
create unique index if not exists organizations_name_lower_key on public.organizations (lower(name));
grant select, insert, update on public.organizations to authenticated;
grant all on public.organizations to service_role;
alter table public.organizations enable row level security;

create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
grant select on public.platform_admins to authenticated;
grant all on public.platform_admins to service_role;
alter table public.platform_admins enable row level security;

-- ----------------------------------------------------------------------------
-- 2. Default organization for existing data
-- ----------------------------------------------------------------------------

insert into public.organizations (name)
select 'Maslow'
where not exists (select 1 from public.organizations);

-- ----------------------------------------------------------------------------
-- 3. organization_id columns (added BEFORE any function/policy that uses them)
-- ----------------------------------------------------------------------------

alter table public.departments add column if not exists organization_id uuid references public.organizations(id) on delete restrict;
alter table public.user_roles  add column if not exists organization_id uuid references public.organizations(id) on delete restrict;
alter table public.audit_log   add column if not exists organization_id uuid references public.organizations(id) on delete restrict;

update public.departments set organization_id = (select id from public.organizations order by created_at asc limit 1) where organization_id is null;
update public.user_roles  set organization_id = (select id from public.organizations order by created_at asc limit 1) where organization_id is null;
update public.audit_log   set organization_id = (select id from public.organizations order by created_at asc limit 1) where organization_id is null;

alter table public.departments alter column organization_id set not null;
alter table public.user_roles  alter column organization_id set not null;
-- audit_log.organization_id stays nullable on purpose (platform-level events).

-- Department names only need to be unique inside one organization.
alter table public.departments drop constraint if exists departments_name_key;
alter table public.departments drop constraint if exists departments_org_name_key;
alter table public.departments add constraint departments_org_name_key unique (organization_id, name);

create index if not exists departments_org_idx on public.departments (organization_id);
create index if not exists user_roles_org_idx on public.user_roles (organization_id);
create index if not exists audit_log_org_created_idx on public.audit_log (organization_id, created_at desc);

-- ----------------------------------------------------------------------------
-- 4. Permission helper functions
-- ----------------------------------------------------------------------------

create or replace function public.is_platform_admin()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid())
$$;

-- The caller's organization, regardless of its status.
create or replace function public.my_org_id()
returns uuid
language sql stable security definer set search_path = public as $$
  select organization_id from public.user_roles where user_id = auth.uid() limit 1
$$;

-- The caller's organization ONLY while it is active. Every data policy goes
-- through this, so suspending a client instantly cuts off all of its data.
create or replace function public.active_org_id()
returns uuid
language sql stable security definer set search_path = public as $$
  select ur.organization_id
  from public.user_roles ur
  join public.organizations o on o.id = ur.organization_id
  where ur.user_id = auth.uid() and o.status = 'active'
  limit 1
$$;

create or replace function public.dept_in_my_org(_department_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    exists (
      select 1 from public.departments d
      where d.id = _department_id and d.organization_id = public.active_org_id()
    ),
    false
  )
$$;

create or replace function public.shares_org_with(_other uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    exists (
      select 1 from public.user_roles ur
      where ur.user_id = _other and ur.organization_id = public.active_org_id()
    ),
    false
  )
$$;

-- Role lookups now only answer for the caller themselves. These functions are
-- callable by any signed-in user, so without this a user at one client could
-- probe whether some user id at another client is an admin. Every legitimate
-- call already passes auth.uid(), so nothing else changes.
create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_roles
    where user_id = _user_id and role = _role and _user_id = auth.uid()
  )
$$;

create or replace function public.get_user_department(_user_id uuid)
returns uuid
language sql stable security definer set search_path = public as $$
  select department_id from public.user_roles
  where user_id = _user_id and _user_id = auth.uid()
  limit 1
$$;

-- Same signatures as before, now organization-aware. Every existing policy on
-- items, categories, stock_in, stock_out and stock_out_allocations calls these,
-- so they all become organization-isolated without being rewritten.
create or replace function public.can_view_department(_user_id uuid, _department_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    public.dept_in_my_org(_department_id)
    and (
      public.is_head_staff_or_above(_user_id)
      or public.get_user_department(_user_id) = _department_id
    ),
    false
  )
$$;

create or replace function public.is_dept_admin_or_above(_user_id uuid, _department_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    public.dept_in_my_org(_department_id)
    and (
      public.is_head_staff_or_above(_user_id)
      or (public.has_role(_user_id, 'admin') and public.get_user_department(_user_id) = _department_id)
    ),
    false
  )
$$;

revoke all on function public.is_platform_admin() from public, anon;
revoke all on function public.my_org_id() from public, anon;
revoke all on function public.active_org_id() from public, anon;
revoke all on function public.dept_in_my_org(uuid) from public, anon;
revoke all on function public.shares_org_with(uuid) from public, anon;
grant execute on function public.is_platform_admin() to authenticated;
grant execute on function public.my_org_id() to authenticated;
grant execute on function public.active_org_id() to authenticated;
grant execute on function public.dept_in_my_org(uuid) to authenticated;
grant execute on function public.shares_org_with(uuid) to authenticated;

-- New rows default to the creator's own organization (the policies below also
-- verify it, so a client can never write into someone else's organization).
alter table public.departments alter column organization_id set default public.active_org_id();
alter table public.user_roles  alter column organization_id set default public.active_org_id();
alter table public.audit_log   alter column organization_id set default public.active_org_id();

-- ----------------------------------------------------------------------------
-- 5. Integrity guards (apply to every writer, including server functions)
-- ----------------------------------------------------------------------------

-- A person's department must belong to that person's organization.
create or replace function public.validate_user_role_department()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.department_id is not null and not exists (
    select 1 from public.departments d
    where d.id = new.department_id and d.organization_id = new.organization_id
  ) then
    raise exception 'That department does not belong to this organization.';
  end if;
  return new;
end;
$$;
revoke all on function public.validate_user_role_department() from public, anon, authenticated;

drop trigger if exists user_roles_validate_department on public.user_roles;
create trigger user_roles_validate_department
before insert or update on public.user_roles
for each row execute function public.validate_user_role_department();

-- "Never leave an organization without a super admin" is now PER organization.
create or replace function public.prevent_last_super_admin_removal()
returns trigger
language plpgsql security definer set search_path = public as $$
declare remaining int;
begin
  if tg_op = 'DELETE' then
    if old.role = 'super_admin' then
      select count(*) into remaining from public.user_roles
      where role = 'super_admin' and organization_id = old.organization_id and user_id <> old.user_id;
      if remaining = 0 then
        raise exception 'Cannot remove the last super admin of this organization.';
      end if;
    end if;
    return old;
  elsif tg_op = 'UPDATE' then
    if old.role = 'super_admin' and (new.role <> 'super_admin' or new.organization_id <> old.organization_id) then
      select count(*) into remaining from public.user_roles
      where role = 'super_admin' and organization_id = old.organization_id and user_id <> old.user_id;
      if remaining = 0 then
        raise exception 'Cannot demote or move the last super admin of this organization.';
      end if;
    end if;
    return new;
  end if;
  return new;
end;
$$;
revoke all on function public.prevent_last_super_admin_removal() from public, anon, authenticated;

-- New sign-ups get a profile only. Access is granted explicitly (by a client's
-- admin, or by you when onboarding a client) — nobody is auto-promoted.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    coalesce(new.email, '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
revoke all on function public.handle_new_user() from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 6. Row Level Security
-- ----------------------------------------------------------------------------

-- organizations: you see all; everyone else sees only their own (even when
-- suspended, so the app can tell them why they are locked out).
drop policy if exists "organizations_select" on public.organizations;
drop policy if exists "organizations_insert_platform" on public.organizations;
drop policy if exists "organizations_update_platform" on public.organizations;
create policy "organizations_select" on public.organizations for select to authenticated
  using (public.is_platform_admin() or id = public.my_org_id());
create policy "organizations_insert_platform" on public.organizations for insert to authenticated
  with check (public.is_platform_admin());
create policy "organizations_update_platform" on public.organizations for update to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

-- platform_admins: you can only see your own row. Nobody can write through
-- the API — add/remove platform admins with SQL only.
drop policy if exists "platform_admins_select_self" on public.platform_admins;
create policy "platform_admins_select_self" on public.platform_admins for select to authenticated
  using (user_id = auth.uid());

-- departments: own organization only; only that organization's super admin writes.
drop policy if exists "departments_select_all" on public.departments;
drop policy if exists "departments_super_admin_write" on public.departments;
drop policy if exists "departments_select_own_org" on public.departments;
drop policy if exists "departments_write_own_org" on public.departments;
create policy "departments_select_own_org" on public.departments for select to authenticated
  using (organization_id = public.active_org_id());
create policy "departments_write_own_org" on public.departments for all to authenticated
  using (organization_id = public.active_org_id() and public.has_role(auth.uid(), 'super_admin'))
  with check (organization_id = public.active_org_id() and public.has_role(auth.uid(), 'super_admin'));

-- user_roles: your own row always; others only inside your own organization.
drop policy if exists "user_roles_select_scoped" on public.user_roles;
drop policy if exists "user_roles_head_staff_manage" on public.user_roles;
create policy "user_roles_select_scoped" on public.user_roles for select to authenticated
  using (
    user_id = auth.uid()
    or (
      organization_id = public.active_org_id()
      and (
        public.is_head_staff_or_above(auth.uid())
        or (public.has_role(auth.uid(), 'admin') and department_id = public.get_user_department(auth.uid()))
      )
    )
  );
create policy "user_roles_head_staff_manage" on public.user_roles for all to authenticated
  using (organization_id = public.active_org_id() and public.is_head_staff_or_above(auth.uid()))
  with check (organization_id = public.active_org_id() and public.is_head_staff_or_above(auth.uid()));

-- profiles: previously readable by every signed-in user — that would leak names
-- and emails across clients. Now: yourself, or people in your own organization.
drop policy if exists "profiles_select_all" on public.profiles;
drop policy if exists "profiles_select_scoped" on public.profiles;
create policy "profiles_select_scoped" on public.profiles for select to authenticated
  using (id = auth.uid() or public.shares_org_with(id));

-- audit_log: each organization's leadership sees only its own trail.
drop policy if exists "audit_select" on public.audit_log;
drop policy if exists "audit_select_scoped" on public.audit_log;
drop policy if exists "audit_insert" on public.audit_log;
create policy "audit_select_scoped" on public.audit_log for select to authenticated
  using (organization_id = public.active_org_id() and public.is_head_staff_or_above(auth.uid()));
create policy "audit_insert" on public.audit_log for insert to authenticated
  with check (
    user_id = auth.uid()
    and (organization_id = public.active_org_id() or public.is_platform_admin())
  );

-- stock_out: the recipient department (cross-department transfers) must also
-- be inside the same organization.
drop policy if exists "stock_out_insert_scoped" on public.stock_out;
create policy "stock_out_insert_scoped" on public.stock_out for insert to authenticated
  with check (
    logged_by = auth.uid()
    and exists (
      select 1 from public.items i
      where i.id = stock_out.item_id and public.can_view_department(auth.uid(), i.department_id)
    )
    and (recipient_department_id is null or public.dept_in_my_org(recipient_department_id))
  );

drop policy if exists "stock_out_update_scoped" on public.stock_out;
create policy "stock_out_update_scoped" on public.stock_out for update to authenticated
  using (exists (
    select 1 from public.items i
    where i.id = stock_out.item_id and public.is_dept_admin_or_above(auth.uid(), i.department_id)
  ))
  with check (
    exists (
      select 1 from public.items i
      where i.id = stock_out.item_id and public.is_dept_admin_or_above(auth.uid(), i.department_id)
    )
    and (recipient_department_id is null or public.dept_in_my_org(recipient_department_id))
  );

-- ----------------------------------------------------------------------------
-- 7. Platform console data (metadata only — never inventory contents)
-- ----------------------------------------------------------------------------

create or replace function public.platform_org_overview()
returns table (
  org_id uuid,
  user_count bigint,
  department_count bigint,
  item_count bigint,
  movement_count_30d bigint,
  last_activity timestamptz
)
language sql stable security definer set search_path = public as $$
  select
    o.id,
    (select count(*) from public.user_roles ur where ur.organization_id = o.id),
    (select count(*) from public.departments d where d.organization_id = o.id),
    (select count(*) from public.items i
       join public.departments d on d.id = i.department_id
       where d.organization_id = o.id and i.deleted_at is null),
    (select count(*) from public.stock_in si
       join public.items i on i.id = si.item_id
       join public.departments d on d.id = i.department_id
       where d.organization_id = o.id and si.deleted_at is null
         and si.created_at > now() - interval '30 days')
    + (select count(*) from public.stock_out so
       join public.items i on i.id = so.item_id
       join public.departments d on d.id = i.department_id
       where d.organization_id = o.id and so.deleted_at is null
         and so.created_at > now() - interval '30 days'),
    (select max(a.created_at) from public.audit_log a where a.organization_id = o.id)
  from public.organizations o
  where public.is_platform_admin()
$$;
revoke all on function public.platform_org_overview() from public, anon;
grant execute on function public.platform_org_overview() to authenticated;

commit;

-- ============================================================================
-- AFTER this succeeds, make yourself a platform admin (run once, separately):
--
--   insert into public.platform_admins (user_id)
--   select id from auth.users where email = 'urboikelvin13@yahoo.com'
--   on conflict do nothing;
-- ============================================================================
