import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { RequireRole } from "@/components/RequireRole";
import { DataTable, EmptyRow, Field, Panel, SelectInput, SubmitButton, Tag, TextInput } from "@/components/inventory-ui";
import { errorMessage, fetchUsersWithRoles, logAudit, type UserWithRole } from "@/lib/inventory";
import { useDepartments, type AppRole } from "@/hooks/use-session";
import { createUserFn, removeUserFn } from "@/integrations/supabase/user-admin";
import { APP_NAME } from "@/lib/brand";

export const Route = createFileRoute("/users")({
  head: () => ({
    meta: [
      { title: `Users • ${APP_NAME}` },
      { name: "description", content: "Manage staff and admin accounts and their access levels." },
      { property: "og:title", content: `Users • ${APP_NAME}` },
      { property: "og:description", content: "Manage staff and admin accounts." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => (
    // Only Head Staff / Super Admin manage roles now — department admins no
    // longer touch this page at all.
    <RequireRole allow={["super_admin", "head_staff"]}>
      <UsersPage />
    </RequireRole>
  ),
});

const roleTone: Record<AppRole, "in" | "out" | "warn" | "danger"> = {
  super_admin: "danger",
  head_staff: "danger",
  admin: "warn",
  staff: "in",
};

const roleLabel: Record<AppRole, string> = {
  super_admin: "Super Admin",
  head_staff: "Head Staff",
  admin: "Admin",
  staff: "Staff",
};

const ALL_ROLES: AppRole[] = ["staff", "admin", "head_staff", "super_admin"];

function needsDepartment(role: AppRole) {
  return role === "admin" || role === "staff";
}

const emptyForm = { name: "", email: "", password: "", role: "staff" as AppRole, departmentId: "" };

function UsersPage() {
  const queryClient = useQueryClient();
  const departments = useDepartments();
  const { data: currentUser } = useQuery({
    queryKey: ["current-user-id"],
    queryFn: async () => (await supabase.auth.getUser()).data.user?.id ?? null,
  });
  const users = useQuery({ queryKey: ["users"], queryFn: fetchUsersWithRoles });
  const [form, setForm] = useState(emptyForm);

  // Per-row pending edits (role + department) before the admin hits Apply.
  const [rowEdits, setRowEdits] = useState<Record<string, { role: AppRole; departmentId: string }>>({});

  const departmentName = new Map((departments.data ?? []).map((d) => [d.id, d.name]));

  const createUser = useMutation({
    mutationFn: async () => {
      const result = await createUserFn({
        data: { name: form.name, email: form.email, password: form.password, role: form.role, departmentId: form.departmentId || null },
      });
      await logAudit("user.create", "user_roles", result.id, { role: form.role, email: result.email });
    },
    onSuccess: () => {
      toast.success("User created.");
      setForm(emptyForm);
      queryClient.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (error) => toast.error(errorMessage(error, "Could not create user.")),
  });

  const assignRole = useMutation({
    mutationFn: async ({ userId, role, departmentId }: { userId: string; role: AppRole; departmentId: string | null }) => {
      const { error } = await supabase
        .from("user_roles")
        .upsert({ user_id: userId, role, department_id: departmentId }, { onConflict: "user_id" });
      if (error) throw error;
      await logAudit("user.role_change", "user_roles", userId, { role, departmentId });
    },
    onSuccess: (_data, variables) => {
      toast.success("Access updated.");
      setRowEdits((prev) => {
        const next = { ...prev };
        delete next[variables.userId];
        return next;
      });
      queryClient.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (error) => toast.error(errorMessage(error, "Could not update access.")),
  });

  const removeUser = useMutation({
    mutationFn: async (userId: string) => {
      await removeUserFn({ data: { userId } });
      await logAudit("user.remove", "user_roles", userId, null);
    },
    onSuccess: () => {
      toast.success("User removed.");
      queryClient.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (error) => toast.error(errorMessage(error, "Could not remove user.")),
  });

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!form.email.trim()) return toast.error("Email is required.");
    if (form.password.length < 8) return toast.error("Password must be at least 8 characters.");
    if (needsDepartment(form.role) && !form.departmentId) return toast.error("Choose a department for this role.");
    createUser.mutate();
  }

  function editsFor(user: UserWithRole) {
    return rowEdits[user.id] ?? { role: user.role ?? "staff", departmentId: user.department_id ?? "" };
  }

  function setEdit(user: UserWithRole, patch: Partial<{ role: AppRole; departmentId: string }>) {
    const current = editsFor(user);
    const next = { ...current, ...patch };
    if (!needsDepartment(next.role)) next.departmentId = "";
    setRowEdits((prev) => ({ ...prev, [user.id]: next }));
  }

  function apply(user: UserWithRole) {
    const edit = editsFor(user);
    if (needsDepartment(edit.role) && !edit.departmentId) {
      toast.error("Choose a department for this role.");
      return;
    }
    assignRole.mutate({ userId: user.id, role: edit.role, departmentId: needsDepartment(edit.role) ? edit.departmentId : null });
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Users</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Create accounts, assign departments, and manage everyone's access level.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
        <Panel title="New user">
          <form onSubmit={submit} className="flex flex-col gap-4">
            <Field label="Full name">
              <TextInput value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Jane Doe" />
            </Field>
            <Field label="Email">
              <TextInput
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                required
              />
            </Field>
            <Field label="Temporary password">
              <TextInput
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                minLength={8}
                required
              />
            </Field>
            <Field label="Role">
              <SelectInput
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value as AppRole, departmentId: needsDepartment(e.target.value as AppRole) ? form.departmentId : "" })}
              >
                {ALL_ROLES.map((role) => (
                  <option key={role} value={role}>
                    {roleLabel[role]}
                  </option>
                ))}
              </SelectInput>
            </Field>
            {needsDepartment(form.role) ? (
              <Field label="Department">
                <SelectInput value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value })}>
                  <option value="">Choose department…</option>
                  {(departments.data ?? []).map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </SelectInput>
              </Field>
            ) : null}
            <SubmitButton disabled={createUser.isPending}>
              {createUser.isPending ? "Creating…" : "Create User"}
            </SubmitButton>
          </form>
        </Panel>

        <Panel title="All users" padded={false}>
          <DataTable head={["Name", "Email", "Role", "Department", ""]}>
            {(users.data ?? []).length === 0 ? (
              <EmptyRow colSpan={5}>No users yet.</EmptyRow>
            ) : (
              (users.data ?? []).map((user) => {
                const edit = editsFor(user);
                const dirty = rowEdits[user.id] !== undefined;
                const isSelf = user.id === currentUser;
                return (
                  <tr key={user.id}>
                    <td className="px-6 py-3 font-medium">
                      {user.name || "—"}
                      {isSelf ? <span className="ml-2 text-xs text-muted-foreground">(you)</span> : null}
                    </td>
                    <td className="px-6 py-3 text-muted-foreground">{user.email}</td>
                    <td className="px-6 py-3">
                      {isSelf ? (
                        <Tag tone={user.role ? roleTone[user.role] : "warn"}>{user.role ? roleLabel[user.role] : "Pending"}</Tag>
                      ) : (
                        <SelectInput
                          value={edit.role}
                          onChange={(e) => setEdit(user, { role: e.target.value as AppRole })}
                          className="h-9 w-auto"
                        >
                          {ALL_ROLES.map((role) => (
                            <option key={role} value={role}>
                              {roleLabel[role]}
                            </option>
                          ))}
                        </SelectInput>
                      )}
                      {!user.role && !isSelf ? <p className="mt-1 text-xs text-warning-strong">Pending — no access yet</p> : null}
                    </td>
                    <td className="px-6 py-3">
                      {isSelf ? (
                        <span className="text-muted-foreground">{user.department_id ? departmentName.get(user.department_id) ?? "—" : "—"}</span>
                      ) : needsDepartment(edit.role) ? (
                        <SelectInput
                          value={edit.departmentId}
                          onChange={(e) => setEdit(user, { departmentId: e.target.value })}
                          className="h-9 w-auto"
                        >
                          <option value="">Choose…</option>
                          {(departments.data ?? []).map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.name}
                            </option>
                          ))}
                        </SelectInput>
                      ) : (
                        <span className="text-muted-foreground">Company-wide</span>
                      )}
                    </td>
                    <td className="px-6 py-3 text-right">
                      <div className="flex justify-end gap-3 text-xs font-semibold uppercase">
                        {!isSelf && dirty ? (
                          <button onClick={() => apply(user)} disabled={assignRole.isPending} className="text-accent disabled:opacity-50">
                            Apply
                          </button>
                        ) : null}
                        {!isSelf && user.role ? (
                          <button
                            onClick={() => {
                              if (confirm(`Remove ${user.name || user.email}? They will lose access immediately.`)) {
                                removeUser.mutate(user.id);
                              }
                            }}
                            disabled={removeUser.isPending}
                            className="text-destructive disabled:opacity-50"
                          >
                            Remove
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </DataTable>
        </Panel>
      </div>
    </div>
  );
}
