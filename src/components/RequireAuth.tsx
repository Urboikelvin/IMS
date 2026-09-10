import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { PendingAccess } from "@/components/PendingAccess";
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

  const { isPending, isLoading: roleLoading } = useRole();

  if (state === "loading" || (state === "ok" && roleLoading)) {
    return (
      <div className="grid min-h-screen place-items-center bg-background">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (state === "ok" && isPending) {
    return <PendingAccess />;
  }

  return <AppShell>{children}</AppShell>;
}
