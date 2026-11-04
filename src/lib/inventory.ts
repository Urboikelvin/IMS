import { supabase } from "@/integrations/supabase/client";

// Supabase returns at most 1,000 rows per request by default, silently. Anything
// that must see EVERY row (dashboard totals, reports) has to page through.
const PAGE_SIZE = 1000;

type PageResult = { data: unknown[] | null; error: { message: string } | null };

/**
 * Runs a ranged query page by page until a short page comes back. Every query
 * passed in must have a stable, unique sort order (end it with `.order("id")`),
 * otherwise rows can repeat or be skipped between pages.
 */
export async function fetchAllRows<T>(page: (from: number, to: number) => PromiseLike<PageResult>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const chunk = (data ?? []) as T[];
    rows.push(...chunk);
    if (chunk.length < PAGE_SIZE) break;
  }
  return rows;
}

/** Today's date (or the given date) as YYYY-MM-DD in the user's OWN timezone. `toISOString()` gives the UTC date, which is "yesterday" for the first hours of the day in timezones ahead of UTC. */
export function localDateString(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Saves a Blob as a file. The link is attached to the page and the object URL is released late, because revoking it immediately can cancel the download in some browsers. */
export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export type Category = { id: string; name: string; department_id: string };

export type Item = {
  id: string;
  name: string;
  category_id: string | null;
  unit: string;
  reorder_threshold: number;
  unit_price: number;
  expiry_date: string | null;
  current_balance: number;
  department_id: string;
};

export type Movement = {
  id: string;
  item_id: string;
  quantity: number;
  date: string;
  notes: string | null;
  logged_by: string | null;
  created_at: string;
  supplier?: string | null;
  recipient?: string | null;
  recipient_department_id?: string | null;
  expiry_date?: string | null;
  remaining_quantity?: number;
};

export async function fetchCategories(): Promise<Category[]> {
  return fetchAllRows<Category>((from, to) =>
    supabase.from("categories").select("id, name, department_id").order("name").order("id").range(from, to),
  );
}

export async function fetchItems(): Promise<Item[]> {
  return fetchAllRows<Item>((from, to) =>
    supabase
      .from("items")
      .select("id, name, category_id, unit, reorder_threshold, unit_price, expiry_date, current_balance, department_id")
      .is("deleted_at", null)
      .order("name")
      .order("id")
      .range(from, to),
  );
}

export type Batch = {
  id: string;
  item_id: string;
  quantity: number;
  remaining_quantity: number;
  expiry_date: string | null;
  date: string;
};

/** Every batch (Stock In record) that still has stock left, soonest-expiring first — the "what's actually in stock" breakdown behind an item's single balance number. */
export async function fetchActiveBatches(): Promise<Batch[]> {
  return fetchAllRows<Batch>((from, to) =>
    supabase
      .from("stock_in")
      .select("id, item_id, quantity, remaining_quantity, expiry_date, date")
      .gt("remaining_quantity", 0)
      .is("deleted_at", null)
      .order("expiry_date", { ascending: true, nullsFirst: false })
      .order("date", { ascending: true })
      .order("id")
      .range(from, to),
  );
}

export async function fetchStockIn(): Promise<Movement[]> {
  return fetchAllRows<Movement>((from, to) =>
    supabase
      .from("stock_in")
      .select("id, item_id, quantity, date, expiry_date, remaining_quantity, supplier, notes, logged_by, created_at")
      .is("deleted_at", null)
      .order("date", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id")
      .range(from, to),
  );
}

export async function fetchStockOut(): Promise<Movement[]> {
  return fetchAllRows<Movement>((from, to) =>
    supabase
      .from("stock_out")
      .select("id, item_id, quantity, date, recipient, recipient_department_id, notes, logged_by, created_at")
      .is("deleted_at", null)
      .order("date", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id")
      .range(from, to),
  );
}

export async function fetchProfiles(): Promise<{ id: string; name: string; email: string }[]> {
  return fetchAllRows<{ id: string; name: string; email: string }>((from, to) =>
    supabase.from("profiles").select("id, name, email").order("id").range(from, to),
  );
}

export type UserWithRole = {
  id: string;
  name: string;
  email: string;
  role: "super_admin" | "head_staff" | "admin" | "staff" | null;
  department_id: string | null;
};

export async function fetchUsersWithRoles(): Promise<UserWithRole[]> {
  const [profiles, roles] = await Promise.all([
    fetchAllRows<{ id: string; name: string; email: string }>((from, to) =>
      supabase.from("profiles").select("id, name, email").order("name").order("id").range(from, to),
    ),
    fetchAllRows<{ user_id: string; role: UserWithRole["role"]; department_id: string | null }>((from, to) =>
      supabase.from("user_roles").select("user_id, role, department_id").order("user_id").range(from, to),
    ),
  ]);
  const roleByUser = new Map(roles.map((r) => [r.user_id, r]));
  return profiles.map((p) => {
    const r = roleByUser.get(p.id);
    return { ...p, role: r?.role ?? null, department_id: r?.department_id ?? null };
  });
}

export async function logAudit(action: string, entity: string, entityId: string | null, details: unknown) {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return;
  await supabase.from("audit_log").insert({
    user_id: userData.user.id,
    action,
    entity,
    entity_id: entityId,
    details: details as never,
  });
}

export function isLowStock(item: Item) {
  return item.current_balance <= item.reorder_threshold;
}

export function expiryStatus(item: Item): "none" | "soon" | "expired" {
  if (!item.expiry_date) return "none";
  const days = (new Date(item.expiry_date).getTime() - Date.now()) / 86_400_000;
  if (days < 0) return "expired";
  if (days <= 60) return "soon";
  return "none";
}

export function formatMoney(value: number) {
  return new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

export function downloadCsv(filename: string, rows: (string | number)[][]) {
  const csv = rows
    .map((row) =>
      row
        .map((cell) => {
          // Text that starts with = + - @ is run as a formula by Excel/Sheets; a leading
          // apostrophe makes it plain text. Real numbers are left alone.
          const raw = String(cell ?? "");
          const text = typeof cell === "string" && /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
          return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
        })
        .join(","),
    )
    .join("\n");
  downloadBlob(filename, new Blob([csv], { type: "text/csv;charset=utf-8;" }));
}

export type AuditEntry = {
  id: string;
  user_id: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  details: unknown;
  created_at: string;
};

export async function fetchAuditLog(limit = 300): Promise<AuditEntry[]> {
  const { data, error } = await supabase
    .from("audit_log")
    .select("id, user_id, action, entity, entity_id, details, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as AuditEntry[];
}

export function errorMessage(error: unknown, fallback: string): string {
  // Native JS Errors have .message; Supabase/Postgrest errors are plain
  // objects with a .message field too but aren't `instanceof Error`, so
  // checking for the shape (not the class) surfaces real database errors
  // — e.g. the "Insufficient stock: only X available" trigger message —
  // instead of silently replacing them with a generic fallback string.
  if (error && typeof error === "object" && "message" in error && typeof (error as { message: unknown }).message === "string") {
    return (error as { message: string }).message;
  }
  return fallback;
}

