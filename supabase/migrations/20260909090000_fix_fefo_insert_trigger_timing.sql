-- Hotfix for Feature 3: the FEFO allocation trigger ran BEFORE INSERT on
-- stock_out, and tried to record which batch was drawn from by inserting
-- into stock_out_allocations referencing the new stock_out row's id — but
-- at BEFORE-trigger time, that row doesn't actually exist in the table
-- yet (only its field values do), so the foreign key check correctly
-- rejected it.
--
-- Fix: do the allocation AFTER the insert instead, once the stock_out row
-- genuinely exists. If there isn't enough stock, the exception raised
-- inside the allocation still rolls back the ENTIRE insert (this is
-- standard Postgres behavior for any trigger, before or after) — so the
-- over-issue protection works exactly the same as before, this only fixes
-- the technical ordering.
--
-- It also needs to run BEFORE the existing stock_out_balance trigger (which
-- recalculates the item's balance/expiry) so that trigger sees the
-- up-to-date batch numbers — Postgres runs same-timing triggers in
-- alphabetical order by name, so this new trigger is deliberately named to
-- sort ahead of "stock_out_balance".

drop trigger if exists stock_out_fefo_insert on public.stock_out;

create trigger stock_out_a_fefo_insert
after insert on public.stock_out
for each row execute function public.stock_out_fefo_allocate();
