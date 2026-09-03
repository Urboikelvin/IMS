import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { RequireAuth } from "@/components/RequireAuth";
import { DataTable, EmptyRow, Field, Panel, SelectInput, SubmitButton, TextInput } from "@/components/inventory-ui";
import { fetchItems, fetchStockOut, logAudit } from "@/lib/inventory";

export const Route = createFileRoute("/stock-out")({
  head: () => ({
    meta: [
      { title: "Stock Out • Maslow Inventory" },
      { name: "description", content: "Log daily issuance with validation that prevents negative stock balances." },
      { property: "og:title", content: "Stock Out • Maslow Inventory" },
      { property: "og:description", content: "Log daily issuance for Maslow inventory." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => (
    <RequireAuth>
      <StockOutPage />
    </RequireAuth>
  ),
});

const today = () => new Date().toISOString().slice(0, 10);

function StockOutPage() {
  const queryClient = useQueryClient();
  const items = useQuery({ queryKey: ["items"], queryFn: fetchItems });
  const history = useQuery({ queryKey: ["stock-out"], queryFn: fetchStockOut });

  const [itemId, setItemId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [date, setDate] = useState(today());
  const [recipient, setRecipient] = useState("");
  const [notes, setNotes] = useState("");

  const list = items.data ?? [];
  const byId = new Map(list.map((item) => [item.id, item]));
  const selected = byId.get(itemId);

  const mutation = useMutation({
    mutationFn: async () => {
      const { data: userData } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from("stock_out")
        .insert({
          item_id: itemId,
          quantity: Number(quantity),
          date,
          recipient: recipient.trim() || null,
          notes: notes.trim() || null,
          logged_by: userData.user?.id ?? null,
        })
        .select("id")
        .single();
      if (error) throw error;
      await logAudit("stock_out.create", "stock_out", data.id, { item_id: itemId, quantity: Number(quantity) });
    },
    onSuccess: () => {
      toast.success("Issuance recorded.");
      setItemId("");
      setQuantity("");
      setRecipient("");
      setNotes("");
      queryClient.invalidateQueries({ queryKey: ["items"] });
      queryClient.invalidateQueries({ queryKey: ["stock-out"] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not save entry."),
  });

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!itemId) return toast.error("Select an item.");
    const qty = Number(quantity);
    if (!(qty > 0)) return toast.error("Quantity must be greater than zero.");
    if (selected && qty > selected.current_balance) {
      return toast.error(`Only ${selected.current_balance} ${selected.unit} available.`);
    }
    if (!date) return toast.error("Choose a date.");
    mutation.mutate();
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Stock Out</h1>
        <p className="mt-1 text-sm text-muted-foreground">Daily issuance — balances can never go negative.</p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
        <Panel title="New issuance">
          <form onSubmit={submit} className="flex flex-col gap-4">
            <Field label="Item">
              <SelectInput value={itemId} onChange={(e) => setItemId(e.target.value)}>
                <option value="">Select item…</option>
                {list.map((item) => (
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
                max={selected?.current_balance}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder="0"
              />
            </Field>
            {selected ? (
              <p className="text-xs text-muted-foreground">
                Available: <span className="font-mono">{selected.current_balance}</span> {selected.unit}
              </p>
            ) : null}
            <Field label="Date">
              <TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="Issued to">
              <TextInput value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="Department / person" />
            </Field>
            <Field label="Notes">
              <TextInput value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
            </Field>
            <SubmitButton disabled={mutation.isPending}>
              {mutation.isPending ? "Saving…" : "Record Issuance"}
            </SubmitButton>
          </form>
        </Panel>

        <Panel title="History" padded={false}>
          <DataTable head={["Item", "Issued to", "Date", "Qty"]}>
            {(history.data ?? []).length === 0 ? (
              <EmptyRow colSpan={4}>No issuance logged yet.</EmptyRow>
            ) : (
              (history.data ?? []).map((movement) => (
                <tr key={movement.id}>
                  <td className="px-6 py-3 font-medium">{byId.get(movement.item_id)?.name ?? "—"}</td>
                  <td className="px-6 py-3 text-muted-foreground">{movement.recipient ?? "—"}</td>
                  <td className="px-6 py-3 font-mono text-xs text-muted-foreground">{movement.date}</td>
                  <td className="px-6 py-3 text-right font-mono text-destructive">−{movement.quantity}</td>
                </tr>
              ))
            )}
          </DataTable>
        </Panel>
      </div>
    </div>
  );
}
