// supabase/functions/low-stock-alert/index.ts
//
// Called by a Postgres trigger (via pg_net) when an item's balance drops to or
// below its reorder threshold. Emails ONLY the people who should hear about it:
//   - Super Admins and Head Staff of the item's own organization
//   - the Admin(s) of the item's own department
// Nobody from any other client organization is ever contacted.
//
// Required secrets (Supabase Dashboard → Edge Functions → Secrets):
//   RESEND_API_KEY         your Resend API key
//   LOW_STOCK_FROM_EMAIL   the "from" address (must be on a domain verified in
//                          Resend — the sandbox address can only email you)
//   LOW_STOCK_HOOK_SECRET  must match the secret baked into the database trigger
//
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically.

import { createClient } from "npm:@supabase/supabase-js@2";

const RESEND_DELAY_MS = 600; // stay under Resend's default 2 requests/second

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const expectedSecret = Deno.env.get("LOW_STOCK_HOOK_SECRET") ?? "";
  if (!expectedSecret || (req.headers.get("x-hook-secret") ?? "") !== expectedSecret) {
    return new Response("Unauthorized", { status: 401 });
  }

  let payload: {
    item_id?: string;
    item_name?: string;
    current_balance?: number;
    reorder_threshold?: number;
    unit?: string;
  };
  try {
    payload = await req.json();
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }

  const { item_id, item_name, current_balance, reorder_threshold, unit } = payload;
  if (!item_id || !item_name || current_balance === undefined || reorder_threshold === undefined) {
    return new Response("Missing required fields", { status: 400 });
  }

  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  const fromEmail = Deno.env.get("LOW_STOCK_FROM_EMAIL") ?? "onboarding@resend.dev";
  if (!resendApiKey) return new Response("RESEND_API_KEY is not configured", { status: 500 });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // item → department → organization. Everything below is scoped by these ids,
  // taken from the database, not from anything the caller could influence.
  const { data: item, error: itemError } = await supabase
    .from("items")
    .select("department_id")
    .eq("id", item_id)
    .maybeSingle();
  if (itemError || !item) return new Response("Item not found", { status: 404 });

  const { data: dept, error: deptError } = await supabase
    .from("departments")
    .select("name, organization_id")
    .eq("id", item.department_id)
    .maybeSingle();
  if (deptError || !dept) return new Response("Department not found", { status: 404 });

  const { data: org } = await supabase.from("organizations").select("name, status").eq("id", dept.organization_id).maybeSingle();
  if (!org || org.status !== "active") return new Response("Organization inactive — nothing sent", { status: 200 });

  const { data: roleRows, error: roleError } = await supabase
    .from("user_roles")
    .select("user_id, role, department_id")
    .eq("organization_id", dept.organization_id)
    .in("role", ["super_admin", "head_staff", "admin"]);
  if (roleError) return new Response(`Failed to load recipients: ${roleError.message}`, { status: 500 });

  const recipientIds = (roleRows ?? [])
    .filter((r) => r.role !== "admin" || r.department_id === item.department_id)
    .map((r) => r.user_id);
  if (recipientIds.length === 0) return new Response("No recipients to notify", { status: 200 });

  const { data: profiles, error: profileError } = await supabase.from("profiles").select("email").in("id", recipientIds);
  if (profileError) return new Response(`Failed to load recipient emails: ${profileError.message}`, { status: 500 });

  const emails = Array.from(new Set((profiles ?? []).map((p) => (p.email ?? "").trim().toLowerCase()).filter(Boolean)));
  if (emails.length === 0) return new Response("No recipient emails on file", { status: 200 });

  const unitText = escapeHtml(unit ?? "");
  const html = `
    <div style="font-family: -apple-system, Helvetica, Arial, sans-serif; max-width: 480px; margin: 0 auto;">
      <h2 style="margin-bottom: 4px;">Low stock alert</h2>
      <p style="color:#555; margin-top:0;">${escapeHtml(org.name)} &middot; ${escapeHtml(dept.name)}</p>
      <table style="width:100%; border-collapse: collapse; margin-top: 16px;">
        <tr>
          <td style="padding:8px 0; color:#888;">Item</td>
          <td style="padding:8px 0; font-weight:bold;">${escapeHtml(item_name)}</td>
        </tr>
        <tr>
          <td style="padding:8px 0; color:#888;">Current quantity</td>
          <td style="padding:8px 0; font-weight:bold; color:#dc2626;">${current_balance} ${unitText}</td>
        </tr>
        <tr>
          <td style="padding:8px 0; color:#888;">Reorder threshold</td>
          <td style="padding:8px 0;">${reorder_threshold} ${unitText}</td>
        </tr>
      </table>
      <p style="margin-top:24px; color:#555; font-size:14px;">
        This item has dropped to or below its reorder threshold. You'll only get one email per
        low-stock event &mdash; restocking above the threshold resets the alert.
      </p>
    </div>
  `.trim();

  // One email per person: a failure for one recipient never blocks the others,
  // and nobody sees anyone else's address.
  let sent = 0;
  const failures: string[] = [];
  for (let i = 0; i < emails.length; i++) {
    if (i > 0) await new Promise((resolve) => setTimeout(resolve, RESEND_DELAY_MS));
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: fromEmail, to: [emails[i]], subject: `Low stock: ${item_name} (${org.name})`, html }),
    });
    if (res.ok) sent++;
    else failures.push(`${emails[i]}: ${(await res.text()).slice(0, 200)}`);
  }

  if (sent === 0) return new Response(`Resend rejected every recipient: ${failures.join(" | ")}`, { status: 502 });
  return new Response(JSON.stringify({ sent, failed: failures.length }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
