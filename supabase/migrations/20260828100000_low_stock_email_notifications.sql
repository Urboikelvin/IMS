-- Feature 5: email notifications to admins on low stock.
--
-- How it works:
--   1. `low_stock_notified` tracks whether we've already alerted for the
--      CURRENT low-stock episode of this item.
--   2. Whenever a row in `items` is inserted or updated (which covers both
--      stock movements, since those recalculate current_balance, and direct
--      threshold edits on the Items page), this trigger checks whether the
--      item just crossed INTO low stock (balance <= threshold) while we
--      hadn't already notified for it — if so, it flips the flag on and
--      fires an async HTTP call (via pg_net) to a Supabase Edge Function,
--      which sends the actual email.
--   3. If the item is later restocked back above its threshold, the flag
--      resets to false — so the next time it drops low, a fresh email goes
--      out. This is the "no duplicate emails" dedup logic.
--   4. If the webhook URL/secret haven't been configured yet, the trigger
--      simply skips the HTTP call (stock recording never breaks because of
--      a missing email setup).
--
-- After running this, you still need to:
--   a) Deploy the `low-stock-alert` Edge Function (see the separate
--      index.ts file + setup guide).
--   b) Run the two `alter database` statements at the bottom of this file
--      (with your real values) to point the trigger at your deployed
--      function.

alter table public.items add column if not exists low_stock_notified boolean not null default false;

create extension if not exists pg_net;

create or replace function public.check_low_stock_and_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  is_low boolean;
  was_notified boolean;
  hook_url text;
  hook_secret text;
begin
  is_low := new.current_balance <= new.reorder_threshold;
  was_notified := case when tg_op = 'UPDATE' then old.low_stock_notified else false end;

  if is_low and not coalesce(was_notified, false) then
    new.low_stock_notified := true;

    hook_url := current_setting('app.settings.low_stock_webhook_url', true);
    hook_secret := current_setting('app.settings.low_stock_hook_secret', true);

    if hook_url is not null and hook_url <> '' then
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
  elsif not is_low and coalesce(was_notified, false) then
    -- restocked above threshold: reset so the next dip sends a fresh email
    new.low_stock_notified := false;
  end if;

  return new;
end;
$$;
revoke all on function public.check_low_stock_and_notify() from public, anon, authenticated;

drop trigger if exists items_low_stock_notify_ins on public.items;
create trigger items_low_stock_notify_ins
before insert on public.items
for each row execute function public.check_low_stock_and_notify();

drop trigger if exists items_low_stock_notify_upd on public.items;
create trigger items_low_stock_notify_upd
before update on public.items
for each row execute function public.check_low_stock_and_notify();

-- ============================================================================
-- Run these two AFTER you've deployed the Edge Function and have its URL,
-- with your own values (see the setup guide):
--
-- alter database postgres set app.settings.low_stock_webhook_url =
--   'https://<your-project-ref>.supabase.co/functions/v1/low-stock-alert';
-- alter database postgres set app.settings.low_stock_hook_secret =
--   '<a long random string you make up>';
-- ============================================================================
