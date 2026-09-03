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
};

async function getCallerRole(supabase: any, userId: string): Promise<AppRole | undefined> {
  const { data, error } = await supabase.from("user_roles").select("role").eq("user_id", userId).maybeSingle();
  if (error) throw new Error(error.message);
  return data?.role as AppRole | undefined;
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

    const callerRole = await getCallerRole(context.supabase, context.userId);
    const callerIsAdminOrAbove = callerRole === "admin" || callerRole === "super_admin";
    if (!callerIsAdminOrAbove) {
      throw new Error("Forbidden: only admins can create users.");
    }
    if ((data.role === "admin" || data.role === "super_admin") && callerRole !== "super_admin") {
      throw new Error("Forbidden: only a super admin can create admin accounts.");
    }

    // Service-role client - only ever imported here, never at module scope.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: data.password,
      email_confirm: true,
      user_metadata: { name },
    });
    if (createError) throw new Error(createError.message);

    const newUserId = created.user?.id;
    if (!newUserId) throw new Error("User creation did not return a user id.");

    // The on_auth_user_created trigger already inserted a default role row
    // (staff). Overwrite it with the role the caller actually chose.
    const { error: roleError } = await supabaseAdmin.from("user_roles").update({ role: data.role }).eq("user_id", newUserId);
    if (roleError) throw new Error(roleError.message);

    return { id: newUserId, email, name, role: data.role };
  });

export const removeUserFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: { userId: string }) => data)
  .handler(async ({ data, context }) => {
    const callerRole = await getCallerRole(context.supabase, context.userId);
    const callerIsAdminOrAbove = callerRole === "admin" || callerRole === "super_admin";
    if (!callerIsAdminOrAbove) {
      throw new Error("Forbidden: only admins can remove users.");
    }
    if (data.userId === context.userId) {
      throw new Error("You cannot remove your own account.");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const targetRole = await getCallerRole(supabaseAdmin, data.userId);
    if ((targetRole === "admin" || targetRole === "super_admin") && callerRole !== "super_admin") {
      throw new Error("Forbidden: only a super admin can remove an admin account.");
    }

    // Deletes auth.users, which cascades to profiles and user_roles. The
    // protect_last_super_admin trigger still fires during the cascade, so
    // this correctly refuses to remove the last super admin.
    const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(data.userId);
    if (deleteError) throw new Error(deleteError.message);

    return { id: data.userId };
  });
