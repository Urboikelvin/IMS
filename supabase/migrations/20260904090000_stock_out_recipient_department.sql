-- Feature: Stock Out records WHO received it as two separate things —
-- the recipient's DEPARTMENT and the recipient PERSON (the existing
-- `recipient` text column keeps that job, just relabeled in the UI).
--
-- Deliberately a different concept from `items.department_id`: an item's
-- department is which team's inventory pool it's drawn from (enforced by
-- RLS — who's even allowed to touch it). recipient_department_id is just a
-- label for reporting — stock CAN legitimately be issued to a different
-- department than the one that owns the item (a transfer), so this column
-- is never used in any permission check, only for record-keeping.

alter table public.stock_out add column if not exists recipient_department_id uuid references public.departments(id) on delete set null;

-- Backfill: for every existing stock-out record, assume it was issued
-- within the item's own department (the only sensible default we have for
-- historical data — there was no cross-department concept before this).
update public.stock_out so
set recipient_department_id = i.department_id
from public.items i
where so.item_id = i.id and so.recipient_department_id is null;
