import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useProfile } from "@/hooks/use-session";

export function PendingAccess() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: profile } = useProfile();

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="grid min-h-screen place-items-center bg-background px-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-8 text-center">
        <div className="mx-auto mb-4 grid size-10 place-items-center rounded-lg bg-primary font-bold text-primary-foreground">
          M
        </div>
        <h1 className="text-lg font-bold tracking-tight">Waiting for access</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your account ({profile?.email ?? "…"}) is created, but hasn't been assigned to a department yet. Ask a
          Head Staff or Super Admin to grant you access from the Users page — you'll see the dashboard as soon as
          that's done.
        </p>
        <button
          onClick={signOut}
          className="mt-6 text-xs font-semibold uppercase tracking-wider text-destructive"
        >
          Sign Out
        </button>
      </div>
    </div>
  );
}
