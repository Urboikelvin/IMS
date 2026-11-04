// Pure business logic for the platform console: subscription health, usage
// signals, the attention list and the activity feed wording. No React, no database —
// so it can be tested on its own and reused anywhere.

export type OrgRow = {
  id: string;
  name: string;
  status: string;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  subscription_ends_on: string | null;
  created_at: string;
};

export type BillingRow = {
  organization_id: string;
  plan_name: string | null;
  monthly_fee: number;
  billing_notes: string | null;
};

export type PaymentRow = {
  id: string;
  organization_id: string;
  amount: number;
  paid_on: string;
  months_covered: number;
  extended: boolean;
  reference: string | null;
  note: string | null;
  created_at: string;
};

export type OverviewRow = {
  org_id: string;
  user_count: number;
  department_count: number;
  item_count: number;
  movement_count_30d: number;
  last_activity: string | null;
};

export type EventRow = {
  id: string;
  organization_id: string | null;
  organization_name: string | null;
  kind: string;
  details: unknown;
  created_at: string;
};

export const EXPIRING_WITHIN_DAYS = 14;
export const DORMANT_AFTER_DAYS = 14;
const DAY_MS = 86_400_000;

export function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

// ---------------------------------------------------------------------------
// Dates. Subscription dates are plain YYYY-MM-DD strings, so everything is
// compared as whole calendar days in the viewer's own timezone.
// ---------------------------------------------------------------------------

function dayNumber(iso: string): number {
  const [year, month, day] = iso.slice(0, 10).split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function todayNumber(now: Date): number {
  return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
}

/** Whole days from today until the given date. Negative when it is in the past. */
export function daysUntil(iso: string, now: Date = new Date()): number {
  return Math.round((dayNumber(iso) - todayNumber(now)) / DAY_MS);
}

/** Whole days since a timestamp (local calendar days). */
function daysSince(timestamp: string, now: Date): number {
  const then = new Date(timestamp);
  return Math.round((todayNumber(now) - Date.UTC(then.getFullYear(), then.getMonth(), then.getDate())) / DAY_MS);
}

export function relativeTime(timestamp: string | null, now: Date = new Date()): string {
  if (!timestamp) return "never";
  const seconds = Math.max(0, Math.round((now.getTime() - new Date(timestamp).getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${plural(hours, "hour")} ago`;
  const days = daysSince(timestamp, now);
  if (days <= 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${plural(months, "month")} ago`;
  return `${plural(Math.floor(months / 12), "year")} ago`;
}

export function formatDay(iso: string | null): string {
  if (!iso) return "—";
  const [year, month, day] = iso.slice(0, 10).split("-").map(Number);
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${day} ${names[month - 1]} ${year}`;
}

// ---------------------------------------------------------------------------
// Subscription health
// ---------------------------------------------------------------------------

export type HealthKey = "suspended" | "overdue" | "expiring" | "no_date" | "healthy";
export type Tone = "ok" | "warn" | "danger" | "muted";

export type Health = {
  key: HealthKey;
  label: string;
  detail: string;
  tone: Tone;
  daysLeft: number | null;
};

export function subscriptionHealth(
  org: Pick<OrgRow, "status" | "subscription_ends_on">,
  now: Date = new Date(),
): Health {
  const daysLeft = org.subscription_ends_on ? daysUntil(org.subscription_ends_on, now) : null;

  if (org.status === "suspended") {
    return { key: "suspended", label: "Suspended", detail: "Locked out", tone: "danger", daysLeft };
  }
  if (daysLeft === null) {
    return { key: "no_date", label: "No renewal date", detail: "Set one to track this client", tone: "warn", daysLeft };
  }
  if (daysLeft < 0) {
    return { key: "overdue", label: "Overdue", detail: `${plural(-daysLeft, "day")} overdue`, tone: "danger", daysLeft };
  }
  if (daysLeft === 0) {
    return { key: "expiring", label: "Ends today", detail: "Renewal due today", tone: "warn", daysLeft };
  }
  if (daysLeft <= EXPIRING_WITHIN_DAYS) {
    return { key: "expiring", label: "Renews soon", detail: `${plural(daysLeft, "day")} left`, tone: "warn", daysLeft };
  }
  return { key: "healthy", label: "Active", detail: `${plural(daysLeft, "day")} left`, tone: "ok", daysLeft };
}

// ---------------------------------------------------------------------------
// Usage signal (counts only — the console never sees stock contents)
// ---------------------------------------------------------------------------

export type UsageKey = "active" | "new" | "quiet" | "dormant";

export function usageSignal(
  org: Pick<OrgRow, "created_at">,
  overview: OverviewRow | undefined,
  now: Date = new Date(),
): { key: UsageKey; label: string; tone: Tone } {
  if ((overview?.movement_count_30d ?? 0) > 0) return { key: "active", label: "Active", tone: "ok" };
  if (daysSince(org.created_at, now) < DORMANT_AFTER_DAYS) return { key: "new", label: "New", tone: "muted" };
  const lastSeen = overview?.last_activity ? daysSince(overview.last_activity, now) : null;
  if (lastSeen !== null && lastSeen < DORMANT_AFTER_DAYS) return { key: "quiet", label: "Quiet", tone: "muted" };
  return { key: "dormant", label: "Dormant", tone: "warn" };
}

// ---------------------------------------------------------------------------
// Attention list
// ---------------------------------------------------------------------------

export type AttentionKind = "overdue" | "expiring" | "no_date" | "dormant";

export type AttentionItem = {
  org: OrgRow;
  kind: AttentionKind;
  reason: string;
  fee: number;
};

const attentionOrder: Record<AttentionKind, number> = { overdue: 0, expiring: 1, no_date: 2, dormant: 3 };

export function attentionItems(
  orgs: OrgRow[],
  billingByOrg: Map<string, BillingRow>,
  overviewByOrg: Map<string, OverviewRow>,
  now: Date = new Date(),
): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const org of orgs) {
    if (org.status !== "active") continue;
    const fee = billingByOrg.get(org.id)?.monthly_fee ?? 0;
    const health = subscriptionHealth(org, now);

    if (health.key === "overdue") items.push({ org, kind: "overdue", reason: health.detail, fee });
    else if (health.key === "expiring") {
      const reason = health.daysLeft === 0 ? "Renewal due today" : `Renews in ${plural(health.daysLeft ?? 0, "day")}`;
      items.push({ org, kind: "expiring", reason, fee });
    }
    else if (health.key === "no_date") items.push({ org, kind: "no_date", reason: "No renewal date set", fee });

    if (usageSignal(org, overviewByOrg.get(org.id), now).key === "dormant") {
      items.push({ org, kind: "dormant", reason: "No stock activity for 30 days", fee });
    }
  }
  return items.sort((a, b) => attentionOrder[a.kind] - attentionOrder[b.kind] || a.org.name.localeCompare(b.org.name));
}

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Accepts "150000", "150,000" or "150 000.50". Returns null for anything that is not a positive number. */
export function parseAmount(text: string): number | null {
  const cleaned = text.replace(/[,\s]/g, "");
  if (cleaned === "") return null;
  const value = Number(cleaned);
  return Number.isFinite(value) && value > 0 ? round2(value) : null;
}

/** Naira with no decimals for whole amounts, two decimals only when needed. */
export function formatNaira(value: number): string {
  const digits = Number.isInteger(value) ? 0 : 2;
  return new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
}

/** Adds calendar months to a YYYY-MM-DD date the way Postgres does: 31 Jan + 1 month = 28 Feb (or 29 in a leap year). */
export function addMonthsIso(iso: string, months: number): string {
  const [year, month, day] = iso.slice(0, 10).split("-").map(Number);
  const total = month - 1 + months;
  const newYear = year + Math.floor(total / 12);
  const newMonth = ((total % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(newYear, newMonth + 1, 0)).getUTCDate();
  const newDay = Math.min(day, lastDay);
  return `${newYear}-${String(newMonth + 1).padStart(2, "0")}-${String(newDay).padStart(2, "0")}`;
}

/** What the renewal date becomes after a payment — the same rule record_client_payment uses in the database. */
export function renewalAfterPayment(currentEnd: string | null, paidOn: string, months: number): string {
  const base = currentEnd && currentEnd > paidOn ? currentEnd : paidOn;
  return addMonthsIso(base, months);
}

/** A monthly fee field: blank means no fee (0). Returns null when the text is not a valid non-negative amount. */
export function parseFee(text: string): number | null {
  const cleaned = text.replace(/[,\s]/g, "");
  if (cleaned === "") return 0;
  const value = Number(cleaned);
  return Number.isFinite(value) && value >= 0 ? round2(value) : null;
}

export function suggestedPayment(monthlyFee: number, months: number): number {
  return round2(monthlyFee * months);
}

export type FleetSummary = {
  total: number;
  active: number;
  suspended: number;
  overdue: number;
  expiring: number;
  noDate: number;
  dormant: number;
  people: number;
  movements30d: number;
};

/** One-glance numbers for the whole platform. Counts only. */
export function fleetSummary(
  orgs: OrgRow[],
  overviewByOrg: Map<string, OverviewRow>,
  now: Date = new Date(),
): FleetSummary {
  const out: FleetSummary = { total: orgs.length, active: 0, suspended: 0, overdue: 0, expiring: 0, noDate: 0, dormant: 0, people: 0, movements30d: 0 };
  for (const org of orgs) {
    const stats = overviewByOrg.get(org.id);
    out.people += stats?.user_count ?? 0;
    out.movements30d += stats?.movement_count_30d ?? 0;
    if (org.status === "suspended") {
      out.suspended += 1;
      continue;
    }
    out.active += 1;
    const health = subscriptionHealth(org, now).key;
    if (health === "overdue") out.overdue += 1;
    else if (health === "expiring") out.expiring += 1;
    else if (health === "no_date") out.noDate += 1;
    if (usageSignal(org, stats, now).key === "dormant") out.dormant += 1;
  }
  return out;
}

export function paymentsByOrg(payments: PaymentRow[]) {
  const map = new Map<string, { total: number; count: number; lastPaidOn: string | null; rows: PaymentRow[] }>();
  for (const payment of payments) {
    const entry = map.get(payment.organization_id) ?? { total: 0, count: 0, lastPaidOn: null, rows: [] };
    entry.total = round2(entry.total + payment.amount);
    entry.count += 1;
    entry.rows.push(payment);
    if (!entry.lastPaidOn || payment.paid_on > entry.lastPaidOn) entry.lastPaidOn = payment.paid_on;
    map.set(payment.organization_id, entry);
  }
  for (const entry of map.values()) {
    entry.rows.sort((a, b) => (a.paid_on === b.paid_on ? b.created_at.localeCompare(a.created_at) : b.paid_on.localeCompare(a.paid_on)));
  }
  return map;
}

// ---------------------------------------------------------------------------
// Activity feed wording
// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function describeEvent(
  event: Pick<EventRow, "kind" | "organization_name" | "details">,
  money: (value: number) => string,
): { title: string; detail: string | null; tone: Tone } {
  const d = asRecord(event.details);
  const name = event.organization_name ?? "A client";
  const months = typeof d.months === "number" ? d.months : null;
  const newEnd = typeof d.new_end === "string" ? d.new_end : null;

  switch (event.kind) {
    case "client.created":
      return { title: `${name} joined`, detail: "New client set up", tone: "ok" };
    case "client.suspended":
      return { title: `${name} suspended`, detail: "Everyone there is locked out", tone: "danger" };
    case "client.reactivated":
      return { title: `${name} reactivated`, detail: "Access restored", tone: "ok" };
    case "subscription.changed": {
      const from = typeof d.from === "string" ? formatDay(d.from) : "no date";
      const to = typeof d.to === "string" ? formatDay(d.to) : "no date";
      return { title: `${name} renewal date changed`, detail: `${from} to ${to}`, tone: "muted" };
    }
    case "payment.recorded": {
      const amount = typeof d.amount === "number" ? money(d.amount) : "A payment";
      const parts = [months ? plural(months, "month") : null, d.extended === false ? "date not changed" : newEnd ? `renews ${formatDay(newEnd)}` : null];
      return { title: `${amount} received from ${name}`, detail: parts.filter(Boolean).join(", ") || null, tone: "ok" };
    }
    case "payment.voided": {
      const amount = typeof d.amount === "number" ? money(d.amount) : "A payment";
      return { title: `${amount} payment voided for ${name}`, detail: newEnd ? `renewal date now ${formatDay(newEnd)}` : null, tone: "warn" };
    }
    default:
      return { title: `${name}: ${event.kind}`, detail: null, tone: "muted" };
  }
}
