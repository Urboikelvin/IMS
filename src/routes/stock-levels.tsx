import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { RequireAuth } from "@/components/RequireAuth";
import { Field, Panel, SelectInput, Tag, TextInput } from "@/components/inventory-ui";
import { fetchCategories, fetchItems, isLowStock } from "@/lib/inventory";
import { useDepartments, useRole } from "@/hooks/use-session";
import { APP_NAME } from "@/lib/brand";

export const Route = createFileRoute("/stock-levels")({
  head: () => ({
    meta: [
      { title: `Stock Levels • ${APP_NAME}` },
      { name: "description", content: "At-a-glance view of every item's current stock level." },
      { property: "og:title", content: `Stock Levels • ${APP_NAME}` },
      { property: "og:description", content: "See how much of every item is currently in stock." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => (
    <RequireAuth>
      <StockLevelsPage />
    </RequireAuth>
  ),
});

/** How full a bar to draw for this item, purely visual — 100% once balance
 * reaches 2x its reorder threshold, so the bar has headroom to show "well
 * stocked" instead of maxing out right at the reorder point. Items with no
 * threshold set just show a flat mid-level bar (nothing to compare against). */
function fillPercent(balance: number, threshold: number) {
  if (threshold <= 0) return balance > 0 ? 60 : 0;
  return Math.max(0, Math.min(100, (balance / (threshold * 2)) * 100));
}

function barTone(low: boolean, percent: number) {
  if (low) return "bg-destructive";
  if (percent < 60) return "bg-warning";
  return "bg-success";
}

function StockLevelsPage() {
  const { isHeadStaffOrAbove } = useRole();
  const items = useQuery({ queryKey: ["items"], queryFn: fetchItems });
  const categories = useQuery({ queryKey: ["categories"], queryFn: fetchCategories });
  const departments = useDepartments();

  const [search, setSearch] = useState("");
  const [deptFilter, setDeptFilter] = useState("");

  const categoryName = new Map((categories.data ?? []).map((c) => [c.id, c.name]));
  const departmentName = new Map((departments.data ?? []).map((d) => [d.id, d.name]));

  const visible = useMemo(() => {
    let list = items.data ?? [];
    if (isHeadStaffOrAbove && deptFilter) list = list.filter((i) => i.department_id === deptFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((i) => i.name.toLowerCase().includes(q));
    }
    return [...list].sort((a, b) => a.name.localeCompare(b.name));
  }, [items.data, isHeadStaffOrAbove, deptFilter, search]);

  const lowCount = visible.filter(isLowStock).length;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Stock Levels</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {visible.length} item{visible.length === 1 ? "" : "s"}
            {lowCount > 0 ? ` • ${lowCount} at or below reorder` : " • all healthy"}
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          {isHeadStaffOrAbove ? (
            <Field label="Department">
              <SelectInput value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)} className="h-9 w-auto">
                <option value="">All departments</option>
                {(departments.data ?? []).map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </SelectInput>
            </Field>
          ) : null}
          <Field label="Search">
            <TextInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Item name…" className="h-9" />
          </Field>
        </div>
      </header>

      <Panel title="Items" padded={false}>
        {visible.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-muted-foreground">No items match.</p>
        ) : (
          <div className="divide-y divide-border">
            {visible.map((item) => {
              const low = isLowStock(item);
              const percent = fillPercent(item.current_balance, item.reorder_threshold);
              return (
                <div key={item.id} className="flex flex-col gap-2 px-6 py-4 sm:flex-row sm:items-center sm:gap-6">
                  <div className="min-w-0 sm:w-56">
                    <div className="flex items-center gap-2">
                      <p className="truncate font-medium">{item.name}</p>
                      {low ? <Tag tone="danger">Low</Tag> : null}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {item.category_id ? categoryName.get(item.category_id) ?? "" : "Uncategorised"}
                      {isHeadStaffOrAbove ? ` • ${departmentName.get(item.department_id) ?? ""}` : ""}
                    </p>
                  </div>
                  <div className="flex-1">
                    <div className="h-2.5 w-full overflow-hidden rounded-full bg-secondary">
                      <div
                        className={`h-full rounded-full transition-all ${barTone(low, percent)}`}
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                  </div>
                  <div className="text-right sm:w-40">
                    <p className="font-mono font-semibold">
                      {item.current_balance} {item.unit}
                    </p>
                    <p className="text-xs text-muted-foreground">reorder at {item.reorder_threshold}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Panel>
    </div>
  );
}
