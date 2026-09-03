import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { RequireRole } from "@/components/RequireRole";
import { DataTable, EmptyRow, Field, Panel, StatCard, TextInput } from "@/components/inventory-ui";
import { downloadCsv, fetchItems, fetchStockIn, fetchStockOut, formatMoney } from "@/lib/inventory";

export const Route = createFileRoute("/reports")({
  head: () => ({
    meta: [
      { title: "Reports • Maslow Inventory" },
      { name: "description", content: "Filter stock movement by date, review usage summaries and export CSV reports." },
      { property: "og:title", content: "Reports • Maslow Inventory" },
      { property: "og:description", content: "Usage summaries and CSV exports for Maslow inventory." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => (
    <RequireRole allow={["admin", "super_admin"]}>
      <ReportsPage />
    </RequireRole>
  ),
});

function isoDaysAgo(days: number) {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

function ReportsPage() {
  const items = useQuery({ queryKey: ["items"], queryFn: fetchItems });
  const stockIn = useQuery({ queryKey: ["stock-in"], queryFn: fetchStockIn });
  const stockOut = useQuery({ queryKey: ["stock-out"], queryFn: fetchStockOut });

  const [from, setFrom] = useState(isoDaysAgo(30));
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));

  const summary = useMemo(() => {
    const list = items.data ?? [];
    const inRange = (date: string) => date >= from && date <= to;
    const ins = (stockIn.data ?? []).filter((m) => inRange(m.date));
    const outs = (stockOut.data ?? []).filter((m) => inRange(m.date));

    const rows = list
      .map((item) => {
        const received = ins.filter((m) => m.item_id === item.id).reduce((s, m) => s + m.quantity, 0);
        const issued = outs.filter((m) => m.item_id === item.id).reduce((s, m) => s + m.quantity, 0);
        return {
          item,
          received,
          issued,
          value: issued * item.unit_price,
        };
      })
      .filter((row) => row.received > 0 || row.issued > 0)
      .sort((a, b) => b.issued - a.issued);

    return {
      rows,
      totalIn: ins.reduce((s, m) => s + m.quantity, 0),
      totalOut: outs.reduce((s, m) => s + m.quantity, 0),
      usageValue: rows.reduce((s, row) => s + row.value, 0),
    };
  }, [items.data, stockIn.data, stockOut.data, from, to]);

  function exportCsv() {
    downloadCsv(`maslow-usage-${from}-to-${to}.csv`, [
      ["Item", "Unit", "Received", "Issued", "Closing balance", "Usage value"],
      ...summary.rows.map((row) => [
        row.item.name,
        row.item.unit,
        row.received,
        row.issued,
        row.item.current_balance,
        row.value.toFixed(2),
      ]),
    ]);
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Reports</h1>
        <p className="mt-1 text-sm text-muted-foreground">Usage summary for the selected period.</p>
      </header>

      <Panel title="Filters">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="From">
            <TextInput type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="To">
            <TextInput type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
          <div className="flex items-end">
            <button
              onClick={exportCsv}
              className="h-11 w-full rounded-lg bg-primary text-xs font-bold uppercase tracking-wider text-primary-foreground"
            >
              Export CSV
            </button>
          </div>
        </div>
      </Panel>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Received" value={summary.totalIn} hint="units in" />
        <StatCard label="Issued" value={summary.totalOut} hint="units out" />
        <StatCard label="Usage value" value={formatMoney(summary.usageValue)} />
      </div>

      <Panel title="Usage by item" padded={false}>
        <DataTable head={["Item", "Received", "Issued", "Balance", "Usage value"]}>
          {summary.rows.length === 0 ? (
            <EmptyRow colSpan={5}>No movement in this period.</EmptyRow>
          ) : (
            summary.rows.map((row) => (
              <tr key={row.item.id}>
                <td className="px-6 py-3 font-medium">{row.item.name}</td>
                <td className="px-6 py-3 font-mono text-success">+{row.received}</td>
                <td className="px-6 py-3 font-mono text-destructive">−{row.issued}</td>
                <td className="px-6 py-3 font-mono">
                  {row.item.current_balance} {row.item.unit}
                </td>
                <td className="px-6 py-3 text-right font-mono text-muted-foreground">{formatMoney(row.value)}</td>
              </tr>
            ))
          )}
        </DataTable>
      </Panel>
    </div>
  );
}
