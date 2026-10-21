import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { PendingAccess } from "@/components/PendingAccess";
import { SuspendedAccess } from "@/components/SuspendedAccess";
import { useRole } from "@/hooks/use-session";

export function RequireAuth({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [state, setState] = useState<"loading" | "ok">("loading");

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      if (data.session) setState("ok");
      else navigate({ to: "/auth", replace: true });
    });
    return () => {
      active = false;
    };
  }, [navigate]);

  const { isPending, isSuspended, isPlatformAdmin, role, isLoading } = useRole();

  // A platform admin with no organization role has nothing to see outside the
  // clients console, so send them straight there.
  const platformOnly = isPlatformAdmin && role === null;
  const onPlatformPath = typeof window !== "undefined" && window.location.pathname.startsWith("/platform");

  useEffect(() => {
    if (state === "ok" && !isLoading && platformOnly && !onPlatformPath) {
      navigate({ to: "/platform", replace: true });
    }
  }, [state, isLoading, platformOnly, onPlatformPath, navigate]);

  if (state === "loading" || isLoading || (platformOnly && !onPlatformPath)) {
    return (
      <div className="grid min-h-screen place-items-center bg-background">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Loading…</p>
      </div>
    );
  }

  // The platform owner is never locked out by a client's suspension.
  if (isSuspended && !isPlatformAdmin) return <SuspendedAccess />;
  if (isPending) return <PendingAccess />;

  return <AppShell>{children}</AppShell>;
}
