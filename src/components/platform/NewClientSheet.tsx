import { useState } from "react";
import { toast } from "sonner";
import { Field, TextInput } from "@/components/inventory-ui";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { parseFee } from "@/lib/platform";
import type { PlatformData } from "./usePlatformData";

const empty = {
  name: "",
  contactName: "",
  contactEmail: "",
  contactPhone: "",
  subscriptionEndsOn: "",
  planName: "",
  monthlyFee: "",
  adminName: "",
  adminEmail: "",
  adminPassword: "",
};

export function NewClientSheet({ data, open, onOpenChange }: { data: PlatformData; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [form, setForm] = useState(empty);
  const set = (key: keyof typeof empty) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: e.target.value });

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!form.name.trim()) return void toast.error("Client name is required.");
    if (!form.adminEmail.trim()) return void toast.error("Enter the first administrator's email.");
    if (form.adminPassword.length < 8) return void toast.error("The temporary password must be at least 8 characters.");
    const fee = parseFee(form.monthlyFee);
    if (fee === null) return void toast.error("The monthly fee must be a number, or left blank.");

    data.createClient.mutate(
      { ...form, monthlyFee: fee, billingNotes: "" },
      {
        onSuccess: () => {
          setForm(empty);
          onOpenChange(false);
        },
      },
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto p-0 sm:max-w-lg">
        <SheetHeader className="border-b border-border p-6">
          <SheetTitle>New client</SheetTitle>
          <SheetDescription>Set up a centre and its first administrator. They add their own departments and staff.</SheetDescription>
        </SheetHeader>

        <form onSubmit={submit} className="flex flex-col gap-5 p-6">
          <Field label="Client name">
            <TextInput value={form.name} onChange={set("name")} placeholder="Greenfield Diagnostics" autoFocus />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Contact person">
              <TextInput value={form.contactName} onChange={set("contactName")} placeholder="Optional" />
            </Field>
            <Field label="Contact phone">
              <TextInput value={form.contactPhone} onChange={set("contactPhone")} placeholder="Optional" />
            </Field>
          </div>
          <Field label="Contact email">
            <TextInput type="email" value={form.contactEmail} onChange={set("contactEmail")} placeholder="Optional" />
          </Field>

          <fieldset className="flex flex-col gap-4 border-t border-border pt-5">
            <legend className="mb-1 text-sm font-bold">Subscription</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Plan name">
                <TextInput value={form.planName} onChange={set("planName")} placeholder="e.g. Standard" />
              </Field>
              <Field label="Monthly fee (₦)">
                <TextInput value={form.monthlyFee} onChange={set("monthlyFee")} inputMode="decimal" placeholder="150000" />
              </Field>
            </div>
            <Field label="Subscription ends on">
              <TextInput type="date" value={form.subscriptionEndsOn} onChange={set("subscriptionEndsOn")} />
            </Field>
            <p className="-mt-2 text-xs text-muted-foreground">
              Recording a payment later moves this date forward for you. Leave it blank to set it with the first payment.
            </p>
          </fieldset>

          <fieldset className="flex flex-col gap-4 border-t border-border pt-5">
            <legend className="mb-1 text-sm font-bold">First administrator</legend>
            <p className="-mt-2 text-xs text-muted-foreground">Becomes the Super Admin of this client.</p>
            <Field label="Full name">
              <TextInput value={form.adminName} onChange={set("adminName")} placeholder="Jane Doe" />
            </Field>
            <Field label="Email">
              <TextInput type="email" value={form.adminEmail} onChange={set("adminEmail")} autoComplete="off" />
            </Field>
            <Field label="Temporary password">
              <TextInput type="password" value={form.adminPassword} onChange={set("adminPassword")} minLength={8} autoComplete="new-password" />
            </Field>
          </fieldset>

          <button
            type="submit"
            disabled={data.createClient.isPending}
            className="h-12 rounded-xl bg-primary font-semibold text-primary-foreground transition-opacity disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {data.createClient.isPending ? "Creating…" : "Create client"}
          </button>
        </form>
      </SheetContent>
    </Sheet>
  );
}
