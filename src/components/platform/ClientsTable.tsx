import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { formatDay, formatNaira, plural, relativeTime, subscriptionHealth, usageSignal } from "@/lib/platform";
import { StatusPill, ThinBar } from "./ui";
import type { PlatformData } from "./usePlatformData";

type Filter = "all" | "attention" | "active" | "suspended";

export function ClientsTable({ data, onOpen }: { data: PlatformData; onOpen: (orgId: string) => void }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

  const rows = useMemo(() => {
    const attentionIds = new Set(data.attention.map((a) => a.org.id));
    return data.orgList.map((org) => ({
      org,
      health: subscriptionHealth(org),
      usage: usageSignal(org, data.overviewByOrg.get(org.id)),
      stats: data.overviewByOrg.get(org.id),
      fee: data.billingByOrg.get(org.id)?.monthly_fee ?? 0,
      plan: data.billingByOrg.get(org.id)?.plan_name ?? null,
      needsAttention: attentionIds.has(org.id),
    }));
  }, [data.orgList, data.attention, data.overviewByOrg, data.billingByOrg]);

  const counts = {
    all: rows.length,
    attention: rows.filter((r) => r.needsAttention).length,
    active: rows.filter((r) => r.org.status === "active").length,
    suspended: rows.filter((r) => r.org.status === "suspended").length,
  };

  const needle = query.trim().toLowerCase();
  const visible = rows.filter((r) => {
    if (filter === "attention" && !r.needsAttention) return false;
    if (filter === "active" && r.org.status !== "active") return false;
    if (filter === "suspended" && r.org.status !== "suspended") return false;
    if (!needle) return true;
    return [r.org.name, r.org.contact_name, r.org.contact_email].some((v) => v?.toLowerCase().includes(needle));
  });

  const filters: { key: Filter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "attention", label: "Needs attention" },
    { key: "active", label: "Active" },
    { key: "suspended", label: "Suspended" },
  ];

  return (
    <section className="panel overflow-hidden" aria-labelledby="clients-heading">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-6 py-4">
        <h2 id="clients-heading" className="text-base font-bold">
          Clients <span className="ml-1 font-normal text-muted-foreground">{counts.all}</span>
        </h2>
        <div className="relative w-full sm:w-64">
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search clients"
            aria-label="Search clients"
            className="h-10 w-full rounded-lg border border-border bg-secondary pl-9 pr-3 text-sm outline-none transition-colors focus:border-accent"
          />
        </div>
      </div>

      <div role="group" aria-label="Filter clients" className="flex flex-wrap gap-2 border-b border-border px-6 py-3">
        {filters.map((f) => (
          <button
            key={f.key}
            type="button"
            aria-pressed={filter === f.key}
            onClick={() => setFilter(f.key)}
            className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${
              filter === f.key ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground hover:text-foreground"
            }`}
          >
            {f.label} <span className="tabular-nums opacity-70">{counts[f.key]}</span>
          </button>
        ))}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead>
            <tr className="border-b border-border text-xs font-medium text-muted-foreground">
              <th scope="col" className="px-6 py-3">Client</th>
              <th scope="col" className="px-4 py-3">Subscription</th>
              <th scope="col" className="px-4 py-3">Monthly fee</th>
              <th scope="col" className="px-6 py-3">Usage</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {data.loading ? (
              <tr><td colSpan={4} className="px-6 py-10 text-center text-muted-foreground">Loading clients…</td></tr>
            ) : data.loadError ? (
              <tr><td colSpan={4} className="px-6 py-10 text-center text-destructive">{data.loadError}</td></tr>
            ) : visible.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-6 py-10 text-center text-muted-foreground">
                  {rows.length === 0 ? "No clients yet. Use New client to onboard your first one." : "No clients match."}
                </td>
              </tr>
            ) : (
              visible.map(({ org, health, usage, stats, fee, plan }) => (
                <tr key={org.id} onClick={() => onOpen(org.id)} className="cursor-pointer align-top transition-colors hover:bg-secondary/60">
                  <td className="px-6 py-4">
                    <button
                      type="button"
                      className="text-left font-semibold hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    >
                      {org.name}
                    </button>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {[org.contact_name, plan].filter(Boolean).join(" · ") || "No contact added"}
                    </p>
                  </td>
                  <td className="px-4 py-4">
                    <StatusPill tone={health.tone}>{health.label}</StatusPill>
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      {health.key === "suspended" || health.key === "no_date"
                        ? health.detail
                        : `${health.detail} · ends ${formatDay(org.subscription_ends_on)}`}
                    </p>
                    {health.daysLeft !== null && health.daysLeft >= 0 && health.key !== "suspended" ? (
                      <div className="mt-2 w-40">
                        <ThinBar fraction={health.daysLeft / 30} tone={health.tone} />
                      </div>
                    ) : null}
                  </td>
                  <td className="px-4 py-4 font-medium tabular-nums">
                    {fee > 0 ? formatNaira(fee) : <span className="font-normal text-muted-foreground">Not set</span>}
                  </td>
                  <td className="px-6 py-4">
                    <span className={`font-medium ${usage.tone === "warn" ? "text-warning-strong" : ""}`}>{usage.label}</span>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {plural(stats?.user_count ?? 0, "person").replace("persons", "people")} · {plural(stats?.item_count ?? 0, "item")} ·
                      last active {relativeTime(stats?.last_activity ?? null)}
                    </p>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
