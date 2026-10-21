import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { RequireRole } from "@/components/RequireRole";
import { DataTable, EmptyRow, Field, Panel, SelectInput, TextInput } from "@/components/inventory-ui";
import { fetchAuditLog, fetchProfiles } from "@/lib/inventory";
import { APP_NAME } from "@/lib/brand";

export const Route = createFileRoute("/audit")({
  head: () => ({
    meta: [
      { title: `Audit Log • ${APP_NAME}` },
      { name: "description", content: "Every action taken across the platform, for Head Staff and Super Admin." },
      { property: "og:title", content: `Audit Log • ${APP_NAME}` },
      { property: "og:description", content: "Full transparency into every change made across your inventory." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => (
    <RequireRole allow={["super_admin", "head_staff"]}>
      <AuditPage />
    </RequireRole>
  ),
});

const ACTION_LABEL: Record<string, string> = {
  "item.create": "Created item",
  "item.update": "Edited item",
  "item.delete": "Deleted item",
  "category.create": "Added category",
  "stock_in.create": "Logged Stock In",
  "stock_out.create": "Logged Stock Out",
  "user.create": "Created user",
  "user.role_change": "Changed access",
  "user.remove": "Removed user",
  "department.create": "Added department",
  "department.rename": "Renamed department",
  "department.delete": "Deleted department",
  "organization.create": "Organization created",
  "organization.suspend": "Access suspended",
  "organization.reactivate": "Access restored",
};

function actionTone(action: string) {
  if (action.endsWith(".delete") || action === "user.remove") return "text-destructive";
  if (action.endsWith(".create")) return "text-success";
  return "text-foreground";
}

function summarizeDetails(details: unknown): string {
  if (!details || typeof details !== "object") return "";
  const d = details as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of ["name", "role", "quantity", "item_id", "email"]) {
    if (d[key] !== undefined && d[key] !== null) parts.push(`${key}: ${String(d[key])}`);
  }
  return parts.join(" • ");
}

function AuditPage() {
  const log = useQuery({ queryKey: ["audit-log"], queryFn: () => fetchAuditLog(300) });
  const profiles = useQuery({ queryKey: ["profiles"], queryFn: fetchProfiles });
  const profileName = new Map((profiles.data ?? []).map((p) => [p.id, p.name || p.email]));

  const [actionFilter, setActionFilter] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const actions = useMemo(() => Array.from(new Set((log.data ?? []).map((e) => e.action))).sort(), [log.data]);

  const filtered = useMemo(() => {
    return (log.data ?? []).filter((entry) => {
      if (actionFilter && entry.action !== actionFilter) return false;
      const date = entry.created_at.slice(0, 10);
      if (from && date < from) return false;
      if (to && date > to) return false;
      return true;
    });
  }, [log.data, actionFilter, from, to]);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Audit Log</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every action taken across the platform — the most recent {log.data?.length ?? 0} entries.
        </p>
      </header>

      <Panel title="Filters">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Action">
            <SelectInput value={actionFilter} onChange={(e) => setActionFilter(e.target.value)}>
              <option value="">All actions</option>
              {actions.map((a) => (
                <option key={a} value={a}>
                  {ACTION_LABEL[a] ?? a}
                </option>
              ))}
            </SelectInput>
          </Field>
          <Field label="From">
            <TextInput type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="To">
            <TextInput type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>
      </Panel>

      <Panel title="Activity" padded={false}>
        <DataTable head={["When", "Who", "Action", "Details"]}>
          {filtered.length === 0 ? (
            <EmptyRow colSpan={4}>No activity matches these filters.</EmptyRow>
          ) : (
            filtered.map((entry) => (
              <tr key={entry.id}>
                <td className="whitespace-nowrap px-6 py-3 font-mono text-xs text-muted-foreground">
                  {new Date(entry.created_at).toLocaleString()}
                </td>
                <td className="px-6 py-3">{entry.user_id ? profileName.get(entry.user_id) ?? "—" : "System"}</td>
                <td className={`px-6 py-3 font-medium ${actionTone(entry.action)}`}>
                  {ACTION_LABEL[entry.action] ?? entry.action}
                </td>
                <td className="px-6 py-3 text-xs text-muted-foreground">{summarizeDetails(entry.details)}</td>
              </tr>
            ))
          )}
        </DataTable>
      </Panel>
    </div>
  );
}
