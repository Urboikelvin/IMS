// Admin-only user management. Runs as TanStack Start server functions so the
// privileged (service-role) Supabase client never reaches the browser.
//
// NOTE: this file is imported from client route code (users.tsx), so it must
// NOT top-level import client.server.ts (service-role client) - that module
// is only safe to import inside the server-only handler body below.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { AppRole } from "@/hooks/use-session";

type CreateUserInput = {
  name: string;
  email: string;
  password: string;
  role: AppRole;
  departmentId: string | null;
};

function needsDepartment(role: AppRole) {
  return role === "admin" || role === "staff";
}

async function getCaller(supabase: any, userId: string): Promise<{ role: AppRole | undefined }> {
  const { data, error } = await supabase.from("user_roles").select("role").eq("user_id", userId).maybeSingle();
  if (error) throw new Error(error.message);
  return { role: data?.role as AppRole | undefined };
}

function isHeadStaffOrAbove(role: AppRole | undefined) {
  return role === "head_staff" || role === "super_admin";
}

// Rate limiting for sensitive admin actions (creating/removing users). This
// protects against a compromised or malicious admin/super_admin session
// hammering these endpoints — normal Supabase Auth rate limits don't cover
// custom server functions like these at all.
const RATE_LIMIT_WINDOW_MINUTES = 10;
const RATE_LIMIT_MAX_ACTIONS = 10;

async function enforceRateLimit(supabaseAdmin: any, userId: string, action: string) {
  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MINUTES * 60_000).toISOString();
  const { count, error } = await supabaseAdmin
    .from("rate_limit_log")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("action", action)
    .gte("created_at", since);
  if (error) throw new Error(error.message);
  if ((count ?? 0) >= RATE_LIMIT_MAX_ACTIONS) {
    throw new Error(`Too many user-management actions in a short time. Please wait a few minutes and try again.`);
  }
  const { error: logError } = await supabaseAdmin.from("rate_limit_log").insert({ user_id: userId, action });
  if (logError) throw new Error(logError.message);
}

export const createUserFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: CreateUserInput) => data)
  .handler(async ({ data, context }) => {
    const email = data.email.trim().toLowerCase();
    const name = data.name.trim() || email.split("@")[0];
    if (!email || data.password.length < 6) {
      throw new Error("A valid email and a password of at least 6 characters are required.");
    }

    const caller = await getCaller(context.supabase, context.userId);
    if (!isHeadStaffOrAbove(caller.role)) {
      throw new Error("Forbidden: only Head Staff or Super Admin can create users.");
    }
    if (needsDepartment(data.role) && !data.departmentId) {
      throw new Error("A department is required for Admin and Staff roles.");
    }

    // Service-role client - only ever imported here, never at module scope.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    await enforceRateLimit(supabaseAdmin, context.userId, "user_create");

    const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: data.password,
      email_confirm: true,
      user_metadata: { name },
    });
    if (createError) throw new Error(createError.message);

    const newUserId = created.user?.id;
    if (!newUserId) throw new Error("User creation did not return a user id.");

    // The on_auth_user_created trigger no longer inserts a default role row
    // for anyone but the very first-ever account, so upsert explicitly here.
    const { error: roleError } = await supabaseAdmin
      .from("user_roles")
      .upsert(
        { user_id: newUserId, role: data.role, department_id: needsDepartment(data.role) ? data.departmentId : null },
        { onConflict: "user_id" },
      );
    if (roleError) throw new Error(roleError.message);

    return { id: newUserId, email, name, role: data.role };
  });

export const removeUserFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: { userId: string }) => data)
  .handler(async ({ data, context }) => {
    const caller = await getCaller(context.supabase, context.userId);
    if (!isHeadStaffOrAbove(caller.role)) {
      throw new Error("Forbidden: only Head Staff or Super Admin can remove users.");
    }
    if (data.userId === context.userId) {
      throw new Error("You cannot remove your own account.");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    await enforceRateLimit(supabaseAdmin, context.userId, "user_remove");

    // Deletes auth.users, which cascades to profiles and user_roles. The
    // protect_last_super_admin trigger still fires during the cascade, so
    // this correctly refuses to remove the last super admin.
    const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(data.userId);
    if (deleteError) throw new Error(deleteError.message);

    return { id: data.userId };
  });
