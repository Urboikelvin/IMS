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

/**
 * A person's role/department state. `role` is `null` for a real account that
 * exists but hasn't been assigned a department + role yet ("pending") — that
 * is a distinct, valid state, not an error and not the same as "staff".
 */
export function useRole() {
  const { data: user } = useCurrentUser();
  const query = useQuery({
    queryKey: ["role", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("role, department_id")
        .eq("user_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data
        ? { role: data.role as AppRole, departmentId: data.department_id as string | null }
        : { role: null, departmentId: null };
    },
  });

  const role = query.data?.role ?? null;
  const departmentId = query.data?.departmentId ?? null;

  return {
    role,
    departmentId,
    // A real account with no role/department assigned yet — waiting on a
    // head staff / super admin to grant access.
    isPending: !query.isLoading && query.data !== undefined && role === null,
    // "Has write access to at least their own department." Real enforcement
    // is always in Postgres RLS — this only gates which controls render.
    isAdmin: role === "admin" || role === "head_staff" || role === "super_admin",
    // Company-wide: sees/edits every department, manages user roles.
    isHeadStaffOrAbove: role === "head_staff" || role === "super_admin",
    // The one tier above even Head Staff: department structure itself.
    isSuperAdmin: role === "super_admin",
    isLoading: query.isLoading,
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
