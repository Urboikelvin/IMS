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

export type AppRole = "super_admin" | "admin" | "staff";

export function useRole() {
  const { data: user } = useCurrentUser();
  const query = useQuery({
    queryKey: ["role", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return (data?.role ?? "staff") as AppRole;
    },
  });
  const role = query.data ?? "staff";
  return {
    role,
    // isAdmin means "admin-level access" (admin OR super_admin) - matches
    // how existing pages already use it to gate write access to items etc.
    isAdmin: role === "admin" || role === "super_admin",
    // isSuperAdmin gates the extra tier: creating/promoting admins.
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
