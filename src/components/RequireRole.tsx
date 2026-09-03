import { useEffect, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { RequireAuth } from "@/components/RequireAuth";
import { useRole, type AppRole } from "@/hooks/use-session";

/**
 * Gates a whole page behind a role check (not just individual controls).
 * Wraps RequireAuth, so it also handles the signed-out redirect.
 * Real enforcement always happens in Postgres RLS - this just keeps people
 * from landing on a page they have no access to in the first place.
 */
export function RequireRole({ allow, children }: { allow: AppRole[]; children: ReactNode }) {
  return (
    <RequireAuth>
      <RoleGate allow={allow}>{children}</RoleGate>
    </RequireAuth>
  );
}

function RoleGate({ allow, children }: { allow: AppRole[]; children: ReactNode }) {
  const navigate = useNavigate();
  const { role, isLoading } = useRole();
  const allowed = allow.includes(role);

  useEffect(() => {
    if (!isLoading && !allowed) {
      toast.error("You don't have access to that page.");
      navigate({ to: "/", replace: true });
    }
  }, [isLoading, allowed, navigate]);

  if (isLoading || !allowed) {
    return (
      <p className="px-1 py-8 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        {isLoading ? "Loading…" : "Redirecting…"}
      </p>
    );
  }

  return <>{children}</>;
}
