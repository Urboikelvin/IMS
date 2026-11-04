-- ============================================================================
-- Bug-fix migration. Safe to re-run (create-or-replace / drop-if-exists), and
-- the whole thing runs in ONE transaction: if any statement fails, nothing is
-- applied.
--
--   B1  Low-stock emails: no more alert for every NEW item, no alert for a
--       deleted item, and an item is only marked "notified" when an alert was
--       really sent (so setting up the webhook later doesn't leave items
--       silently muted).
--   B4  FEFO stock-out allocation: concurrent issues of the same item can no
--       longer under-allocate. Issues for one item are serialised, and the
--       function now refuses to finish if any quantity is left unallocated.
--   B5  Soft-deleted stock_in / stock_out rows are now ignored by balances,
--       batch availability and expiry, and deleting/restoring a Stock Out
--       releases/re-takes its batch allocation. A batch that has already been
--       issued from still cannot be soft-deleted.
--
-- Run this BEFORE (or together with) deploying the new front-end.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- B1. Low-stock notification trigger
-- ----------------------------------------------------------------------------
create or replace function public.check_low_stock_and_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  is_low boolean;
  was_notified boolean;
  stock_dropped boolean;
  hook_url text;
  hook_secret text;
begin
  -- A deleted item never alerts anyone.
  if new.deleted_at is not null then
    return new;
  end if;

  is_low := new.current_balance <= new.reorder_threshold;
  was_notified := case when tg_op = 'UPDATE' then coalesce(old.low_stock_notified, false) else false end;

  -- Only alert when something actually pushed the item towards empty: its
  -- stock went DOWN, or its reorder threshold was RAISED. A brand-new item
  -- (balance 0) or a delivery that leaves it still low is not a "dropped" event.
  stock_dropped := tg_op = 'UPDATE'
    and (new.current_balance < old.current_balance or new.reorder_threshold > old.reorder_threshold);

  if is_low and not was_notified and stock_dropped then
    hook_url := current_setting('app.settings.low_stock_webhook_url', true);
    hook_secret := current_setting('app.settings.low_stock_hook_secret', true);

    -- Only mark as notified when an alert is really being sent.
    if hook_url is not null and hook_url <> '' then
      new.low_stock_notified := true;

      perform net.http_post(
        url := hook_url,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-hook-secret', coalesce(hook_secret, '')
        ),
        body := jsonb_build_object(
          'item_id', new.id,
          'item_name', new.name,
          'current_balance', new.current_balance,
          'reorder_threshold', new.reorder_threshold,
          'unit', new.unit
        )
      );
    end if;
  elsif not is_low and was_notified then
    -- restocked above threshold: reset so the next dip sends a fresh email
    new.low_stock_notified := false;
  end if;

  return new;
end;
$$;
revoke all on function public.check_low_stock_and_notify() from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- B5. Balances / expiry ignore soft-deleted rows
-- ----------------------------------------------------------------------------
create or replace function public.recalc_item_balance(_item_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.items i
  set current_balance = coalesce((select sum(quantity) from public.stock_in  where item_id = _item_id and deleted_at is null), 0)
                      - coalesce((select sum(quantity) from public.stock_out where item_id = _item_id and deleted_at is null), 0),
      expiry_date = (select min(expiry_date) from public.stock_in
                     where item_id = _item_id and deleted_at is null and remaining_quantity > 0),
      updated_at = now()
  where i.id = _item_id;
end;
$$;
revoke all on function public.recalc_item_balance(uuid) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- B4 + B5. FEFO allocation: serialised per item, verified, ignores deleted batches
-- ----------------------------------------------------------------------------
create or replace function public.allocate_stock_out_fefo(_stock_out_id uuid, _item_id uuid, _quantity numeric)
returns void language plpgsql security definer set search_path = public as $$
declare
  remaining_to_allocate numeric := _quantity;
  batch record;
  take numeric;
  total_available numeric;
begin
  -- One issue per item at a time. The lock is released automatically when the
  -- transaction ends, so a second issue only starts after the first has fully
  -- committed and therefore sees its updated batch numbers.
  perform pg_advisory_xact_lock(hashtextextended(_item_id::text, 0));

  select coalesce(sum(remaining_quantity), 0) into total_available
  from public.stock_in
  where item_id = _item_id and deleted_at is null;

  if _quantity > total_available then
    raise exception 'Insufficient stock: only % available', total_available;
  end if;

  for batch in
    select id, remaining_quantity
    from public.stock_in
    where item_id = _item_id and remaining_quantity > 0 and deleted_at is null
    order by expiry_date asc nulls last, date asc, created_at asc
    for update
  loop
    exit when remaining_to_allocate <= 0;
    take := least(batch.remaining_quantity, remaining_to_allocate);

    update public.stock_in set remaining_quantity = remaining_quantity - take where id = batch.id;
    insert into public.stock_out_allocations (stock_out_id, stock_in_id, quantity) values (_stock_out_id, batch.id, take);

    remaining_to_allocate := remaining_to_allocate - take;
  end loop;

  -- Belt and braces: never finish with part of the issue unaccounted for.
  if remaining_to_allocate > 0 then
    raise exception 'Insufficient stock: could not allocate % of the requested %', remaining_to_allocate, _quantity;
  end if;
end;
$$;
revoke all on function public.allocate_stock_out_fefo(uuid, uuid, numeric) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- B5. Stock Out trigger: soft-delete releases the batches, restore re-takes them
-- ----------------------------------------------------------------------------
create or replace function public.stock_out_fefo_allocate()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.deleted_at is null then
      perform public.allocate_stock_out_fefo(new.id, new.item_id, new.quantity);
    end if;
  elsif tg_op = 'UPDATE' then
    if new.deleted_at is not null then
      -- (Soft-)deleted: give the stock back to its batches, once.
      if old.deleted_at is null then
        perform public.reverse_stock_out_allocations(old.id);
      end if;
    elsif old.deleted_at is not null then
      -- Restored: take from the batches again (raises if the stock is gone).
      perform public.allocate_stock_out_fefo(new.id, new.item_id, new.quantity);
    elsif new.quantity <> old.quantity or new.item_id <> old.item_id then
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

-- ----------------------------------------------------------------------------
-- B5. A batch that has already been issued from cannot be soft-deleted either
--     (the existing trigger only guards real DELETEs).
-- ----------------------------------------------------------------------------
create or replace function public.prevent_soft_deleting_issued_batch()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.deleted_at is not null and old.deleted_at is null and old.remaining_quantity < old.quantity then
    raise exception 'This batch has already been issued from and cannot be deleted.';
  end if;
  return new;
end;
$$;
revoke all on function public.prevent_soft_deleting_issued_batch() from public, anon, authenticated;

drop trigger if exists stock_in_protect_issued_batch_soft on public.stock_in;
create trigger stock_in_protect_issued_batch_soft
before update on public.stock_in
for each row execute function public.prevent_soft_deleting_issued_batch();

commit;
