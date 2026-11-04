-- ============================================================================
-- Platform console: subscriptions, payments and the activity feed.
--
-- Everything here is PLATFORM-ONLY. Row-level security lets only a platform
-- admin (a row in platform_admins) read or touch these tables, so a client's
-- own staff can never see fees, payments or your notes — unlike
-- public.organizations, which each client can read for its own row.
--
--   organization_billing   per client: plan name, monthly fee, private notes
--   client_payments        ledger of payments received (written ONLY through
--                          record_client_payment / void_client_payment)
--   platform_events        activity feed, written ONLY by database triggers
--                          and functions, so it cannot be forged or skipped
--
-- Also moves the private "notes" that used to live on organizations (and were
-- readable by that client's staff) into organization_billing.
--
-- One transaction: it either applies fully or not at all. Safe to re-run.
-- Run AFTER 20261103120000_fix_low_stock_fefo_and_soft_delete.sql.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. Tables
-- ----------------------------------------------------------------------------

create table if not exists public.organization_billing (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  plan_name text,
  monthly_fee numeric(14, 2) not null default 0 check (monthly_fee >= 0),
  billing_notes text,
  updated_at timestamptz not null default now()
);

create table if not exists public.client_payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  amount numeric(14, 2) not null check (amount > 0),
  paid_on date not null default current_date,
  months_covered integer not null default 1 check (months_covered between 1 and 36),
  extended boolean not null default true,        -- did this payment move the renewal date?
  reference text,
  note text,
  recorded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists client_payments_org_paid_idx on public.client_payments (organization_id, paid_on desc);
create index if not exists client_payments_paid_idx on public.client_payments (paid_on desc);

create table if not exists public.platform_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete set null,
  organization_name text,                         -- snapshot, survives a deleted client
  kind text not null,
  details jsonb not null default '{}'::jsonb,
  actor_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists platform_events_created_idx on public.platform_events (created_at desc);

-- Every existing client gets a billing row (fee 0 until you set one).
insert into public.organization_billing (organization_id)
select id from public.organizations
on conflict (organization_id) do nothing;

-- Move the old vendor-private notes out of the client-readable table.
update public.organization_billing b
set billing_notes = o.notes
from public.organizations o
where o.id = b.organization_id
  and o.notes is not null and btrim(o.notes) <> ''
  and b.billing_notes is null;
update public.organizations set notes = null where notes is not null;

-- ----------------------------------------------------------------------------
-- 2. Access: platform admins only (reads), writes through functions/triggers
-- ----------------------------------------------------------------------------

alter table public.organization_billing enable row level security;
alter table public.client_payments enable row level security;
alter table public.platform_events enable row level security;

grant select, insert, update on public.organization_billing to authenticated;
grant select on public.client_payments to authenticated;
grant select on public.platform_events to authenticated;
grant all on public.organization_billing, public.client_payments, public.platform_events to service_role;

drop policy if exists "organization_billing_select" on public.organization_billing;
drop policy if exists "organization_billing_insert" on public.organization_billing;
drop policy if exists "organization_billing_update" on public.organization_billing;
create policy "organization_billing_select" on public.organization_billing for select to authenticated
  using (public.is_platform_admin());
create policy "organization_billing_insert" on public.organization_billing for insert to authenticated
  with check (public.is_platform_admin());
create policy "organization_billing_update" on public.organization_billing for update to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

drop policy if exists "client_payments_select" on public.client_payments;
create policy "client_payments_select" on public.client_payments for select to authenticated
  using (public.is_platform_admin());

drop policy if exists "platform_events_select" on public.platform_events;
create policy "platform_events_select" on public.platform_events for select to authenticated
  using (public.is_platform_admin());

-- Keep updated_at honest.
create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.touch_updated_at() from public, anon, authenticated;

drop trigger if exists organization_billing_touch on public.organization_billing;
create trigger organization_billing_touch before update on public.organization_billing
for each row execute function public.touch_updated_at();

-- ----------------------------------------------------------------------------
-- 3. Activity feed: written by triggers, so it can't be skipped or forged
-- ----------------------------------------------------------------------------

create or replace function public.log_organization_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.platform_events (organization_id, organization_name, kind, details, actor_id)
    values (new.id, new.name, 'client.created',
            jsonb_build_object('subscription_ends_on', new.subscription_ends_on), auth.uid());

  elsif tg_op = 'UPDATE' then
    if new.status is distinct from old.status then
      insert into public.platform_events (organization_id, organization_name, kind, details, actor_id)
      values (new.id, new.name,
              case when new.status = 'suspended' then 'client.suspended' else 'client.reactivated' end,
              '{}'::jsonb, auth.uid());
    end if;

    -- Payments move the renewal date themselves and log their own event.
    if new.subscription_ends_on is distinct from old.subscription_ends_on
       and coalesce(current_setting('kaya.suppress_subscription_event', true), '') <> 'on' then
      insert into public.platform_events (organization_id, organization_name, kind, details, actor_id)
      values (new.id, new.name, 'subscription.changed',
              jsonb_build_object('from', old.subscription_ends_on, 'to', new.subscription_ends_on), auth.uid());
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.log_organization_event() from public, anon, authenticated;

drop trigger if exists organizations_log_insert on public.organizations;
create trigger organizations_log_insert after insert on public.organizations
for each row execute function public.log_organization_event();

drop trigger if exists organizations_log_update on public.organizations;
create trigger organizations_log_update after update on public.organizations
for each row execute function public.log_organization_event();

-- ----------------------------------------------------------------------------
-- 4. Recording and voiding payments (atomic, platform admins only)
-- ----------------------------------------------------------------------------

-- Records a payment and (unless _extend is false) moves the renewal date
-- forward. A client that is still paid up renews from their current end date;
-- a lapsed client renews from the day they paid. Returns the new end date.
create or replace function public.record_client_payment(
  _org_id uuid,
  _amount numeric,
  _paid_on date,
  _months integer,
  _reference text default null,
  _note text default null,
  _extend boolean default true
)
returns date
language plpgsql security definer set search_path = public as $$
declare
  org public.organizations;
  paid date := coalesce(_paid_on, current_date);
  new_end date;
  payment_id uuid;
begin
  if not public.is_platform_admin() then
    raise exception 'Only platform admins can record payments.';
  end if;
  if _amount is null or _amount <= 0 then
    raise exception 'Enter an amount greater than zero.';
  end if;
  if _months is null or _months < 1 or _months > 36 then
    raise exception 'Months covered must be between 1 and 36.';
  end if;

  select * into org from public.organizations where id = _org_id for update;
  if not found then
    raise exception 'Client not found.';
  end if;

  new_end := org.subscription_ends_on;
  if _extend then
    new_end := (greatest(coalesce(org.subscription_ends_on, paid), paid) + make_interval(months => _months))::date;
  end if;

  insert into public.client_payments (organization_id, amount, paid_on, months_covered, extended, reference, note, recorded_by)
  values (_org_id, _amount, paid, _months, _extend, nullif(btrim(_reference), ''), nullif(btrim(_note), ''), auth.uid())
  returning id into payment_id;

  if _extend then
    perform set_config('kaya.suppress_subscription_event', 'on', true);
    update public.organizations set subscription_ends_on = new_end where id = _org_id;
    perform set_config('kaya.suppress_subscription_event', 'off', true);
  end if;

  insert into public.platform_events (organization_id, organization_name, kind, details, actor_id)
  values (_org_id, org.name, 'payment.recorded',
          jsonb_build_object('payment_id', payment_id, 'amount', _amount, 'months', _months,
                             'extended', _extend, 'new_end', new_end),
          auth.uid());

  return new_end;
end;
$$;
revoke all on function public.record_client_payment(uuid, numeric, date, integer, text, text, boolean) from public, anon;
grant execute on function public.record_client_payment(uuid, numeric, date, integer, text, text, boolean) to authenticated;

-- Removes a payment recorded by mistake. If it had extended the renewal date,
-- the date moves back by the same number of months.
create or replace function public.void_client_payment(_payment_id uuid)
returns date
language plpgsql security definer set search_path = public as $$
declare
  pay public.client_payments;
  org public.organizations;
  new_end date;
begin
  if not public.is_platform_admin() then
    raise exception 'Only platform admins can void payments.';
  end if;

  select * into pay from public.client_payments where id = _payment_id for update;
  if not found then
    raise exception 'Payment not found.';
  end if;

  select * into org from public.organizations where id = pay.organization_id for update;
  new_end := org.subscription_ends_on;

  delete from public.client_payments where id = _payment_id;

  if pay.extended and org.subscription_ends_on is not null then
    new_end := (org.subscription_ends_on - make_interval(months => pay.months_covered))::date;
    perform set_config('kaya.suppress_subscription_event', 'on', true);
    update public.organizations set subscription_ends_on = new_end where id = org.id;
    perform set_config('kaya.suppress_subscription_event', 'off', true);
  end if;

  insert into public.platform_events (organization_id, organization_name, kind, details, actor_id)
  values (org.id, org.name, 'payment.voided',
          jsonb_build_object('amount', pay.amount, 'months', pay.months_covered, 'paid_on', pay.paid_on, 'new_end', new_end),
          auth.uid());

  return new_end;
end;
$$;
revoke all on function public.void_client_payment(uuid) from public, anon;
grant execute on function public.void_client_payment(uuid) to authenticated;

commit;
