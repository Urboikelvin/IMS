// supabase/functions/low-stock-alert/index.ts
//
// Called by a Postgres trigger (via pg_net) whenever an item's balance
// crosses at-or-below its reorder threshold. Looks up every admin /
// super_admin's email and sends them one notification email via Resend.
//
// Required secrets (set these in Supabase Dashboard → Edge Functions →
// low-stock-alert → Secrets, or via `supabase secrets set`):
//   RESEND_API_KEY        - your Resend API key
//   LOW_STOCK_FROM_EMAIL   - the "from" address, e.g. alerts@yourdomain.com
//                            (must be on a domain verified in Resend, or use
//                            the Resend sandbox address for testing)
//   LOW_STOCK_HOOK_SECRET  - a random string you make up; must match the
//                            `app.settings.low_stock_hook_secret` value set
//                            on the database
//
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are automatically provided to
// every Edge Function by Supabase — you don't set those yourself.

import { createClient } from "npm:@supabase/supabase-js@2";

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const expectedSecret = Deno.env.get("LOW_STOCK_HOOK_SECRET") ?? "";
  const providedSecret = req.headers.get("x-hook-secret") ?? "";
  if (!expectedSecret || providedSecret !== expectedSecret) {
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

  const { item_name, current_balance, reorder_threshold, unit } = payload;
  if (!item_name || current_balance === undefined || reorder_threshold === undefined) {
    return new Response("Missing required fields", { status: 400 });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  const fromEmail = Deno.env.get("LOW_STOCK_FROM_EMAIL") ?? "onboarding@resend.dev";

  if (!resendApiKey) {
    return new Response("RESEND_API_KEY is not configured", { status: 500 });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // Every admin-or-above's user id
  const { data: roleRows, error: roleErr } = await supabase
    .from("user_roles")
    .select("user_id, role")
    .in("role", ["admin", "super_admin"]);

  if (roleErr) {
    return new Response(`Failed to load admin roles: ${roleErr.message}`, { status: 500 });
  }
  const adminIds = (roleRows ?? []).map((r) => r.user_id);
  if (adminIds.length === 0) {
    return new Response("No admins to notify", { status: 200 });
  }

  const { data: profiles, error: profileErr } = await supabase
    .from("profiles")
    .select("id, email, name")
    .in("id", adminIds);

  if (profileErr) {
    return new Response(`Failed to load admin emails: ${profileErr.message}`, { status: 500 });
  }
  const adminEmails = (profiles ?? []).map((p) => p.email).filter((e): e is string => !!e);
  if (adminEmails.length === 0) {
    return new Response("No admin emails on file", { status: 200 });
  }

  const subject = `Low stock: ${item_name}`;
  const html = `
    <div style="font-family: -apple-system, Helvetica, Arial, sans-serif; max-width: 480px; margin: 0 auto;">
      <h2 style="margin-bottom: 4px;">Low stock alert</h2>
      <p style="color:#555; margin-top:0;">Maslow Inventory Hub</p>
      <table style="width:100%; border-collapse: collapse; margin-top: 16px;">
        <tr>
          <td style="padding:8px 0; color:#888;">Item</td>
          <td style="padding:8px 0; font-weight:bold;">${escapeHtml(item_name)}</td>
        </tr>
        <tr>
          <td style="padding:8px 0; color:#888;">Current quantity</td>
          <td style="padding:8px 0; font-weight:bold; color:#dc2626;">${current_balance} ${escapeHtml(unit ?? "")}</td>
        </tr>
        <tr>
          <td style="padding:8px 0; color:#888;">Reorder threshold</td>
          <td style="padding:8px 0;">${reorder_threshold} ${escapeHtml(unit ?? "")}</td>
        </tr>
      </table>
      <p style="margin-top:24px; color:#555; font-size:14px;">
        This item has dropped to or below its reorder threshold. You'll only
        get one email per low-stock event — restocking above the threshold
        resets the alert for next time.
      </p>
    </div>
  `.trim();

  const resendRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: fromEmail,
      to: adminEmails,
      subject,
      html,
    }),
  });

  if (!resendRes.ok) {
    const body = await resendRes.text();
    return new Response(`Resend error: ${body}`, { status: 502 });
  }

  return new Response(JSON.stringify({ sent_to: adminEmails.length }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
