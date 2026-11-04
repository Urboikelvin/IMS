import { useState } from "react";
import { toast } from "sonner";
import { Field, TextInput } from "@/components/inventory-ui";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { localDateString } from "@/lib/inventory";
import {
  formatDay,
  formatNaira,
  parseAmount,
  parseFee,
  plural,
  relativeTime,
  renewalAfterPayment,
  subscriptionHealth,
  suggestedPayment,
  usageSignal,
  type OrgRow,
} from "@/lib/platform";
import { StatusPill } from "./ui";
import type { PlatformData } from "./usePlatformData";

export type ClientTab = "billing" | "usage" | "details";

export function ClientSheet({
  data,
  orgId,
  tab,
  onTabChange,
  onClose,
}: {
  data: PlatformData;
  orgId: string | null;
  tab: ClientTab;
  onTabChange: (tab: ClientTab) => void;
  onClose: () => void;
}) {
  const org = orgId ? data.orgList.find((o) => o.id === orgId) : undefined;

  return (
    <Sheet open={!!org} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto p-0 sm:max-w-xl">
        {org ? <ClientPanel key={org.id} data={data} org={org} tab={tab} onTabChange={onTabChange} /> : null}
      </SheetContent>
    </Sheet>
  );
}

function ClientPanel({ data, org, tab, onTabChange }: { data: PlatformData; org: OrgRow; tab: ClientTab; onTabChange: (tab: ClientTab) => void }) {
  const health = subscriptionHealth(org);
  const suspended = org.status === "suspended";

  function toggleStatus() {
    const next = suspended ? "active" : "suspended";
    const message = suspended
      ? `Reactivate ${org.name}?`
      : `Suspend ${org.name}? Everyone there loses access immediately. Their data is kept.`;
    if (confirm(message)) data.setStatus.mutate({ org, status: next });
  }

  return (
    <>
      <SheetHeader className="border-b border-border p-6 pr-14">
        <div className="flex flex-wrap items-center gap-3">
          <SheetTitle className="text-xl font-bold">{org.name}</SheetTitle>
          <StatusPill tone={health.tone}>{health.label}</StatusPill>
        </div>
        <SheetDescription>
          {[org.contact_name, org.contact_email, org.contact_phone].filter(Boolean).join(" · ") || "No contact details yet"}
        </SheetDescription>
        <div className="pt-2">
          <button
            type="button"
            onClick={toggleStatus}
            disabled={data.setStatus.isPending}
            className={`rounded-lg border px-3 py-1.5 text-sm font-semibold transition-colors disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${
              suspended ? "border-border hover:bg-secondary" : "border-danger-border text-danger-strong hover:bg-danger-surface"
            }`}
          >
            {suspended ? "Reactivate access" : "Suspend access"}
          </button>
        </div>
      </SheetHeader>

      <Tabs value={tab} onValueChange={(v) => onTabChange(v as ClientTab)} className="gap-0">
        <TabsList className="mx-6 mt-4 grid w-auto grid-cols-3">
          <TabsTrigger value="billing">Billing</TabsTrigger>
          <TabsTrigger value="usage">Usage</TabsTrigger>
          <TabsTrigger value="details">Details</TabsTrigger>
        </TabsList>
        <TabsContent value="billing" className="p-6">
          <BillingTab data={data} org={org} />
        </TabsContent>
        <TabsContent value="usage" className="p-6">
          <UsageTab data={data} org={org} />
        </TabsContent>
        <TabsContent value="details" className="p-6">
          <DetailsTab data={data} org={org} />
        </TabsContent>
      </Tabs>
    </>
  );
}

function BillingNotReady() {
  return (
    <p className="rounded-lg bg-warning-surface px-4 py-3 text-sm text-warning-strong">
      Billing isn't set up on this database yet. Apply the migration <span className="font-mono">20261103180000_platform_billing_and_activity.sql</span>, then reload.
    </p>
  );
}

// ---------------------------------------------------------------------------

function BillingTab({ data, org }: { data: PlatformData; org: OrgRow }) {
  const billing = data.billingByOrg.get(org.id);
  const fee = billing?.monthly_fee ?? 0;
  const ledger = data.paymentsByOrg.get(org.id);
  const collected = ledger?.total ?? 0;
  const health = subscriptionHealth(org);

  const [months, setMonths] = useState(1);
  const [amount, setAmount] = useState("");
  const [touched, setTouched] = useState(false);
  const [paidOn, setPaidOn] = useState(localDateString());
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [extend, setExtend] = useState(true);

  if (!data.billingReady) return <BillingNotReady />;

  const suggested = fee > 0 ? String(suggestedPayment(fee, months)) : "";
  const amountText = touched ? amount : suggested;
  const preview = extend && paidOn ? formatDay(renewalAfterPayment(org.subscription_ends_on, paidOn, months)) : null;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const value = parseAmount(amountText);
    if (value === null) return void toast.error("Enter an amount greater than zero.");
    if (!paidOn) return void toast.error("Choose the date the payment was received.");
    data.recordPayment.mutate(
      { orgId: org.id, amount: value, paidOn, months, reference, note, extend },
      {
        onSuccess: () => {
          setTouched(false);
          setAmount("");
          setReference("");
          setNote("");
        },
      },
    );
  }

  function voidPayment(id: string, amountValue: number, extended: boolean, monthsCovered: number) {
    const consequence = extended ? ` The renewal date moves back ${plural(monthsCovered, "month")}.` : "";
    if (confirm(`Void this ${formatNaira(amountValue)} payment?${consequence}`)) data.voidPayment.mutate(id);
  }

  return (
    <div className="flex flex-col gap-6">
      <dl className="grid gap-4 sm:grid-cols-3">
        <div>
          <dt className="text-sm text-muted-foreground">Monthly fee</dt>
          <dd className="text-lg font-bold tabular-nums">{fee > 0 ? formatNaira(fee) : "Not set"}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">Paid until</dt>
          <dd className="text-lg font-bold">{formatDay(org.subscription_ends_on)}</dd>
          <p className="text-xs text-muted-foreground">{health.detail}</p>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">Collected to date</dt>
          <dd className="text-lg font-bold tabular-nums">{formatNaira(collected)}</dd>
          <p className="text-xs text-muted-foreground">{plural(ledger?.count ?? 0, "payment")}</p>
        </div>
      </dl>

      <form onSubmit={submit} className="flex flex-col gap-4 rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold">Record a payment</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Months covered">
            <select
              value={months}
              onChange={(e) => setMonths(Number(e.target.value))}
              className="h-11 w-full rounded-lg border border-border bg-secondary px-3 text-sm outline-none focus:border-accent"
            >
              {[1, 2, 3, 6, 12, 24].map((m) => (
                <option key={m} value={m}>
                  {plural(m, "month")}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Amount received (₦)">
            <TextInput
              value={amountText}
              inputMode="decimal"
              onChange={(e) => {
                setTouched(true);
                setAmount(e.target.value);
              }}
              placeholder={fee > 0 ? undefined : "e.g. 150000"}
            />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Received on">
            <TextInput type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
          </Field>
          <Field label="Reference">
            <TextInput value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Transfer ref (optional)" />
          </Field>
        </div>
        <Field label="Note">
          <TextInput value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
        </Field>
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" checked={extend} onChange={(e) => setExtend(e.target.checked)} className="mt-0.5 size-4 accent-[var(--color-accent)]" />
          <span>
            Move the renewal date forward
            <span className="block text-xs text-muted-foreground">
              {preview ? `New renewal date: ${preview}` : "Untick this when logging an old payment, so the current date stays as it is."}
            </span>
          </span>
        </label>
        <button
          type="submit"
          disabled={data.recordPayment.isPending}
          className="h-11 rounded-lg bg-primary text-sm font-semibold text-primary-foreground transition-opacity disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {data.recordPayment.isPending ? "Recording…" : "Record payment"}
        </button>
      </form>

      <section aria-labelledby="ledger-heading">
        <h3 id="ledger-heading" className="mb-2 text-sm font-bold">Payment history</h3>
        {!ledger || ledger.rows.length === 0 ? (
          <p className="rounded-lg bg-secondary px-4 py-6 text-center text-sm text-muted-foreground">No payments recorded for this client yet.</p>
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border">
            {ledger.rows.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <div>
                  <p className="text-sm font-semibold tabular-nums">{formatNaira(p.amount)}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDay(p.paid_on)} · {plural(p.months_covered, "month")}
                    {p.reference ? ` · ${p.reference}` : ""}
                    {p.extended ? "" : " · date not changed"}
                  </p>
                  {p.note ? <p className="text-xs text-muted-foreground">{p.note}</p> : null}
                </div>
                <button
                  type="button"
                  onClick={() => voidPayment(p.id, p.amount, p.extended, p.months_covered)}
                  disabled={data.voidPayment.isPending}
                  className="rounded-lg px-3 py-1.5 text-xs font-semibold text-destructive hover:bg-danger-surface disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-ring"
                >
                  Void
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------

function UsageTab({ data, org }: { data: PlatformData; org: OrgRow }) {
  const stats = data.overviewByOrg.get(org.id);
  const usage = usageSignal(org, stats);
  const rows: [string, string][] = [
    ["People", String(stats?.user_count ?? 0)],
    ["Departments", String(stats?.department_count ?? 0)],
    ["Items tracked", String(stats?.item_count ?? 0)],
    ["Stock movements, last 30 days", String(stats?.movement_count_30d ?? 0)],
    ["Last activity", relativeTime(stats?.last_activity ?? null)],
    ["Joined", formatDay(org.created_at)],
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <StatusPill tone={usage.tone}>{usage.label}</StatusPill>
        <p className="text-sm text-muted-foreground">
          {usage.key === "dormant"
            ? "No stock activity in over two weeks. A check-in call may help."
            : usage.key === "new"
              ? "Joined recently. Give them time to get started."
              : usage.key === "quiet"
                ? "Some activity recently, but nothing in the last 30 days of movements."
                : "Using KAYA regularly."}
        </p>
      </div>
      <dl className="grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label} className="bg-surface px-4 py-3">
            <dt className="text-sm text-muted-foreground">{label}</dt>
            <dd className="text-lg font-bold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-muted-foreground">You see counts and activity only, never a client's stock records.</p>
    </div>
  );
}

// ---------------------------------------------------------------------------

function DetailsTab({ data, org }: { data: PlatformData; org: OrgRow }) {
  const billing = data.billingByOrg.get(org.id);
  const [form, setForm] = useState({
    name: org.name,
    contactName: org.contact_name ?? "",
    contactEmail: org.contact_email ?? "",
    contactPhone: org.contact_phone ?? "",
    subscriptionEndsOn: org.subscription_ends_on ?? "",
    planName: billing?.plan_name ?? "",
    monthlyFee: billing && billing.monthly_fee > 0 ? String(billing.monthly_fee) : "",
    billingNotes: billing?.billing_notes ?? "",
  });
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [key]: e.target.value });

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!form.name.trim()) return void toast.error("Client name is required.");
    const fee = parseFee(form.monthlyFee);
    if (fee === null) return void toast.error("The monthly fee must be a number, or left blank.");
    data.saveClient.mutate({ orgId: org.id, details: { ...form, monthlyFee: fee } });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <Field label="Client name">
        <TextInput value={form.name} onChange={set("name")} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Contact person">
          <TextInput value={form.contactName} onChange={set("contactName")} />
        </Field>
        <Field label="Contact phone">
          <TextInput value={form.contactPhone} onChange={set("contactPhone")} />
        </Field>
      </div>
      <Field label="Contact email">
        <TextInput type="email" value={form.contactEmail} onChange={set("contactEmail")} />
      </Field>

      <div className="grid gap-4 border-t border-border pt-5 sm:grid-cols-2">
        <Field label="Plan name">
          <TextInput value={form.planName} onChange={set("planName")} disabled={!data.billingReady} />
        </Field>
        <Field label="Monthly fee (₦)">
          <TextInput value={form.monthlyFee} onChange={set("monthlyFee")} inputMode="decimal" disabled={!data.billingReady} />
        </Field>
      </div>
      <Field label="Subscription ends on">
        <TextInput type="date" value={form.subscriptionEndsOn} onChange={set("subscriptionEndsOn")} />
      </Field>
      <Field label="Private notes">
        <textarea
          value={form.billingNotes}
          onChange={set("billingNotes")}
          rows={3}
          disabled={!data.billingReady}
          placeholder="Reseller, agreement reference… Only platform admins can see this."
          className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm outline-none transition-colors focus:border-accent"
        />
      </Field>
      {!data.billingReady ? <BillingNotReady /> : null}

      <button
        type="submit"
        disabled={data.saveClient.isPending}
        className="h-11 rounded-lg bg-primary text-sm font-semibold text-primary-foreground transition-opacity disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        {data.saveClient.isPending ? "Saving…" : "Save changes"}
      </button>
    </form>
  );
}
