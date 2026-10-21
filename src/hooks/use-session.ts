import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useCurrentUser() {
  return useQuery({
    queryKey: ["current-user"],
    queryFn: async () => {
      const { data } = await supabase.auth.getUser();
      return data.user ?? null;
    },
  });
}

export type AppRole = "super_admin" | "head_staff" | "admin" | "staff";

export type Organization = { id: string; name: string; status: "active" | "suspended" };

/**
 * Who this person is and where they belong.
 *
 * - `role` is `null` for a real account that hasn't been given access yet
 *   ("pending"). That is a valid state, not an error.
 * - Every person belongs to exactly one `organization` (a client center).
 * - `isPlatformAdmin` is the vendor-level identity that manages clients. It is
 *   independent of any organization role.
 *
 * Real enforcement is always Postgres row-level security — these flags only
 * decide which screens and controls render.
 */
export function useRole() {
  const userQuery = useCurrentUser();
  const user = userQuery.data;

  const roleQuery = useQuery({
    queryKey: ["role", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("role, department_id, organization_id")
        .eq("user_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data
        ? {
            role: data.role as AppRole,
            departmentId: data.department_id as string | null,
            organizationId: data.organization_id as string | null,
          }
        : { role: null, departmentId: null, organizationId: null };
    },
  });

  const platformQuery = useQuery({
    queryKey: ["platform-admin", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase.from("platform_admins").select("user_id").eq("user_id", user!.id).maybeSingle();
      if (error) throw error;
      return data !== null;
    },
  });

  const organizationId = roleQuery.data?.organizationId ?? null;
  const orgQuery = useQuery({
    queryKey: ["organization", organizationId],
    enabled: !!organizationId,
    queryFn: async (): Promise<Organization | null> => {
      const { data, error } = await supabase.from("organizations").select("id, name, status").eq("id", organizationId!).maybeSingle();
      if (error) throw error;
      return data ? { id: data.id, name: data.name, status: data.status === "suspended" ? "suspended" : "active" } : null;
    },
  });

  // The user query is part of "loading": without it, a hard refresh could run
  // the role gate before the user is known and wrongly bounce people away.
  const isLoading = userQuery.isLoading || roleQuery.isLoading || platformQuery.isLoading || orgQuery.isLoading;

  const role = roleQuery.data?.role ?? null;
  const departmentId = roleQuery.data?.departmentId ?? null;
  const isPlatformAdmin = platformQuery.data === true;

  return {
    role,
    departmentId,
    organizationId,
    organization: orgQuery.data ?? null,
    isPlatformAdmin,
    // The person's organization has been switched off by the platform owner.
    isSuspended: orgQuery.data?.status === "suspended",
    // A real account with no role yet — waiting for an admin to grant access.
    isPending: !isLoading && !!user && roleQuery.data !== undefined && role === null && !isPlatformAdmin,
    // Write access to at least their own department.
    isAdmin: role === "admin" || role === "head_staff" || role === "super_admin",
    // Organization-wide: sees/edits every department, manages user roles.
    isHeadStaffOrAbove: role === "head_staff" || role === "super_admin",
    // Top of an organization: also manages the department structure itself.
    isSuperAdmin: role === "super_admin",
    isLoading,
  };
}

export function useProfile() {
  const { data: user } = useCurrentUser();
  return useQuery({
    queryKey: ["profile", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, name, email")
        .eq("id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

export type Department = { id: string; name: string };

export function useDepartments() {
  return useQuery({
    queryKey: ["departments"],
    queryFn: async (): Promise<Department[]> => {
      const { data, error } = await supabase.from("departments").select("id, name").order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
}
