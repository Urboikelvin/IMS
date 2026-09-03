import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { RequireRole } from "@/components/RequireRole";
import { DataTable, EmptyRow, Field, Panel, SelectInput, SubmitButton, Tag, TextInput } from "@/components/inventory-ui";
import { expiryStatus, fetchCategories, fetchItems, formatMoney, isLowStock, logAudit, type Item } from "@/lib/inventory";
import { useRole } from "@/hooks/use-session";

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
    <RequireRole allow={["admin", "super_admin"]}>
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
  expiry_date: "",
};

function ItemsPage() {
  const queryClient = useQueryClient();
  const { isAdmin } = useRole();
  const items = useQuery({ queryKey: ["items"], queryFn: fetchItems });
  const categories = useQuery({ queryKey: ["categories"], queryFn: fetchCategories });
  const [form, setForm] = useState(emptyForm);
  const [newCategory, setNewCategory] = useState("");

  const categoryName = new Map((categories.data ?? []).map((c) => [c.id, c.name]));

  const saveItem = useMutation({
    mutationFn: async () => {
      const payload = {
        name: form.name.trim(),
        category_id: form.category_id || null,
        unit: form.unit.trim() || "pcs",
        reorder_threshold: Number(form.reorder_threshold) || 0,
        unit_price: Number(form.unit_price) || 0,
        expiry_date: form.expiry_date || null,
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
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not save item."),
  });

  const deleteItem = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("items").delete().eq("id", id);
      if (error) throw error;
      await logAudit("item.delete", "items", id, null);
    },
    onSuccess: () => {
      toast.success("Item deleted.");
      queryClient.invalidateQueries({ queryKey: ["items"] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not delete item."),
  });

  const addCategory = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.from("categories").insert({ name: newCategory.trim() }).select("id").single();
      if (error) throw error;
      await logAudit("category.create", "categories", data.id, { name: newCategory.trim() });
    },
    onSuccess: () => {
      toast.success("Category added.");
      setNewCategory("");
      queryClient.invalidateQueries({ queryKey: ["categories"] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not add category."),
  });

  function edit(item: Item) {
    setForm({
      id: item.id,
      name: item.name,
      category_id: item.category_id ?? "",
      unit: item.unit,
      reorder_threshold: String(item.reorder_threshold),
      unit_price: String(item.unit_price),
      expiry_date: item.expiry_date ?? "",
    });
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!form.name.trim()) return toast.error("Item name is required.");
    if (Number(form.reorder_threshold) < 0) return toast.error("Reorder threshold cannot be negative.");
    if (Number(form.unit_price) < 0) return toast.error("Unit price cannot be negative.");
    saveItem.mutate();
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Item Management</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {isAdmin ? "Add, edit and remove items and categories." : "Read-only: ask an admin to change items."}
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
        <div className="flex flex-col gap-6">
          <Panel title={form.id ? "Edit item" : "New item"}>
            <form onSubmit={submit} className="flex flex-col gap-4">
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
                  disabled={!isAdmin}
                >
                  <option value="">Uncategorised</option>
                  {(categories.data ?? []).map((category) => (
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
                <Field label="Expiry date">
                  <TextInput
                    type="date"
                    value={form.expiry_date}
                    onChange={(e) => setForm({ ...form, expiry_date: e.target.value })}
                    disabled={!isAdmin}
                  />
                </Field>
              </div>
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
            <div className="flex flex-wrap gap-2">
              {(categories.data ?? []).map((category) => (
                <span key={category.id} className="rounded-full bg-secondary px-3 py-1 text-xs font-semibold">
                  {category.name}
                </span>
              ))}
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
          </Panel>
        </div>

        <Panel title="All items" padded={false}>
          <DataTable head={["Item", "Category", "Balance", "Value", ""]}>
            {(items.data ?? []).length === 0 ? (
              <EmptyRow colSpan={5}>No items yet.</EmptyRow>
            ) : (
              (items.data ?? []).map((item) => {
                const expiry = expiryStatus(item);
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
                        {item.expiry_date ? ` • exp ${item.expiry_date}` : ""}
                      </p>
                    </td>
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
                            if (confirm(`Delete ${item.name}? Movement history will be removed.`)) {
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
