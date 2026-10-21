import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { RequirePlatformAdmin } from "@/components/RequirePlatformAdmin";
import { DataTable, EmptyRow, Field, Panel, StatCard, SubmitButton, Tag, TextInput } from "@/components/inventory-ui";
import { errorMessage } from "@/lib/inventory";
import { createOrganizationFn } from "@/integrations/supabase/user-admin";
import { APP_NAME } from "@/lib/brand";

export const Route = createFileRoute("/platform")({
  head: () => ({
    meta: [
      { title: `Clients • ${APP_NAME}` },
      { name: "description", content: "Onboard and manage client organizations." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: () => (
    <RequirePlatformAdmin>
      <PlatformPage />
    </RequirePlatformAdmin>
  ),
});

type OrgRow = {
  id: string;
  name: string;
  status: string;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  subscription_ends_on: string | null;
  notes: string | null;
  created_at: string;
};

const emptyForm = {
  name: "",
  contactName: "",
  contactEmail: "",
  contactPhone: "",
  subscriptionEndsOn: "",
  notes: "",
  adminName: "",
  adminEmail: "",
  adminPassword: "",
};

const today = () => new Date().toISOString().slice(0, 10);

function friendly(error: unknown, fallback: string) {
  const message = errorMessage(error, fallback);
  return message.includes("organizations_name_lower_key") ? "A client with that name already exists." : message;
}

function PlatformPage() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);

  const orgs = useQuery({
    queryKey: ["platform-orgs"],
    queryFn: async (): Promise<OrgRow[]> => {
      const { data, error } = await supabase
        .from("organizations")
        .select("id, name, status, contact_name, contact_email, contact_phone, subscription_ends_on, notes, created_at")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  // Counts and activity only — never any client's inventory contents.
  const overview = useQuery({
    queryKey: ["platform-overview"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("platform_org_overview");
      if (error) throw error;
      return data ?? [];
    },
  });

  const overviewById = new Map((overview.data ?? []).map((row) => [row.org_id, row]));
  const list = orgs.data ?? [];
  const activeCount = list.filter((o) => o.status === "active").length;
  const totalUsers = (overview.data ?? []).reduce((sum, row) => sum + row.user_count, 0);

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ["platform-orgs"] });
    queryClient.invalidateQueries({ queryKey: ["platform-overview"] });
  }

  const createClient = useMutation({
    mutationFn: () =>
      createOrganizationFn({
        data: {
          name: form.name,
          contactName: form.contactName,
          contactEmail: form.contactEmail,
          contactPhone: form.contactPhone,
          subscriptionEndsOn: form.subscriptionEndsOn,
          adminName: form.adminName,
          adminEmail: form.adminEmail,
          adminPassword: form.adminPassword,
        },
      }),
    onSuccess: (result) => {
      toast.success(`${result.name} is set up. Share the sign-in details with ${result.adminEmail}.`);
      setForm(emptyForm);
      refresh();
    },
    onError: (error) => toast.error(friendly(error, "Could not create the client.")),
  });

  const saveClient = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("organizations")
        .update({
          name: form.name.trim(),
          contact_name: form.contactName.trim() || null,
          contact_email: form.contactEmail.trim() || null,
          contact_phone: form.contactPhone.trim() || null,
          subscription_ends_on: form.subscriptionEndsOn || null,
          notes: form.notes.trim() || null,
        })
        .eq("id", editingId as string);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Client updated.");
      setEditingId(null);
      setForm(emptyForm);
      refresh();
    },
    onError: (error) => toast.error(friendly(error, "Could not save changes.")),
  });

  const setStatus = useMutation({
    mutationFn: async ({ org, status }: { org: OrgRow; status: "active" | "suspended" }) => {
      const { error } = await supabase.from("organizations").update({ status }).eq("id", org.id);
      if (error) throw error;
      const { data: userData } = await supabase.auth.getUser();
      if (userData.user) {
        await supabase.from("audit_log").insert({
          user_id: userData.user.id,
          organization_id: org.id,
          action: status === "suspended" ? "organization.suspend" : "organization.reactivate",
          entity: "organizations",
          entity_id: org.id,
          details: { name: org.name } as never,
        });
      }
    },
    onSuccess: (_data, variables) => {
      toast.success(variables.status === "suspended" ? `${variables.org.name} suspended.` : `${variables.org.name} reactivated.`);
      refresh();
    },
    onError: (error) => toast.error(friendly(error, "Could not change status.")),
  });

  function startEdit(org: OrgRow) {
    setEditingId(org.id);
    setForm({
      ...emptyForm,
      name: org.name,
      contactName: org.contact_name ?? "",
      contactEmail: org.contact_email ?? "",
      contactPhone: org.contact_phone ?? "",
      subscriptionEndsOn: org.subscription_ends_on ?? "",
      notes: org.notes ?? "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(emptyForm);
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!form.name.trim()) {
      toast.error("Client name is required.");
      return;
    }
    if (editingId) {
      saveClient.mutate();
      return;
    }
    if (!form.adminEmail.trim()) {
      toast.error("Enter the first administrator's email.");
      return;
    }
    if (form.adminPassword.length < 8) {
      toast.error("The temporary password must be at least 8 characters.");
      return;
    }
    createClient.mutate();
  }

  const busy = createClient.isPending || saveClient.isPending;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Clients</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Onboard centers and manage their access. You can see activity counts here, never their stock data.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Clients" value={list.length} hint={`${activeCount} active`} />
        <StatCard
          label="Suspended"
          value={list.length - activeCount}
          tone={list.length - activeCount > 0 ? "danger" : "default"}
          hint="locked out"
        />
        <StatCard label="People" value={totalUsers} hint="across all clients" />
      </div>

      <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
        <Panel title={editingId ? "Edit client" : "New client"}>
          <form onSubmit={submit} className="flex flex-col gap-4">
            <Field label="Client name">
              <TextInput value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Greenfield Diagnostics" />
            </Field>
            <Field label="Contact person">
              <TextInput value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} placeholder="Optional" />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Contact email">
                <TextInput type="email" value={form.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} placeholder="Optional" />
              </Field>
              <Field label="Contact phone">
                <TextInput value={form.contactPhone} onChange={(e) => setForm({ ...form, contactPhone: e.target.value })} placeholder="Optional" />
              </Field>
            </div>
            <Field label="Subscription ends on">
              <TextInput type="date" value={form.subscriptionEndsOn} onChange={(e) => setForm({ ...form, subscriptionEndsOn: e.target.value })} />
            </Field>

            {editingId ? (
              <Field label="Notes">
                <TextInput value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Reseller, agreement reference…" />
              </Field>
            ) : (
              <>
                <div className="border-t border-border pt-4">
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">First administrator</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Becomes the Super Admin of this client. They add their own departments and staff.
                  </p>
                </div>
                <Field label="Full name">
                  <TextInput value={form.adminName} onChange={(e) => setForm({ ...form, adminName: e.target.value })} placeholder="Jane Doe" />
                </Field>
                <Field label="Email">
                  <TextInput type="email" value={form.adminEmail} onChange={(e) => setForm({ ...form, adminEmail: e.target.value })} autoComplete="off" />
                </Field>
                <Field label="Temporary password">
                  <TextInput
                    type="password"
                    value={form.adminPassword}
                    onChange={(e) => setForm({ ...form, adminPassword: e.target.value })}
                    minLength={8}
                    autoComplete="new-password"
                  />
                </Field>
              </>
            )}

            <SubmitButton disabled={busy}>
              {busy ? "Saving…" : editingId ? "Save Changes" : "Create Client"}
            </SubmitButton>
            {editingId ? (
              <button type="button" onClick={cancelEdit} className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Cancel edit
              </button>
            ) : null}
          </form>
        </Panel>

        <Panel title="All clients" padded={false}>
          <DataTable head={["Client", "Status", "People", "Items", "Moves (30d)", "Renews", ""]}>
            {list.length === 0 ? (
              <EmptyRow colSpan={7}>No clients yet.</EmptyRow>
            ) : (
              list.map((org) => {
                const stats = overviewById.get(org.id);
                const overdue = !!org.subscription_ends_on && org.subscription_ends_on < today() && org.status === "active";
                const suspended = org.status === "suspended";
                return (
                  <tr key={org.id}>
                    <td className="px-6 py-3">
                      <p className="font-medium">{org.name}</p>
                      {org.contact_name || org.contact_email ? (
                        <p className="text-xs text-muted-foreground">
                          {[org.contact_name, org.contact_email].filter(Boolean).join(" • ")}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-6 py-3">
                      <Tag tone={suspended ? "danger" : "in"}>{org.status}</Tag>
                    </td>
                    <td className="px-6 py-3 font-mono">{stats?.user_count ?? "—"}</td>
                    <td className="px-6 py-3 font-mono">{stats?.item_count ?? "—"}</td>
                    <td className="px-6 py-3 font-mono">{stats?.movement_count_30d ?? "—"}</td>
                    <td className="px-6 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs text-muted-foreground">{org.subscription_ends_on ?? "—"}</span>
                        {overdue ? <Tag tone="warn">Overdue</Tag> : null}
                      </div>
                    </td>
                    <td className="px-6 py-3 text-right">
                      <div className="flex justify-end gap-3 text-xs font-semibold uppercase">
                        <button onClick={() => startEdit(org)} className="text-accent">
                          Edit
                        </button>
                        <button
                          onClick={() => {
                            const next = suspended ? "active" : "suspended";
                            const message = suspended
                              ? `Reactivate ${org.name}?`
                              : `Suspend ${org.name}? Everyone there loses access immediately. Their data is kept.`;
                            if (confirm(message)) setStatus.mutate({ org, status: next });
                          }}
                          disabled={setStatus.isPending}
                          className={suspended ? "text-success" : "text-destructive"}
                        >
                          {suspended ? "Reactivate" : "Suspend"}
                        </button>
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
