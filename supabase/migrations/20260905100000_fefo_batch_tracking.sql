-- Feature 3: automatic expiry/batch tracking (FEFO — First-Expired-First-Out).
--
-- THE PROBLEM THIS SOLVES: today, an item has ONE balance number and ONE
-- expiry date. If 5 units expiring in March are already in stock and 20
-- more arrive expiring in September, there was no way to tell them apart
-- once combined, and no way to know which ones get issued first.
--
-- THE FIX: every stock_in row is now treated as its own "batch" with its
-- own expiry_date and its own remaining_quantity (separate from the
-- original received quantity, since that shrinks as the batch gets issued
-- from). When someone logs a Stock Out, a trigger automatically walks
-- through that item's batches, soonest-expiring first, and silently
-- deducts from them — staff still just pick an item and a quantity, same
-- form as always, zero added friction.
--
-- items.expiry_date is no longer something an admin sets by hand — it's
-- now automatically recalculated to always show the soonest expiry date
-- among that item's remaining (unissued) stock. This means the existing
-- Dashboard "Expiry Watch" feature keeps working with no frontend changes,
-- it just becomes accurate at the batch level instead of a single static
-- guess.

-- ----------------------------------------------------------------------------
-- stock_in becomes a real batch ledger
-- ----------------------------------------------------------------------------

alter table public.stock_in add column if not exists expiry_date date;

alter table public.stock_in add column if not exists remaining_quantity numeric;
update public.stock_in set remaining_quantity = quantity where remaining_quantity is null;
alter table public.stock_in alter column remaining_quantity set not null;
alter table public.stock_in alter column remaining_quantity set default 0;
alter table public.stock_in drop constraint if exists stock_in_remaining_quantity_check;
alter table public.stock_in add constraint stock_in_remaining_quantity_check check (remaining_quantity >= 0);

-- ----------------------------------------------------------------------------
-- Records exactly which batch(es) a given Stock Out actually consumed from,
-- so edits/deletes can correctly reverse the allocation instead of just
-- guessing.
-- ----------------------------------------------------------------------------

create table if not exists public.stock_out_allocations (
  id uuid primary key default gen_random_uuid(),
  stock_out_id uuid not null references public.stock_out(id) on delete cascade,
  stock_in_id uuid not null references public.stock_in(id) on delete restrict,
  quantity numeric not null check (quantity > 0),
  created_at timestamptz not null default now()
);
grant select on public.stock_out_allocations to authenticated;
grant all on public.stock_out_allocations to service_role;
alter table public.stock_out_allocations enable row level security;

drop policy if exists "stock_out_allocations_select_scoped" on public.stock_out_allocations;
create policy "stock_out_allocations_select_scoped" on public.stock_out_allocations for select to authenticated
  using (exists (
    select 1 from public.stock_out so
    join public.items i on i.id = so.item_id
    where so.id = stock_out_allocations.stock_out_id
      and public.can_view_department(auth.uid(), i.department_id)
  ));

-- A batch that's already been (even partially) issued from can't be
-- deleted outright — that would silently corrupt the ledger. Admins can
-- still delete a batch that hasn't been touched yet.
create or replace function public.prevent_deleting_issued_batch()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.remaining_quantity < old.quantity then
    raise exception 'This batch has already been issued from and cannot be deleted.';
  end if;
  return old;
end;
$$;
revoke all on function public.prevent_deleting_issued_batch() from public, anon, authenticated;

drop trigger if exists stock_in_protect_issued_batch on public.stock_in;
create trigger stock_in_protect_issued_batch
before delete on public.stock_in
for each row execute function public.prevent_deleting_issued_batch();

-- If an admin edits a batch's received quantity after the fact, keep
-- remaining_quantity in step with the same delta — but never let it go
-- negative (that would mean shrinking a batch below what's already shipped,
-- which the CHECK constraint above will correctly reject).
create or replace function public.adjust_remaining_on_stock_in_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.quantity <> old.quantity then
    new.remaining_quantity := old.remaining_quantity + (new.quantity - old.quantity);
  end if;
  return new;
end;
$$;
revoke all on function public.adjust_remaining_on_stock_in_update() from public, anon, authenticated;

drop trigger if exists stock_in_adjust_remaining on public.stock_in;
create trigger stock_in_adjust_remaining
before update on public.stock_in
for each row execute function public.adjust_remaining_on_stock_in_update();

-- ----------------------------------------------------------------------------
-- The FEFO engine itself
-- ----------------------------------------------------------------------------

-- Restores remaining_quantity to whatever batches a Stock Out previously
-- drew from, and clears the allocation records — used before re-allocating
-- an edited Stock Out, and before removing one entirely.
create or replace function public.reverse_stock_out_allocations(_stock_out_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.stock_in si
  set remaining_quantity = remaining_quantity + a.quantity
  from public.stock_out_allocations a
  where a.stock_out_id = _stock_out_id and a.stock_in_id = si.id;

  delete from public.stock_out_allocations where stock_out_id = _stock_out_id;
end;
$$;
revoke all on function public.reverse_stock_out_allocations(uuid) from public, anon, authenticated;

-- Walks that item's batches soonest-expiring first (batches with no expiry
-- date at all are treated as "never expires" and drawn from last), and
-- deducts _quantity across as many batches as it takes. Raises if there
-- genuinely isn't enough stock — this is the real availability check now,
-- replacing the old simple sum-based one.
create or replace function public.allocate_stock_out_fefo(_stock_out_id uuid, _item_id uuid, _quantity numeric)
returns void language plpgsql security definer set search_path = public as $$
declare
  remaining_to_allocate numeric := _quantity;
  batch record;
  take numeric;
  total_available numeric;
begin
  select coalesce(sum(remaining_quantity), 0) into total_available
  from public.stock_in where item_id = _item_id;

  if _quantity > total_available then
    raise exception 'Insufficient stock: only % available', total_available;
  end if;

  for batch in
    select id, remaining_quantity
    from public.stock_in
    where item_id = _item_id and remaining_quantity > 0
    order by expiry_date asc nulls last, date asc, created_at asc
    for update
  loop
    exit when remaining_to_allocate <= 0;
    take := least(batch.remaining_quantity, remaining_to_allocate);

    update public.stock_in set remaining_quantity = remaining_quantity - take where id = batch.id;
    insert into public.stock_out_allocations (stock_out_id, stock_in_id, quantity) values (_stock_out_id, batch.id, take);

    remaining_to_allocate := remaining_to_allocate - take;
  end loop;
end;
$$;
revoke all on function public.allocate_stock_out_fefo(uuid, uuid, numeric) from public, anon, authenticated;

-- Replaces the old validate_stock_out — this one both validates AND
-- performs the actual batch allocation, since they need to happen
-- atomically (checking availability and reserving it must be one step,
-- or two simultaneous Stock Outs could both "pass" the check).
create or replace function public.stock_out_fefo_allocate()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.allocate_stock_out_fefo(new.id, new.item_id, new.quantity);
  elsif tg_op = 'UPDATE' then
    if new.quantity <> old.quantity or new.item_id <> old.item_id then
      perform public.reverse_stock_out_allocations(old.id);
      perform public.allocate_stock_out_fefo(new.id, new.item_id, new.quantity);
    end if;
  elsif tg_op = 'DELETE' then
    perform public.reverse_stock_out_allocations(old.id);
    return old;
  end if;
  return new;
end;
$$;
revoke all on function public.stock_out_fefo_allocate() from public, anon, authenticated;

drop trigger if exists stock_out_validate on public.stock_out;
drop trigger if exists stock_out_fefo_insert on public.stock_out;
drop trigger if exists stock_out_fefo_update on public.stock_out;
drop trigger if exists stock_out_fefo_delete on public.stock_out;

create trigger stock_out_fefo_insert
before insert on public.stock_out
for each row execute function public.stock_out_fefo_allocate();

create trigger stock_out_fefo_update
before update on public.stock_out
for each row execute function public.stock_out_fefo_allocate();

create trigger stock_out_fefo_delete
before delete on public.stock_out
for each row execute function public.stock_out_fefo_allocate();

-- ----------------------------------------------------------------------------
-- Keep items.expiry_date automatically showing the soonest expiry among
-- that item's remaining stock (extends the existing balance-recalc
-- function so nothing else needs to change).
-- ----------------------------------------------------------------------------

create or replace function public.recalc_item_balance(_item_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.items i
  set current_balance = coalesce((select sum(quantity) from public.stock_in where item_id = _item_id),0)
                      - coalesce((select sum(quantity) from public.stock_out where item_id = _item_id),0),
      expiry_date = (select min(expiry_date) from public.stock_in where item_id = _item_id and remaining_quantity > 0),
      updated_at = now()
  where i.id = _item_id;
end;
$$;

-- One-time backfill: give existing stock_in rows an expiry_date to seed
-- from, using each item's current (manually-set) expiry_date as a
-- reasonable starting guess for its most recent batch. New batches from now
-- on carry their own real expiry_date entered at Stock In time.
update public.stock_in si
set expiry_date = i.expiry_date
from public.items i
where si.item_id = i.id and si.expiry_date is null and i.expiry_date is not null;

-- IMPORTANT: every existing batch was just set to remaining_quantity =
-- quantity (full) above, but items with prior Stock Out history have
-- already had some of that stock issued — just not tracked at the batch
-- level before now. Left as-is, remaining_quantity would overstate what's
-- really left, letting the new FEFO check approve an over-issue beyond the
-- item's true balance.
--
-- Fix: replay every existing Stock Out record, in the order it was
-- originally created, through the exact same allocation function new
-- entries will use. This both correctly reduces remaining_quantity down to
-- the item's real current balance, AND gives old Stock Out records proper
-- batch attribution — so editing or deleting a pre-migration entry later
-- still reverses/reallocates correctly instead of being a no-op.
--
-- Replaying in `created_at` order (true insertion order) rather than the
-- user-entered `date` matters here: that's the order the old validation
-- actually checked availability in when each record was first saved, so
-- replaying in that same order is guaranteed to never hit a false
-- "insufficient stock" error, even though exactly which physical batch an
-- old record is attributed to is necessarily a best-effort reconstruction
-- (that granularity never existed before this migration).
do $$
declare so_row record;
begin
  for so_row in select id, item_id, quantity from public.stock_out order by created_at asc loop
    perform public.allocate_stock_out_fefo(so_row.id, so_row.item_id, so_row.quantity);
  end loop;
end;
$$;

-- Recompute every item now that remaining_quantity/expiry_date backfill is
-- correctly reconciled with real history.
do $$
declare r record;
begin
  for r in select id from public.items loop
    perform public.recalc_item_balance(r.id);
  end loop;
end;
$$;
