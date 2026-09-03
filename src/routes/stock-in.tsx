import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { RequireAuth } from "@/components/RequireAuth";
import { DataTable, EmptyRow, Field, Panel, SelectInput, SubmitButton, TextInput } from "@/components/inventory-ui";
import { fetchItems, fetchStockIn, logAudit } from "@/lib/inventory";

export const Route = createFileRoute("/stock-in")({
  head: () => ({
    meta: [
      { title: "Stock In • Maslow Inventory" },
      { name: "description", content: "Log incoming deliveries and keep item balances updated automatically." },
      { property: "og:title", content: "Stock In • Maslow Inventory" },
      { property: "og:description", content: "Log incoming deliveries for Maslow inventory." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => (
    <RequireAuth>
      <StockInPage />
    </RequireAuth>
  ),
});

const today = () => new Date().toISOString().slice(0, 10);

function StockInPage() {
  const queryClient = useQueryClient();
  const items = useQuery({ queryKey: ["items"], queryFn: fetchItems });
  const history = useQuery({ queryKey: ["stock-in"], queryFn: fetchStockIn });

  const [itemId, setItemId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [date, setDate] = useState(today());
  const [supplier, setSupplier] = useState("");
  const [notes, setNotes] = useState("");

  const byId = new Map((items.data ?? []).map((item) => [item.id, item]));

  const mutation = useMutation({
    mutationFn: async () => {
      const { data: userData } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from("stock_in")
        .insert({
          item_id: itemId,
          quantity: Number(quantity),
          date,
          supplier: supplier.trim() || null,
          notes: notes.trim() || null,
          logged_by: userData.user?.id ?? null,
        })
        .select("id")
        .single();
      if (error) throw error;
      await logAudit("stock_in.create", "stock_in", data.id, { item_id: itemId, quantity: Number(quantity) });
    },
    onSuccess: () => {
      toast.success("Stock in recorded.");
      setItemId("");
      setQuantity("");
      setSupplier("");
      setNotes("");
      queryClient.invalidateQueries({ queryKey: ["items"] });
      queryClient.invalidateQueries({ queryKey: ["stock-in"] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not save entry."),
  });

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!itemId) return toast.error("Select an item.");
    if (!(Number(quantity) > 0)) return toast.error("Quantity must be greater than zero.");
    if (!date) return toast.error("Choose a date.");
    mutation.mutate();
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Stock In</h1>
        <p className="mt-1 text-sm text-muted-foreground">Record deliveries; balances update instantly.</p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
        <Panel title="New entry">
          <form onSubmit={submit} className="flex flex-col gap-4">
            <Field label="Item">
              <SelectInput value={itemId} onChange={(e) => setItemId(e.target.value)}>
                <option value="">Select item…</option>
                {(items.data ?? []).map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} ({item.current_balance} {item.unit})
                  </option>
                ))}
              </SelectInput>
            </Field>
            <Field label="Quantity">
              <TextInput
                type="number"
                min={1}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder="0"
              />
            </Field>
            <Field label="Date">
              <TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="Supplier">
              <TextInput value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="Optional" />
            </Field>
            <Field label="Notes">
              <TextInput value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
            </Field>
            <SubmitButton disabled={mutation.isPending}>
              {mutation.isPending ? "Saving…" : "Record Stock In"}
            </SubmitButton>
          </form>
        </Panel>

        <Panel title="History" padded={false}>
          <DataTable head={["Item", "Supplier", "Date", "Qty"]}>
            {(history.data ?? []).length === 0 ? (
              <EmptyRow colSpan={4}>No incoming stock logged yet.</EmptyRow>
            ) : (
              (history.data ?? []).map((movement) => (
                <tr key={movement.id}>
                  <td className="px-6 py-3 font-medium">{byId.get(movement.item_id)?.name ?? "—"}</td>
                  <td className="px-6 py-3 text-muted-foreground">{movement.supplier ?? "—"}</td>
                  <td className="px-6 py-3 font-mono text-xs text-muted-foreground">{movement.date}</td>
                  <td className="px-6 py-3 text-right font-mono text-success">+{movement.quantity}</td>
                </tr>
              ))
            )}
          </DataTable>
        </Panel>
      </div>
    </div>
  );
}
