-- Postgres requires a new enum value to be committed before it can be
-- referenced in policies/functions, so this is its own migration file.
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'super_admin';
