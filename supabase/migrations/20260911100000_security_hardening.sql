-- Security hardening pass, high-priority items #1, #2, #4.

-- ============================================================================
-- #1: Audit log integrity
-- ============================================================================
-- UPDATE/DELETE were never GRANTed to `authenticated` in the first place, so
-- this is defense-in-depth rather than closing an open door — but explicit
-- beats implicit, especially for an audit trail. If it can be edited or
-- erased, it isn't actually an audit trail.
revoke update, delete on public.audit_log from authenticated;

-- ============================================================================
-- #2: Soft-delete for items, stock_in, stock_out
-- ============================================================================
-- "Delete" in the app now means "hide it," not "destroy it." This also
-- incidentally fixes a real pre-existing risk: items.id had ON DELETE
-- CASCADE onto stock_in/stock_out, so a single hard-deleted item used to
-- silently wipe out its entire movement history along with it.
alter table public.items add column if not exists deleted_at timestamptz;
alter table public.stock_in add column if not exists deleted_at timestamptz;
alter table public.stock_out add column if not exists deleted_at timestamptz;

-- Speeds up the "where deleted_at is null" filter every normal query now
-- does, without slowing down normal writes.
create index if not exists items_not_deleted_idx on public.items (id) where deleted_at is null;
create index if not exists stock_in_not_deleted_idx on public.stock_in (id) where deleted_at is null;
create index if not exists stock_out_not_deleted_idx on public.stock_out (id) where deleted_at is null;

-- ============================================================================
-- #4: Rate limiting for sensitive admin actions
-- ============================================================================
-- Deliberately has NO policies for `authenticated` at all — only the
-- service-role server functions (create/remove user) can touch this table,
-- since service_role bypasses RLS by default. A regular user, even a
-- compromised admin session, cannot read or tamper with their own rate
-- limit record through the normal client.
create table if not exists public.rate_limit_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null,
  created_at timestamptz not null default now()
);
alter table public.rate_limit_log enable row level security;
grant all on public.rate_limit_log to service_role;

create index if not exists rate_limit_log_lookup_idx on public.rate_limit_log (user_id, action, created_at);
