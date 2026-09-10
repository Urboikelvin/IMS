-- Feature 4: reorder_threshold should default to 10 when not explicitly set,
-- not 0. This only changes the column default for future inserts made
-- without an explicit value (e.g. direct SQL/API inserts) — the app's own
-- "New item" form already sends 10 by default, and every existing item keeps
-- whatever threshold it already has.
alter table public.items alter column reorder_threshold set default 10;
