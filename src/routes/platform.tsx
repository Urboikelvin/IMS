import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { RequirePlatformAdmin } from "@/components/RequirePlatformAdmin";
import { ActivityFeed } from "@/components/platform/ActivityFeed";
import { AttentionPanel } from "@/components/platform/AttentionPanel";
import { ClientSheet, type ClientTab } from "@/components/platform/ClientSheet";
import { ClientsTable } from "@/components/platform/ClientsTable";
import { NewClientSheet } from "@/components/platform/NewClientSheet";
import { OverviewStrip } from "@/components/platform/OverviewStrip";
import { usePlatformData } from "@/components/platform/usePlatformData";
import { plural } from "@/lib/platform";
import { APP_NAME } from "@/lib/brand";

export const Route = createFileRoute("/platform")({
  head: () => ({
    meta: [
      { title: `Platform • ${APP_NAME}` },
      { name: "description", content: "Monitor clients and their subscriptions." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: () => (
    <RequirePlatformAdmin>
      <PlatformPage />
    </RequirePlatformAdmin>
  ),
});

function PlatformPage() {
  const data = usePlatformData();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<ClientTab>("billing");
  const [newOpen, setNewOpen] = useState(false);

  function openClient(orgId: string, nextTab: ClientTab = "billing") {
    setTab(nextTab);
    setSelectedId(orgId);
  }

  const attentionClients = new Set(data.attention.map((item) => item.org.id)).size;
  const summary = data.loading
    ? "Loading…"
    : attentionClients === 0
      ? "All clear. Every active client is paid up and in use."
      : `${plural(attentionClients, "client")} ${attentionClients === 1 ? "needs" : "need"} your attention.`;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Platform</h1>
          <p className="mt-1 text-sm text-muted-foreground">{summary}</p>
        </div>
        <button
          type="button"
          onClick={() => setNewOpen(true)}
          className="inline-flex h-11 items-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <Plus aria-hidden="true" className="size-4" />
          New client
        </button>
      </header>

      {!data.billingReady ? (
        <div role="status" className="rounded-xl border border-warning-border bg-warning-surface px-4 py-3 text-sm text-warning-strong">
          Subscription tracking isn't set up on this database yet. Apply the migration{" "}
          <span className="font-mono">20261103180000_platform_billing_and_activity.sql</span> in Supabase, then reload this page. Everything else works in the meantime.
        </div>
      ) : null}

      <OverviewStrip data={data} />

      <div className={`grid items-start gap-6 ${data.billingReady ? "lg:grid-cols-2" : ""}`}>
        <AttentionPanel data={data} onOpen={openClient} />
        {data.billingReady ? <ActivityFeed data={data} /> : null}
      </div>

      <ClientsTable data={data} onOpen={(id) => openClient(id)} />

      <ClientSheet data={data} orgId={selectedId} tab={tab} onTabChange={setTab} onClose={() => setSelectedId(null)} />
      <NewClientSheet data={data} open={newOpen} onOpenChange={setNewOpen} />
    </div>
  );
}
