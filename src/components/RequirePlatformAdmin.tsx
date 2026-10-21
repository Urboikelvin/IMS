import { useEffect, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { RequireAuth } from "@/components/RequireAuth";
import { useRole } from "@/hooks/use-session";

/**
 * Gates the clients console to platform admins. Real enforcement is in
 * Postgres (only platform admins can read the organizations list or the
 * overview function) — this just keeps everyone else off the page.
 */
export function RequirePlatformAdmin({ children }: { children: ReactNode }) {
  return (
    <RequireAuth>
      <PlatformGate>{children}</PlatformGate>
    </RequireAuth>
  );
}

function PlatformGate({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const { isPlatformAdmin, isLoading } = useRole();

  useEffect(() => {
    if (!isLoading && !isPlatformAdmin) {
      toast.error("You don't have access to that page.");
      navigate({ to: "/", replace: true });
    }
  }, [isLoading, isPlatformAdmin, navigate]);

  if (isLoading || !isPlatformAdmin) {
    return (
      <p className="px-1 py-8 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        {isLoading ? "Loading…" : "Redirecting…"}
      </p>
    );
  }
  return <>{children}</>;
}
