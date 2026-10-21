import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Field, SubmitButton, TextInput } from "@/components/inventory-ui";
import { APP_NAME, APP_TAGLINE } from "@/lib/brand";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: `Sign In • ${APP_NAME}` },
      { name: "description", content: "Secure staff sign in for the inventory and stock issuance system." },
      { property: "og:title", content: `Sign In • ${APP_NAME}` },
      { property: "og:description", content: "Secure staff sign in for the inventory system." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/", replace: true });
    });
  }, [navigate]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!email.trim() || !password) {
      toast.error("Enter your email and password.");
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw error;
      navigate({ to: "/", replace: true });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Authentication failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-background px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-lg bg-primary text-lg font-bold text-primary-foreground">
            {APP_NAME.charAt(0).toUpperCase()}
          </div>
          <div>
            <p className="text-lg font-bold tracking-tight">{APP_NAME}</p>
            <p className="text-xs uppercase tracking-widest text-muted-foreground">{APP_TAGLINE}</p>
          </div>
        </div>

        <section className="panel p-6">
          <h1 className="text-xl font-bold">Sign in</h1>
          <p className="mt-1 text-sm text-muted-foreground">Use your work email to access the system.</p>

          <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
            <Field label="Email">
              <TextInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username" />
            </Field>
            <Field label="Password">
              <TextInput
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </Field>
            <SubmitButton disabled={busy}>{busy ? "Please wait…" : "Sign In"}</SubmitButton>
          </form>

          <p className="mt-5 text-center text-xs text-muted-foreground">
            Accounts are created by your organization's administrator. Need access? Ask them to add you.
          </p>
        </section>
      </div>
    </main>
  );
}
