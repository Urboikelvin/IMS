import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { RequireRole } from "@/components/RequireRole";
import { DataTable, EmptyRow, Field, Panel, SelectInput, SubmitButton, Tag, TextInput } from "@/components/inventory-ui";
import { fetchUsersWithRoles, logAudit, type UserWithRole } from "@/lib/inventory";
import { useRole, type AppRole } from "@/hooks/use-session";
import { createUserFn, removeUserFn } from "@/integrations/supabase/user-admin";

export const Route = createFileRoute("/users")({
  head: () => ({
    meta: [
      { title: "Users • Maslow Inventory" },
      { name: "description", content: "Manage staff and admin accounts and their access levels." },
      { property: "og:title", content: "Users • Maslow Inventory" },
      { property: "og:description", content: "Manage staff and admin accounts for Maslow." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => (
    <RequireRole allow={["admin", "super_admin"]}>
      <UsersPage />
    </RequireRole>
  ),
});

const roleTone: Record<AppRole, "in" | "out" | "warn" | "danger"> = {
  super_admin: "danger",
  admin: "warn",
  staff: "in",
};

const roleLabel: Record<AppRole, string> = {
  super_admin: "Super Admin",
  admin: "Admin",
  staff: "Staff",
};

const emptyForm = { name: "", email: "", password: "", role: "staff" as AppRole };

function UsersPage() {
  const queryClient = useQueryClient();
  const { isSuperAdmin } = useRole();
  const { data: currentUser } = useQuery({
    queryKey: ["current-user-id"],
    queryFn: async () => (await supabase.auth.getUser()).data.user?.id ?? null,
  });
  const users = useQuery({ queryKey: ["users"], queryFn: fetchUsersWithRoles });
  const [form, setForm] = useState(emptyForm);

  // A plain admin can only ever hand out the staff role.
  const roleOptions: AppRole[] = isSuperAdmin ? ["staff", "admin", "super_admin"] : ["staff"];

  const createUser = useMutation({
    mutationFn: async () => {
      const result = await createUserFn({ data: form });
      await logAudit("user.create", "user_roles", result.id, { role: form.role, email: result.email });
    },
    onSuccess: () => {
      toast.success("User created.");
      setForm(emptyForm);
      queryClient.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not create user."),
  });

  const changeRole = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: AppRole }) => {
      const { error } = await supabase.from("user_roles").update({ role }).eq("user_id", userId);
      if (error) throw error;
      await logAudit("user.role_change", "user_roles", userId, { role });
    },
    onSuccess: () => {
      toast.success("Role updated.");
      queryClient.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not update role."),
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
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not remove user."),
  });

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!form.email.trim()) return toast.error("Email is required.");
    if (form.password.length < 6) return toast.error("Password must be at least 6 characters.");
    createUser.mutate();
  }

  // Can the viewer touch this particular row? Super admins can touch anyone
  // but themselves; plain admins can only touch staff rows.
  function canManage(target: UserWithRole) {
    if (target.id === currentUser) return false;
    if (isSuperAdmin) return true;
    return target.role === "staff";
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Users</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {isSuperAdmin
            ? "Create accounts and manage everyone's access level."
            : "Create and remove staff accounts. Only a super admin can create or change admin accounts."}
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
                minLength={6}
                required
              />
            </Field>
            <Field label="Role">
              <SelectInput
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value as AppRole })}
                disabled={roleOptions.length === 1}
              >
                {roleOptions.map((role) => (
                  <option key={role} value={role}>
                    {roleLabel[role]}
                  </option>
                ))}
              </SelectInput>
              {!isSuperAdmin ? (
                <p className="text-xs text-muted-foreground">Only a super admin can create admin accounts.</p>
              ) : null}
            </Field>
            <SubmitButton disabled={createUser.isPending}>
              {createUser.isPending ? "Creating…" : "Create User"}
            </SubmitButton>
          </form>
        </Panel>

        <Panel title="All users" padded={false}>
          <DataTable head={["Name", "Email", "Role", ""]}>
            {(users.data ?? []).length === 0 ? (
              <EmptyRow colSpan={4}>No users yet.</EmptyRow>
            ) : (
              (users.data ?? []).map((user) => (
                <tr key={user.id}>
                  <td className="px-6 py-3 font-medium">
                    {user.name || "—"}
                    {user.id === currentUser ? <span className="ml-2 text-xs text-muted-foreground">(you)</span> : null}
                  </td>
                  <td className="px-6 py-3 text-muted-foreground">{user.email}</td>
                  <td className="px-6 py-3">
                    {isSuperAdmin && user.id !== currentUser ? (
                      <SelectInput
                        value={user.role}
                        onChange={(e) => changeRole.mutate({ userId: user.id, role: e.target.value as AppRole })}
                        disabled={changeRole.isPending}
                        className="h-9 w-auto"
                      >
                        {(["staff", "admin", "super_admin"] as AppRole[]).map((role) => (
                          <option key={role} value={role}>
                            {roleLabel[role]}
                          </option>
                        ))}
                      </SelectInput>
                    ) : (
                      <Tag tone={roleTone[user.role]}>{roleLabel[user.role]}</Tag>
                    )}
                  </td>
                  <td className="px-6 py-3 text-right">
                    {canManage(user) ? (
                      <button
                        onClick={() => {
                          if (confirm(`Remove ${user.name || user.email}? They will lose access immediately.`)) {
                            removeUser.mutate(user.id);
                          }
                        }}
                        disabled={removeUser.isPending}
                        className="text-xs font-semibold uppercase text-destructive disabled:opacity-50"
                      >
                        Remove
                      </button>
                    ) : user.id !== currentUser ? (
                      <span className="text-xs text-muted-foreground">Super admin only</span>
                    ) : null}
                  </td>
                </tr>
              ))
            )}
          </DataTable>
        </Panel>
      </div>
    </div>
  );
}
