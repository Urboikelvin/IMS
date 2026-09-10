-- Audit log: tighten to Head Staff / Super Admin only, matching the
-- "complete transparency for leadership" requirement. The old policy
-- predates the Head Staff role and let any admin-or-above see it — this
-- replaces that with the same head_staff_or_above check used everywhere
-- else in the department model.

drop policy if exists "audit_select" on public.audit_log;
drop policy if exists "audit_select_scoped" on public.audit_log;

create policy "audit_select_scoped" on public.audit_log for select to authenticated
  using (public.is_head_staff_or_above(auth.uid()));

-- Inserts stay as before (anyone can log their own actions) — the app
-- calls this after every create/update/delete/role-change action.
drop policy if exists "audit_insert" on public.audit_log;
create policy "audit_insert" on public.audit_log for insert to authenticated
  with check (user_id = auth.uid());
