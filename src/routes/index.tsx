import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { RequireAuth } from "@/components/RequireAuth";
import { DataTable, EmptyRow, Panel, StatCard, Tag } from "@/components/inventory-ui";
import {
  expiryStatus,
  fetchItems,
  fetchStockIn,
  fetchStockOut,
  formatMoney,
  isLowStock,
  type Item,
} from "@/lib/inventory";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dashboard • Maslow Inventory" },
      { name: "description", content: "Real-time stock levels, low-stock alerts and recent movements for Maslow." },
      { property: "og:title", content: "Dashboard • Maslow Inventory" },
      { property: "og:description", content: "Real-time stock levels and recent movements for Maslow." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => (
    <RequireAuth>
      <Dashboard />
    </RequireAuth>
  ),
});

function Dashboard() {
  const items = useQuery({ queryKey: ["items"], queryFn: fetchItems });
  const stockIn = useQuery({ queryKey: ["stock-in"], queryFn: fetchStockIn });
  const stockOut = useQuery({ queryKey: ["stock-out"], queryFn: fetchStockOut });

  const list: Item[] = items.data ?? [];
  const byId = new Map(list.map((item) => [item.id, item]));
  const lowStock = list.filter(isLowStock);
  const expiring = list.filter((item) => expiryStatus(item) !== "none");
  const stockValue = list.reduce((sum, item) => sum + item.current_balance * item.unit_price, 0);

  const activity = [
    ...(stockIn.data ?? []).map((movement) => ({ ...movement, type: "in" as const })),
    ...(stockOut.data ?? []).map((movement) => ({ ...movement, type: "out" as const })),
  ]
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.created_at.localeCompare(a.created_at)))
    .slice(0, 8);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">Live view of stock levels and daily movement.</p>
      </header>

      {lowStock.length > 0 ? (
        <div className="flex items-start gap-3 rounded-xl border border-danger-border bg-danger-surface px-5 py-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-danger-strong" />
          <div className="flex-1">
            <p className="font-bold text-danger-strong">
              {lowStock.length} item{lowStock.length === 1 ? "" : "s"} at or below reorder threshold
            </p>
            <p className="mt-0.5 text-sm text-danger-strong/80">
              {lowStock
                .slice(0, 3)
                .map((item) => item.name)
                .join(", ")}
              {lowStock.length > 3 ? `, and ${lowStock.length - 3} more` : ""} — restock soon to avoid running out.
            </p>
          </div>
          <a href="#low-stock-alerts" className="shrink-0 text-xs font-bold uppercase tracking-wider text-danger-strong underline">
            View list
          </a>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total items" value={list.length} hint="tracked SKUs" />
        <StatCard label="Stock value" value={formatMoney(stockValue)} />
        <StatCard label="Low stock" value={lowStock.length} hint="at/below reorder" tone={lowStock.length ? "danger" : "default"} />
        <StatCard label="Expiry watch" value={expiring.length} hint="60 days" />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Panel
          title="Recent activity"
          padded={false}
          action={
            <Link to="/reports" className="text-xs font-semibold uppercase tracking-wider text-accent">
              Reports
            </Link>
          }
        >
          <DataTable head={["Item", "Type", "Date", "Qty"]}>
            {activity.length === 0 ? (
              <EmptyRow colSpan={4}>No movements logged yet.</EmptyRow>
            ) : (
              activity.map((movement) => (
                <tr key={`${movement.type}-${movement.id}`}>
                  <td className="px-6 py-3 font-medium">{byId.get(movement.item_id)?.name ?? "—"}</td>
                  <td className="px-6 py-3">
                    <Tag tone={movement.type === "in" ? "in" : "out"}>{movement.type === "in" ? "In" : "Out"}</Tag>
                  </td>
                  <td className="px-6 py-3 font-mono text-xs text-muted-foreground">{movement.date}</td>
                  <td className="px-6 py-3 text-right font-mono">
                    {movement.type === "in" ? "+" : "−"}
                    {movement.quantity}
                  </td>
                </tr>
              ))
            )}
          </DataTable>
        </Panel>

        <Panel
          title="Low stock alerts"
          padded={false}
          action={lowStock.length > 0 ? <Tag tone="danger">{lowStock.length} low</Tag> : null}
        >
          <div id="low-stock-alerts" className="scroll-mt-6">
            <DataTable head={["Item", "Balance"]}>
              {lowStock.length === 0 ? (
                <EmptyRow colSpan={2}>Everything is above its reorder threshold.</EmptyRow>
              ) : (
                lowStock.map((item) => (
                  <tr key={item.id} className="bg-danger-surface/60">
                    <td className="px-6 py-3">
                      <div className="flex items-center gap-2">
                        <p className="font-medium">{item.name}</p>
                        <Tag tone="danger">Low</Tag>
                      </div>
                      <p className="text-xs text-muted-foreground">Reorder at {item.reorder_threshold} {item.unit}</p>
                    </td>
                    <td className="px-6 py-3 text-right font-mono font-bold text-danger-strong">{item.current_balance}</td>
                  </tr>
                ))
              )}
            </DataTable>
          </div>
        </Panel>
      </div>
    </div>
  );
}
