import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRole } from "@/hooks/use-session";
import { APP_NAME } from "@/lib/brand";

/** Shown to everyone in an organization the platform owner has switched off. */
export function SuspendedAccess() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { organization } = useRole();

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="grid min-h-screen place-items-center bg-background px-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-8 text-center">
        <div className="mx-auto mb-4 grid size-10 place-items-center rounded-lg bg-destructive font-bold text-primary-foreground">
          !
        </div>
        <h1 className="text-lg font-bold tracking-tight">Access suspended</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {organization?.name ?? "Your organization"}'s access to {APP_NAME} is currently switched off. Your data is safe
          and untouched — contact your provider to restore access.
        </p>
        <button onClick={signOut} className="mt-6 text-xs font-semibold uppercase tracking-wider text-destructive">
          Sign Out
        </button>
      </div>
    </div>
  );
}
