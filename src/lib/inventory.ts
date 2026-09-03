import { supabase } from "@/integrations/supabase/client";

export type Category = { id: string; name: string };

export type Item = {
  id: string;
  name: string;
  category_id: string | null;
  unit: string;
  reorder_threshold: number;
  unit_price: number;
  expiry_date: string | null;
  current_balance: number;
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
};

export async function fetchCategories(): Promise<Category[]> {
  const { data, error } = await supabase.from("categories").select("id, name").order("name");
  if (error) throw error;
  return data ?? [];
}

export async function fetchItems(): Promise<Item[]> {
  const { data, error } = await supabase
    .from("items")
    .select("id, name, category_id, unit, reorder_threshold, unit_price, expiry_date, current_balance")
    .order("name");
  if (error) throw error;
  return (data ?? []) as Item[];
}

export async function fetchStockIn(): Promise<Movement[]> {
  const { data, error } = await supabase
    .from("stock_in")
    .select("id, item_id, quantity, date, supplier, notes, logged_by, created_at")
    .order("date", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Movement[];
}

export async function fetchStockOut(): Promise<Movement[]> {
  const { data, error } = await supabase
    .from("stock_out")
    .select("id, item_id, quantity, date, recipient, notes, logged_by, created_at")
    .order("date", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Movement[];
}

export async function fetchProfiles(): Promise<{ id: string; name: string; email: string }[]> {
  const { data, error } = await supabase.from("profiles").select("id, name, email");
  if (error) throw error;
  return data ?? [];
}

export type UserWithRole = { id: string; name: string; email: string; role: "super_admin" | "admin" | "staff" };

export async function fetchUsersWithRoles(): Promise<UserWithRole[]> {
  const [{ data: profiles, error: profilesError }, { data: roles, error: rolesError }] = await Promise.all([
    supabase.from("profiles").select("id, name, email").order("name"),
    supabase.from("user_roles").select("user_id, role"),
  ]);
  if (profilesError) throw profilesError;
  if (rolesError) throw rolesError;
  const roleByUser = new Map((roles ?? []).map((r) => [r.user_id, r.role]));
  return (profiles ?? []).map((p) => ({ ...p, role: roleByUser.get(p.id) ?? "staff" }));
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
          const text = String(cell ?? "");
          return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
        })
        .join(","),
    )
    .join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
