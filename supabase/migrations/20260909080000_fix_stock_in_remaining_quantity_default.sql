-- Hotfix for Feature 3: remaining_quantity was defaulting to 0 on every NEW
-- Stock In row (the column DEFAULT 0 set during the migration, meant only
-- to safely backfill old rows, was silently applying to new inserts too,
-- since the app never explicitly sets this system-managed field itself).
--
-- This adds a trigger so remaining_quantity is always correctly initialized
-- to the batch's received quantity on insert — the column default no
-- longer matters once this trigger exists, but is harmless to leave as-is.
--
-- It also recomputes remaining_quantity for every existing batch from first
-- principles (received quantity minus whatever's actually been allocated
-- out of it, per the allocations ledger) — this safely corrects any batch
-- that already got the wrong value, without needing to guess which ones
-- were affected.

create or replace function public.init_stock_in_remaining_quantity()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.remaining_quantity := new.quantity;
  return new;
end;
$$;
revoke all on function public.init_stock_in_remaining_quantity() from public, anon, authenticated;

drop trigger if exists stock_in_init_remaining on public.stock_in;
create trigger stock_in_init_remaining
before insert on public.stock_in
for each row execute function public.init_stock_in_remaining_quantity();

-- Recompute every batch's remaining_quantity from the authoritative source
-- of truth (its own received quantity minus its recorded allocations),
-- correcting anything the default-0 bug already broke.
update public.stock_in si
set remaining_quantity = si.quantity - coalesce(
  (select sum(a.quantity) from public.stock_out_allocations a where a.stock_in_id = si.id),
  0
);

-- Refresh every item's balance/expiry now that batch data is corrected.
do $$
declare r record;
begin
  for r in select id from public.items loop
    perform public.recalc_item_balance(r.id);
  end loop;
end;
$$;
