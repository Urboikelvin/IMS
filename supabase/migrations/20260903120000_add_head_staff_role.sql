-- Departments feature, part 1 of 2. Postgres requires a new enum value to be
-- committed before it can be referenced anywhere else (constraints,
-- policies, functions) — same reason super_admin got its own migration file
-- earlier. Run this ONE STATEMENT first and let it fully commit before
-- running the next migration file.
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'head_staff';
