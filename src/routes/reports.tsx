import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import ExcelJS from "exceljs";
import { toast } from "sonner";
import { RequireRole } from "@/components/RequireRole";
import { DataTable, EmptyRow, Field, Panel, StatCard, TextInput } from "@/components/inventory-ui";
import {
  errorMessage,
  fetchActiveBatches,
  fetchCategories,
  fetchItems,
  fetchProfiles,
  fetchStockIn,
  fetchStockOut,
  formatMoney,
  isLowStock,
  type Movement,
} from "@/lib/inventory";
import { useDepartments } from "@/hooks/use-session";

export const Route = createFileRoute("/reports")({
  head: () => ({
    meta: [
      { title: "Reports • Maslow Inventory" },
      { name: "description", content: "Filter stock movement by date, review usage summaries and export a full Excel report." },
      { property: "og:title", content: "Reports • Maslow Inventory" },
      { property: "og:description", content: "Usage summaries and Excel exports for Maslow inventory." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => (
    <RequireRole allow={["admin", "head_staff", "super_admin"]}>
      <ReportsPage />
    </RequireRole>
  ),
});

const NAVY = "FF0F172A";
const WHITE = "FFFFFFFF";
const LOW_FILL = "FFFEE2E2";
const HEADER_FONT = { bold: true, color: { argb: WHITE } } as const;
const HEADER_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } } as const;

function styleHeaderRow(row: ExcelJS.Row) {
  row.eachCell((cell) => {
    cell.font = HEADER_FONT;
    cell.fill = HEADER_FILL as ExcelJS.Fill;
    cell.alignment = { vertical: "middle" };
  });
  row.height = 20;
}

function isoDaysAgo(days: number) {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

function ReportsPage() {
  const items = useQuery({ queryKey: ["items"], queryFn: fetchItems });
  const categories = useQuery({ queryKey: ["categories"], queryFn: fetchCategories });
  const departments = useDepartments();
  const profiles = useQuery({ queryKey: ["profiles"], queryFn: fetchProfiles });
  const stockIn = useQuery({ queryKey: ["stock-in"], queryFn: fetchStockIn });
  const stockOut = useQuery({ queryKey: ["stock-out"], queryFn: fetchStockOut });
  const batches = useQuery({ queryKey: ["active-batches"], queryFn: fetchActiveBatches });

  const [from, setFrom] = useState(isoDaysAgo(30));
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [exporting, setExporting] = useState(false);

  const itemById = new Map((items.data ?? []).map((i) => [i.id, i]));
  const categoryName = new Map((categories.data ?? []).map((c) => [c.id, c.name]));
  const departmentName = new Map((departments.data ?? []).map((d) => [d.id, d.name]));
  const profileName = new Map((profiles.data ?? []).map((p) => [p.id, p.name || p.email]));

  const inRange = (date: string) => date >= from && date <= to;
  const insInRange = useMemo(() => (stockIn.data ?? []).filter((m) => inRange(m.date)), [stockIn.data, from, to]);
  const outsInRange = useMemo(() => (stockOut.data ?? []).filter((m) => inRange(m.date)), [stockOut.data, from, to]);

  const summary = useMemo(() => {
    const list = items.data ?? [];
    const rows = list
      .map((item) => {
        const received = insInRange.filter((m) => m.item_id === item.id).reduce((s, m) => s + m.quantity, 0);
        const issued = outsInRange.filter((m) => m.item_id === item.id).reduce((s, m) => s + m.quantity, 0);
        return { item, received, issued, value: issued * item.unit_price };
      })
      .filter((row) => row.received > 0 || row.issued > 0)
      .sort((a, b) => b.issued - a.issued);

    return {
      rows,
      totalIn: insInRange.reduce((s, m) => s + m.quantity, 0),
      totalOut: outsInRange.reduce((s, m) => s + m.quantity, 0),
      usageValue: rows.reduce((s, row) => s + row.value, 0),
    };
  }, [items.data, insInRange, outsInRange]);

  async function exportExcel() {
    setExporting(true);
    try {
      const wb = new ExcelJS.Workbook();
      wb.creator = "Maslow Inventory Hub";
      wb.created = new Date();

      // --- Sheet 1: Summary ---
      const summarySheet = wb.addWorksheet("Summary", { views: [{ state: "frozen", ySplit: 1 }] });
      summarySheet.columns = [
        { header: "Item", key: "item", width: 26 },
        { header: "Category", key: "category", width: 18 },
        { header: "Department", key: "department", width: 16 },
        { header: "Unit", key: "unit", width: 10 },
        { header: "Received", key: "received", width: 12 },
        { header: "Issued", key: "issued", width: 12 },
        { header: "Closing Balance", key: "balance", width: 16 },
        { header: "Usage Value", key: "value", width: 16 },
      ];
      for (const row of summary.rows) {
        const added = summarySheet.addRow({
          item: row.item.name,
          category: row.item.category_id ? categoryName.get(row.item.category_id) ?? "" : "",
          department: departmentName.get(row.item.department_id) ?? "",
          unit: row.item.unit,
          received: row.received,
          issued: row.issued,
          balance: row.item.current_balance,
          value: Number(row.value.toFixed(2)),
        });
        added.getCell("value").numFmt = "#,##0.00";
        if (isLowStock(row.item)) {
          added.eachCell((cell) => {
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LOW_FILL } };
          });
        }
      }
      styleHeaderRow(summarySheet.getRow(1));
      summarySheet.addRow({});
      const totalsRow = summarySheet.addRow({
        item: "TOTAL",
        received: summary.totalIn,
        issued: summary.totalOut,
        value: Number(summary.usageValue.toFixed(2)),
      });
      totalsRow.font = { bold: true };
      totalsRow.getCell("value").numFmt = "#,##0.00";

      // --- Sheet 2: Daily Breakdown ---
      const dailySheet = wb.addWorksheet("Daily Breakdown", { views: [{ state: "frozen", ySplit: 1 }] });
      dailySheet.columns = [
        { header: "Date", key: "date", width: 14 },
        { header: "Item", key: "item", width: 26 },
        { header: "Received", key: "received", width: 12 },
        { header: "Issued", key: "issued", width: 12 },
      ];
      const dailyMap = new Map<string, { date: string; item: string; received: number; issued: number }>();
      for (const m of insInRange) {
        const item = itemById.get(m.item_id);
        const key = `${m.date}__${m.item_id}`;
        const row = dailyMap.get(key) ?? { date: m.date, item: item?.name ?? "—", received: 0, issued: 0 };
        row.received += m.quantity;
        dailyMap.set(key, row);
      }
      for (const m of outsInRange) {
        const item = itemById.get(m.item_id);
        const key = `${m.date}__${m.item_id}`;
        const row = dailyMap.get(key) ?? { date: m.date, item: item?.name ?? "—", received: 0, issued: 0 };
        row.issued += m.quantity;
        dailyMap.set(key, row);
      }
      Array.from(dailyMap.values())
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.item.localeCompare(b.item)))
        .forEach((r) => dailySheet.addRow(r));
      styleHeaderRow(dailySheet.getRow(1));

      // --- Sheet 3: Full Log ---
      const logSheet = wb.addWorksheet("Full Log", { views: [{ state: "frozen", ySplit: 1 }] });
      logSheet.columns = [
        { header: "Date", key: "date", width: 14 },
        { header: "Type", key: "type", width: 8 },
        { header: "Item", key: "item", width: 26 },
        { header: "Category", key: "category", width: 16 },
        { header: "Department", key: "department", width: 16 },
        { header: "Quantity", key: "quantity", width: 12 },
        { header: "Supplier / Recipient Dept", key: "counterparty", width: 22 },
        { header: "Recipient Person", key: "person", width: 18 },
        { header: "Notes", key: "notes", width: 24 },
        { header: "Logged By", key: "loggedBy", width: 18 },
      ];
      const describeMovement = (m: Movement, type: "IN" | "OUT") => {
        const item = itemById.get(m.item_id);
        return {
          date: m.date,
          type,
          item: item?.name ?? "—",
          category: item?.category_id ? categoryName.get(item.category_id) ?? "" : "",
          department: item ? departmentName.get(item.department_id) ?? "" : "",
          quantity: type === "IN" ? m.quantity : -m.quantity,
          counterparty:
            type === "IN" ? m.supplier ?? "" : m.recipient_department_id ? departmentName.get(m.recipient_department_id) ?? "" : "",
          person: type === "OUT" ? m.recipient ?? "" : "",
          notes: m.notes ?? "",
          loggedBy: m.logged_by ? profileName.get(m.logged_by) ?? "" : "",
        };
      };
      [...insInRange.map((m) => describeMovement(m, "IN")), ...outsInRange.map((m) => describeMovement(m, "OUT"))]
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
        .forEach((row) => {
          const added = logSheet.addRow(row);
          if (row.type === "OUT") {
            added.getCell("type").font = { color: { argb: "FFDC2626" } };
          } else {
            added.getCell("type").font = { color: { argb: "FF16A34A" } };
          }
        });
      styleHeaderRow(logSheet.getRow(1));

      // --- Sheet 4: Department Comparison ---
      const deptSheet = wb.addWorksheet("Department Comparison", { views: [{ state: "frozen", ySplit: 1 }] });
      deptSheet.columns = [
        { header: "Department", key: "department", width: 20 },
        { header: "Items Tracked", key: "itemCount", width: 14 },
        { header: "Received", key: "received", width: 12 },
        { header: "Issued", key: "issued", width: 12 },
        { header: "Usage Value", key: "value", width: 16 },
        { header: "Low Stock Items", key: "lowCount", width: 16 },
      ];
      for (const dept of departments.data ?? []) {
        const deptItems = (items.data ?? []).filter((i) => i.department_id === dept.id);
        const deptItemIds = new Set(deptItems.map((i) => i.id));
        const received = insInRange.filter((m) => deptItemIds.has(m.item_id)).reduce((s, m) => s + m.quantity, 0);
        const issued = outsInRange.filter((m) => deptItemIds.has(m.item_id)).reduce((s, m) => s + m.quantity, 0);
        const value = deptItems.reduce((s, item) => {
          const itemIssued = outsInRange.filter((m) => m.item_id === item.id).reduce((sum, m) => sum + m.quantity, 0);
          return s + itemIssued * item.unit_price;
        }, 0);
        const lowCount = deptItems.filter(isLowStock).length;
        if (deptItems.length === 0) continue;
        const added = deptSheet.addRow({
          department: dept.name,
          itemCount: deptItems.length,
          received,
          issued,
          value: Number(value.toFixed(2)),
          lowCount,
        });
        added.getCell("value").numFmt = "#,##0.00";
        if (lowCount > 0) {
          added.getCell("lowCount").font = { bold: true, color: { argb: "FFDC2626" } };
        }
      }
      styleHeaderRow(deptSheet.getRow(1));

      // --- Sheet 5: Batch Snapshot (as of export time, not date-range scoped) ---
      const batchSheet = wb.addWorksheet("Batch Snapshot", { views: [{ state: "frozen", ySplit: 1 }] });
      batchSheet.columns = [
        { header: "Item", key: "item", width: 26 },
        { header: "Department", key: "department", width: 16 },
        { header: "Received Date", key: "date", width: 14 },
        { header: "Expiry Date", key: "expiry", width: 14 },
        { header: "Remaining Qty", key: "remaining", width: 14 },
      ];
      [...(batches.data ?? [])]
        .sort((a, b) => (a.expiry_date ?? "9999-99-99").localeCompare(b.expiry_date ?? "9999-99-99"))
        .forEach((batch) => {
          const item = itemById.get(batch.item_id);
          const added = batchSheet.addRow({
            item: item?.name ?? "—",
            department: item ? departmentName.get(item.department_id) ?? "" : "",
            date: batch.date,
            expiry: batch.expiry_date ?? "No expiry",
            remaining: batch.remaining_quantity,
          });
          if (item && isLowStock(item)) {
            added.getCell("item").font = { color: { argb: "FFDC2626" } };
          }
        });
      styleHeaderRow(batchSheet.getRow(1));

      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `maslow-report-${from}_to_${to}.xlsx`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(errorMessage(error, "Could not build the report."));
    } finally {
      setExporting(false);
    }
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
              onClick={exportExcel}
              disabled={exporting}
              className="h-11 w-full rounded-lg bg-primary text-xs font-bold uppercase tracking-wider text-primary-foreground disabled:opacity-60"
            >
              {exporting ? "Building…" : "Export Excel"}
            </button>
          </div>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Downloads a workbook with five tabs: Summary (low-stock items highlighted), a Daily Breakdown, a Full Log
          of every movement, a Department Comparison, and a Batch Snapshot showing what's currently in stock and
          when it expires.
        </p>
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
