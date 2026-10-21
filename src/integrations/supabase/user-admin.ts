// Privileged operations. These run as TanStack Start server functions so the
// service-role Supabase client never reaches the browser.
//
// TENANCY RULES enforced here (on top of the database's row-level security):
//   - The caller's organization is always looked up on the server from their
//     verified identity. It is never accepted from the client.
//   - Tenant admins can only create/remove people inside their OWN organization.
//   - Only platform admins can onboard a new client organization.
//
// NOTE: this file is imported from client route code, so it must NOT top-level
// import client.server.ts (the service-role client). That module is only
// imported inside the server-only handler bodies below.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { AppRole } from "@/hooks/use-session";

type AdminClient = typeof import("@/integrations/supabase/client.server").supabaseAdmin;

const MIN_PASSWORD_LENGTH = 8;

type CreateUserInput = {
  name: string;
  email: string;
  password: string;
  role: AppRole;
  departmentId: string | null;
};

type CreateOrganizationInput = {
  name: string;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  subscriptionEndsOn: string | null;
  adminName: string;
  adminEmail: string;
  adminPassword: string;
};

function needsDepartment(role: AppRole) {
  return role === "admin" || role === "staff";
}

function isHeadStaffOrAbove(role: AppRole | undefined) {
  return role === "head_staff" || role === "super_admin";
}

function clean(value: string | null | undefined) {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

function looksLikeEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/** Who is calling, which organization they belong to, and whether it is active. */
async function getCaller(admin: AdminClient, userId: string) {
  const { data: roleRow, error } = await admin
    .from("user_roles")
    .select("role, organization_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!roleRow) return { role: undefined, organizationId: null as string | null, orgActive: false };

  const { data: org, error: orgError } = await admin
    .from("organizations")
    .select("status")
    .eq("id", roleRow.organization_id)
    .maybeSingle();
  if (orgError) throw new Error(orgError.message);

  return {
    role: roleRow.role as AppRole,
    organizationId: roleRow.organization_id as string | null,
    orgActive: org?.status === "active",
  };
}

async function requireOrgLeader(admin: AdminClient, userId: string) {
  const caller = await getCaller(admin, userId);
  if (!isHeadStaffOrAbove(caller.role) || !caller.organizationId) {
    throw new Error("Forbidden: only Head Staff or Super Admin can manage users.");
  }
  if (!caller.orgActive) {
    throw new Error("Your organization's access is currently suspended.");
  }
  return { role: caller.role as AppRole, organizationId: caller.organizationId };
}

async function requirePlatformAdmin(admin: AdminClient, userId: string) {
  const { data, error } = await admin.from("platform_admins").select("user_id").eq("user_id", userId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: platform administrators only.");
}

// Rate limiting for sensitive actions. Protects against a compromised session
// hammering these endpoints — Supabase's own Auth limits don't cover custom
// server functions.
const RATE_LIMIT_WINDOW_MINUTES = 10;
const RATE_LIMIT_MAX_ACTIONS = 10;

async function enforceRateLimit(admin: AdminClient, userId: string, action: string) {
  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MINUTES * 60_000).toISOString();
  const { count, error } = await admin
    .from("rate_limit_log")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("action", action)
    .gte("created_at", since);
  if (error) throw new Error(error.message);
  if ((count ?? 0) >= RATE_LIMIT_MAX_ACTIONS) {
    throw new Error("Too many actions in a short time. Please wait a few minutes and try again.");
  }
  const { error: logError } = await admin.from("rate_limit_log").insert({ user_id: userId, action });
  if (logError) throw new Error(logError.message);
}

export const createUserFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: CreateUserInput) => data)
  .handler(async ({ data, context }) => {
    const email = data.email.trim().toLowerCase();
    const name = data.name.trim() || email.split("@")[0];
    if (!looksLikeEmail(email) || data.password.length < MIN_PASSWORD_LENGTH) {
      throw new Error(`A valid email and a password of at least ${MIN_PASSWORD_LENGTH} characters are required.`);
    }
    if (needsDepartment(data.role) && !data.departmentId) {
      throw new Error("A department is required for Admin and Staff roles.");
    }

    // Service-role client — only ever imported here, never at module scope.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const caller = await requireOrgLeader(supabaseAdmin, context.userId);

    // The department must belong to the caller's own organization.
    let departmentId: string | null = null;
    if (needsDepartment(data.role)) {
      const { data: dept, error: deptError } = await supabaseAdmin
        .from("departments")
        .select("id")
        .eq("id", data.departmentId as string)
        .eq("organization_id", caller.organizationId)
        .maybeSingle();
      if (deptError) throw new Error(deptError.message);
      if (!dept) throw new Error("Choose a department from your own organization.");
      departmentId = dept.id;
    }

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

    // Sign-ups no longer get a default role, so grant it explicitly — tied to
    // the CALLER's organization, never one supplied by the client.
    const { error: roleError } = await supabaseAdmin
      .from("user_roles")
      .upsert(
        { user_id: newUserId, role: data.role, department_id: departmentId, organization_id: caller.organizationId },
        { onConflict: "user_id" },
      );
    if (roleError) {
      // Don't leave an account that can sign in but belongs nowhere.
      await supabaseAdmin.auth.admin.deleteUser(newUserId);
      throw new Error(roleError.message);
    }

    return { id: newUserId, email, name, role: data.role };
  });

export const removeUserFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: { userId: string }) => data)
  .handler(async ({ data, context }) => {
    if (data.userId === context.userId) {
      throw new Error("You cannot remove your own account.");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const caller = await requireOrgLeader(supabaseAdmin, context.userId);

    // Only people inside the caller's own organization can be removed. Anything
    // else gets the same "not found" so ids from other clients can't be probed.
    const { data: target, error: targetError } = await supabaseAdmin
      .from("user_roles")
      .select("organization_id")
      .eq("user_id", data.userId)
      .maybeSingle();
    if (targetError) throw new Error(targetError.message);
    if (!target || target.organization_id !== caller.organizationId) {
      throw new Error("That user was not found in your organization.");
    }

    // Removing a person deletes their whole login, so a platform admin who also
    // happens to sit in this organization must be protected from it.
    const { data: protectedAdmin, error: protectedError } = await supabaseAdmin
      .from("platform_admins")
      .select("user_id")
      .eq("user_id", data.userId)
      .maybeSingle();
    if (protectedError) throw new Error(protectedError.message);
    if (protectedAdmin) throw new Error("This account is a platform administrator and can't be removed from here.");

    await enforceRateLimit(supabaseAdmin, context.userId, "user_remove");

    // Deletes auth.users, cascading to profiles and user_roles. The per-
    // organization "last super admin" trigger still fires during the cascade.
    const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(data.userId);
    if (deleteError) throw new Error(deleteError.message);

    return { id: data.userId };
  });

/**
 * Onboard a new client: organization + default department + first Super Admin.
 * All-or-nothing — if any step fails, everything created so far is removed so
 * a failed attempt can simply be retried.
 */
export const createOrganizationFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: CreateOrganizationInput) => data)
  .handler(async ({ data, context }) => {
    const name = data.name.trim();
    const adminEmail = data.adminEmail.trim().toLowerCase();
    const adminName = data.adminName.trim() || adminEmail.split("@")[0];
    if (!name) throw new Error("Client name is required.");
    if (!looksLikeEmail(adminEmail)) throw new Error("A valid email is required for the first administrator.");
    if (data.adminPassword.length < MIN_PASSWORD_LENGTH) {
      throw new Error(`The temporary password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await requirePlatformAdmin(supabaseAdmin, context.userId);
    await enforceRateLimit(supabaseAdmin, context.userId, "org_create");

    const { data: org, error: orgError } = await supabaseAdmin
      .from("organizations")
      .insert({
        name,
        contact_name: clean(data.contactName),
        contact_email: clean(data.contactEmail),
        contact_phone: clean(data.contactPhone),
        subscription_ends_on: clean(data.subscriptionEndsOn),
      })
      .select("id")
      .single();
    if (orgError) {
      throw new Error(orgError.code === "23505" ? "A client with that name already exists." : orgError.message);
    }

    let adminUserId: string | null = null;
    try {
      const { error: deptError } = await supabaseAdmin
        .from("departments")
        .insert({ name: "General", organization_id: org.id });
      if (deptError) throw new Error(deptError.message);

      const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email: adminEmail,
        password: data.adminPassword,
        email_confirm: true,
        user_metadata: { name: adminName },
      });
      if (createError) throw new Error(createError.message);
      adminUserId = created.user?.id ?? null;
      if (!adminUserId) throw new Error("Could not create the first administrator.");

      const { error: roleError } = await supabaseAdmin
        .from("user_roles")
        .insert({ user_id: adminUserId, role: "super_admin", department_id: null, organization_id: org.id });
      if (roleError) throw new Error(roleError.message);

      await supabaseAdmin.from("audit_log").insert({
        user_id: context.userId,
        organization_id: org.id,
        action: "organization.create",
        entity: "organizations",
        entity_id: org.id,
        details: { name } as never,
      });

      return { id: org.id, name, adminEmail };
    } catch (error) {
      // Roll back everything this attempt created.
      if (adminUserId) await supabaseAdmin.auth.admin.deleteUser(adminUserId);
      await supabaseAdmin.from("departments").delete().eq("organization_id", org.id);
      await supabaseAdmin.from("organizations").delete().eq("id", org.id);
      throw error;
    }
  });
