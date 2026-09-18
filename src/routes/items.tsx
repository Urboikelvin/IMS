import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { RequireRole } from "@/components/RequireRole";
import { DataTable, EmptyRow, Field, Panel, SelectInput, SubmitButton, Tag, TextInput } from "@/components/inventory-ui";
import { errorMessage, expiryStatus, fetchActiveBatches, fetchCategories, fetchItems, formatMoney, isLowStock, logAudit, type Batch, type Item } from "@/lib/inventory";
import { useDepartments, useRole } from "@/hooks/use-session";

export const Route = createFileRoute("/items")({
  head: () => ({
    meta: [
      { title: "Item Management • Maslow Inventory" },
      { name: "description", content: "Create and maintain items, categories, reorder thresholds and expiry dates." },
      { property: "og:title", content: "Item Management • Maslow Inventory" },
      { property: "og:description", content: "Maintain items, categories and reorder thresholds." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => (
    <RequireRole allow={["admin", "head_staff", "super_admin"]}>
      <ItemsPage />
    </RequireRole>
  ),
});

const emptyForm = {
  id: "",
  name: "",
  category_id: "",
  unit: "pcs",
  reorder_threshold: "10",
  unit_price: "0",
};

function ItemsPage() {
  const queryClient = useQueryClient();
  const { isAdmin, isHeadStaffOrAbove, departmentId: ownDepartmentId } = useRole();
  const items = useQuery({ queryKey: ["items"], queryFn: fetchItems });
  const categories = useQuery({ queryKey: ["categories"], queryFn: fetchCategories });
  const departments = useDepartments();
  const [form, setForm] = useState(emptyForm);
  const [newCategory, setNewCategory] = useState("");

  // Head Staff / Super Admin see every department and must choose which one
  // they're creating into or browsing. A plain department Admin only ever
  // has their own department — no picker shown, everything silently scoped.
  const [browseDept, setBrowseDept] = useState<string>(""); // "" = All departments
  const [formDept, setFormDept] = useState<string>("");

  const effectiveFormDept = isHeadStaffOrAbove ? formDept : ownDepartmentId ?? "";

  const departmentName = new Map((departments.data ?? []).map((d) => [d.id, d.name]));
  const categoryName = new Map((categories.data ?? []).map((c) => [c.id, c.name]));
  const batches = useQuery({ queryKey: ["active-batches"], queryFn: fetchActiveBatches });

  const batchesByItem = useMemo(() => {
    const map = new Map<string, Batch[]>();
    for (const batch of batches.data ?? []) {
      const list = map.get(batch.item_id) ?? [];
      list.push(batch);
      map.set(batch.item_id, list);
    }
    return map;
  }, [batches.data]);

  const visibleItems = useMemo(() => {
    const all = items.data ?? [];
    if (!isHeadStaffOrAbove || !browseDept) return all;
    return all.filter((i) => i.department_id === browseDept);
  }, [items.data, isHeadStaffOrAbove, browseDept]);

  const categoriesForForm = useMemo(
    () => (categories.data ?? []).filter((c) => c.department_id === effectiveFormDept),
    [categories.data, effectiveFormDept],
  );

  const saveItem = useMutation({
    mutationFn: async () => {
      if (!effectiveFormDept) throw new Error("Choose a department first.");
      const payload = {
        name: form.name.trim(),
        category_id: form.category_id || null,
        unit: form.unit.trim() || "pcs",
        reorder_threshold: Number(form.reorder_threshold) || 0,
        unit_price: Number(form.unit_price) || 0,
        department_id: effectiveFormDept,
      };
      if (form.id) {
        const { error } = await supabase.from("items").update(payload).eq("id", form.id);
        if (error) throw error;
        await logAudit("item.update", "items", form.id, payload);
      } else {
        const { data, error } = await supabase.from("items").insert(payload).select("id").single();
        if (error) throw error;
        await logAudit("item.create", "items", data.id, payload);
      }
    },
    onSuccess: () => {
      toast.success(form.id ? "Item updated." : "Item created.");
      setForm(emptyForm);
      queryClient.invalidateQueries({ queryKey: ["items"] });
    },
    onError: (error) => toast.error(errorMessage(error, "Could not save item.")),
  });

  const deleteItem = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("items").update({ deleted_at: new Date().toISOString() }).eq("id", id);
      if (error) throw error;
      await logAudit("item.delete", "items", id, null);
    },
    onSuccess: () => {
      toast.success("Item deleted.");
      queryClient.invalidateQueries({ queryKey: ["items"] });
    },
    onError: (error) => toast.error(errorMessage(error, "Could not delete item.")),
  });

  const addCategory = useMutation({
    mutationFn: async () => {
      if (!effectiveFormDept) throw new Error("Choose a department first.");
      const { data, error } = await supabase
        .from("categories")
        .insert({ name: newCategory.trim(), department_id: effectiveFormDept })
        .select("id")
        .single();
      if (error) throw error;
      await logAudit("category.create", "categories", data.id, { name: newCategory.trim() });
    },
    onSuccess: () => {
      toast.success("Category added.");
      setNewCategory("");
      queryClient.invalidateQueries({ queryKey: ["categories"] });
    },
    onError: (error) => toast.error(errorMessage(error, "Could not add category.")),
  });

  function edit(item: Item) {
    setForm({
      id: item.id,
      name: item.name,
      category_id: item.category_id ?? "",
      unit: item.unit,
      reorder_threshold: String(item.reorder_threshold),
      unit_price: String(item.unit_price),
    });
    if (isHeadStaffOrAbove) setFormDept(item.department_id);
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!form.name.trim()) return toast.error("Item name is required.");
    if (Number(form.reorder_threshold) < 0) return toast.error("Reorder threshold cannot be negative.");
    if (Number(form.unit_price) < 0) return toast.error("Unit price cannot be negative.");
    if (!effectiveFormDept) return toast.error("Choose a department first.");
    saveItem.mutate();
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Item Management</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {isAdmin ? "Add, edit and remove items and categories." : "Read-only: ask an admin to change items."}
          </p>
        </div>
        {isHeadStaffOrAbove ? (
          <Field label="Viewing">
            <SelectInput value={browseDept} onChange={(e) => setBrowseDept(e.target.value)} className="h-9 w-auto">
              <option value="">All departments</option>
              {(departments.data ?? []).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </SelectInput>
          </Field>
        ) : null}
      </header>

      <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
        <div className="flex flex-col gap-6">
          <Panel title={form.id ? "Edit item" : "New item"}>
            <form onSubmit={submit} className="flex flex-col gap-4">
              {isHeadStaffOrAbove ? (
                <Field label="Department">
                  <SelectInput
                    value={formDept}
                    onChange={(e) => {
                      setFormDept(e.target.value);
                      setForm((f) => ({ ...f, category_id: "" }));
                    }}
                    disabled={!isAdmin}
                  >
                    <option value="">Choose department…</option>
                    {(departments.data ?? []).map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </SelectInput>
                </Field>
              ) : null}
              <Field label="Name">
                <TextInput
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  disabled={!isAdmin}
                />
              </Field>
              <Field label="Category">
                <SelectInput
                  value={form.category_id}
                  onChange={(e) => setForm({ ...form, category_id: e.target.value })}
                  disabled={!isAdmin || !effectiveFormDept}
                >
                  <option value="">Uncategorised</option>
                  {categoriesForForm.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </SelectInput>
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Unit">
                  <TextInput
                    value={form.unit}
                    onChange={(e) => setForm({ ...form, unit: e.target.value })}
                    disabled={!isAdmin}
                  />
                </Field>
                <Field label="Reorder at">
                  <TextInput
                    type="number"
                    min={0}
                    value={form.reorder_threshold}
                    onChange={(e) => setForm({ ...form, reorder_threshold: e.target.value })}
                    disabled={!isAdmin}
                  />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Unit price">
                  <TextInput
                    type="number"
                    min={0}
                    step="0.01"
                    value={form.unit_price}
                    onChange={(e) => setForm({ ...form, unit_price: e.target.value })}
                    disabled={!isAdmin}
                  />
                </Field>
              </div>
              <p className="-mt-2 text-xs text-muted-foreground">
                Expiry date isn't set here anymore — it's tracked per delivery on the Stock In page, and this item
                will automatically show whichever batch expires soonest.
              </p>
              <SubmitButton disabled={!isAdmin || saveItem.isPending}>
                {form.id ? "Save Changes" : "Create Item"}
              </SubmitButton>
              {form.id ? (
                <button
                  type="button"
                  onClick={() => setForm(emptyForm)}
                  className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                >
                  Cancel edit
                </button>
              ) : null}
            </form>
          </Panel>

          <Panel title="Categories">
            {isHeadStaffOrAbove && !effectiveFormDept ? (
              <p className="text-sm text-muted-foreground">Choose a department above to manage its categories.</p>
            ) : (
              <>
                <div className="flex flex-wrap gap-2">
                  {categoriesForForm.length === 0 ? (
                    <span className="text-sm text-muted-foreground">No categories yet.</span>
                  ) : (
                    categoriesForForm.map((category) => (
                      <span key={category.id} className="rounded-full bg-secondary px-3 py-1 text-xs font-semibold">
                        {category.name}
                      </span>
                    ))
                  )}
                </div>
                <div className="mt-4 flex gap-2">
                  <TextInput
                    value={newCategory}
                    onChange={(e) => setNewCategory(e.target.value)}
                    placeholder="New category"
                    disabled={!isAdmin}
                  />
                  <button
                    type="button"
                    onClick={() => (newCategory.trim() ? addCategory.mutate() : toast.error("Enter a name."))}
                    disabled={!isAdmin || addCategory.isPending}
                    className="shrink-0 rounded-lg bg-primary px-4 text-xs font-bold uppercase text-primary-foreground disabled:opacity-50"
                  >
                    Add
                  </button>
                </div>
              </>
            )}
          </Panel>
        </div>

        <Panel title="All items" padded={false}>
          <DataTable head={isHeadStaffOrAbove ? ["Item", "Department", "Category", "Balance", "Value", ""] : ["Item", "Category", "Balance", "Value", ""]}>
            {visibleItems.length === 0 ? (
              <EmptyRow colSpan={isHeadStaffOrAbove ? 6 : 5}>No items yet.</EmptyRow>
            ) : (
              visibleItems.map((item) => {
                const expiry = expiryStatus(item);
                const itemBatches = batchesByItem.get(item.id) ?? [];
                return (
                  <tr key={item.id}>
                    <td className="px-6 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{item.name}</span>
                        {isLowStock(item) ? <Tag tone="danger">Low</Tag> : null}
                        {expiry === "expired" ? <Tag tone="danger">Expired</Tag> : null}
                        {expiry === "soon" ? <Tag tone="warn">Expiring</Tag> : null}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Reorder at {item.reorder_threshold} {item.unit}
                        {item.expiry_date ? ` • next exp ${item.expiry_date}` : ""}
                      </p>
                      {itemBatches.length > 1 ? (
                        <ul className="mt-1.5 space-y-0.5 border-l border-border pl-2">
                          {itemBatches.map((batch) => (
                            <li key={batch.id} className="text-xs text-muted-foreground">
                              <span className="font-mono">{batch.remaining_quantity}</span> {item.unit} —{" "}
                              {batch.expiry_date ? `exp ${batch.expiry_date}` : "no expiry"}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </td>
                    {isHeadStaffOrAbove ? (
                      <td className="px-6 py-3 text-muted-foreground">{departmentName.get(item.department_id) ?? "—"}</td>
                    ) : null}
                    <td className="px-6 py-3 text-muted-foreground">
                      {item.category_id ? categoryName.get(item.category_id) ?? "—" : "—"}
                    </td>
                    <td className="px-6 py-3 font-mono">
                      {item.current_balance} {item.unit}
                    </td>
                    <td className="px-6 py-3 font-mono text-muted-foreground">
                      {formatMoney(item.current_balance * item.unit_price)}
                    </td>
                    <td className="px-6 py-3 text-right">
                      <div className="flex justify-end gap-3 text-xs font-semibold uppercase">
                        <button onClick={() => edit(item)} className="text-accent" disabled={!isAdmin}>
                          Edit
                        </button>
                        <button
                          onClick={() => {
                            if (confirm(`Remove ${item.name} from the active list? Its stock history is kept, and a Super Admin can restore it if needed.`)) {
                              deleteItem.mutate(item.id);
                            }
                          }}
                          className="text-destructive"
                          disabled={!isAdmin}
                        >
                          Delete
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
