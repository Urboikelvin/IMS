import { plural } from "@/lib/platform";
import type { PlatformData } from "./usePlatformData";

type Tile = { label: string; value: number; note: string; alert?: boolean };

/** The whole platform at a glance. Counts only, never a client's stock. */
export function OverviewStrip({ data }: { data: PlatformData }) {
  const s = data.summary;
  const tiles: Tile[] = [
    { label: "Clients", value: s.total, note: `${s.active} active${s.suspended ? `, ${s.suspended} suspended` : ""}` },
    { label: "Overdue", value: s.overdue, note: s.overdue ? "subscription has ended" : "none overdue", alert: s.overdue > 0 },
    { label: "Renewing soon", value: s.expiring + s.noDate, note: s.noDate ? `${s.expiring} due, ${s.noDate} with no date` : "in the next 14 days" },
    { label: "Not being used", value: s.dormant, note: s.dormant ? "no stock activity for 30 days" : "everyone is active", alert: s.dormant > 0 },
    { label: "People using KAYA", value: s.people, note: `${plural(s.movements30d, "stock movement")} in 30 days` },
  ];

  return (
    <section aria-label="Platform overview">
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border md:grid-cols-5">
        {tiles.map((tile) => (
          <div key={tile.label} className="bg-surface px-5 py-4">
            <dt className="text-sm text-muted-foreground">{tile.label}</dt>
            <dd className={`mt-1 text-3xl font-bold tabular-nums ${tile.alert ? "text-destructive" : ""}`}>{data.loading ? "—" : tile.value}</dd>
            <p className="mt-0.5 text-xs text-muted-foreground">{data.loading ? "" : tile.note}</p>
          </div>
        ))}
      </dl>
    </section>
  );
}
