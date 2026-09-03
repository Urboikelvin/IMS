import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useProfile, useRole, type AppRole } from "@/hooks/use-session";

const NAV: { to: string; label: string; roles: AppRole[] }[] = [
  { to: "/", label: "Dashboard", roles: ["super_admin", "admin", "staff"] },
  { to: "/stock-in", label: "Stock In", roles: ["super_admin", "admin", "staff"] },
  { to: "/stock-out", label: "Stock Out", roles: ["super_admin", "admin", "staff"] },
  { to: "/items", label: "Items", roles: ["super_admin", "admin"] },
  { to: "/reports", label: "Reports", roles: ["super_admin", "admin"] },
  { to: "/users", label: "Users", roles: ["super_admin", "admin"] },
];

export function AppShell({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: profile } = useProfile();
  const { role } = useRole();
  const nav = NAV.filter((entry) => entry.roles.includes(role));

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <nav className="sticky top-0 z-50 border-b border-border bg-surface px-4 py-3 md:px-8">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
          <Link to="/" className="flex items-center gap-2">
            <div className="grid size-8 place-items-center rounded bg-primary font-bold text-primary-foreground">M</div>
            <span className="text-lg font-bold tracking-tight">MASLOW</span>
          </Link>
          <div className="hidden items-center gap-5 md:flex">
            {nav.map((entry) => (
              <Link
                key={entry.to}
                to={entry.to}
                className="text-xs font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
                activeProps={{ className: "text-accent" }}
              >
                {entry.label}
              </Link>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-right text-[11px] leading-tight sm:block">
              <span className="block font-semibold">{profile?.name ?? "Account"}</span>
              <span className="block uppercase tracking-wider text-muted-foreground">{role.replace("_", " ")}</span>
            </span>
            <Link
              to="/stock-out"
              className="rounded-full bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground"
            >
              New Issue
            </Link>
          </div>
        </div>
        <div className="mt-3 flex gap-4 overflow-x-auto md:hidden">
          {nav.map((entry) => (
            <Link
              key={entry.to}
              to={entry.to}
              className="whitespace-nowrap text-xs font-semibold uppercase tracking-wider text-muted-foreground"
              activeProps={{ className: "text-accent" }}
            >
              {entry.label}
            </Link>
          ))}
        </div>
      </nav>

      <main className="mx-auto max-w-7xl p-4 md:p-8">{children}</main>

      <footer className="mt-12 border-t border-border bg-surface px-4 py-6 md:px-8">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 md:flex-row">
          <p className="text-xs text-subtle">© {new Date().getFullYear()} Maslow Inventory Systems • Internal Use Only</p>
          <div className="flex gap-6 text-xs font-semibold text-muted-foreground">
            {nav.some((entry) => entry.to === "/items") ? <Link to="/items">Item Management</Link> : null}
            {nav.some((entry) => entry.to === "/reports") ? <Link to="/reports">Reports</Link> : null}
            <button onClick={signOut} className="text-destructive">
              Sign Out
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
