import { formatNaira, plural } from "@/lib/platform";
import { dotTone, SectionTitle } from "./ui";
import type { AttentionKind } from "@/lib/platform";
import type { PlatformData } from "./usePlatformData";

const kindTone: Record<AttentionKind, "danger" | "warn" | "muted"> = {
  overdue: "danger",
  expiring: "warn",
  no_date: "warn",
  dormant: "muted",
};

const kindLabel: Record<AttentionKind, string> = {
  overdue: "Overdue",
  expiring: "Renewing soon",
  no_date: "No renewal date",
  dormant: "Not being used",
};

export function AttentionPanel({
  data,
  onOpen,
}: {
  data: PlatformData;
  onOpen: (orgId: string, tab: "billing" | "usage" | "details") => void;
}) {
  const items = data.attention;

  return (
    <section className="panel flex flex-col" aria-labelledby="attention-heading">
      <div className="border-b border-border px-6 py-4">
        <h2 id="attention-heading" className="sr-only">Needs attention</h2>
        <SectionTitle title="Needs attention" hint={items.length ? `${plural(items.length, "item")} to look at` : undefined} />
      </div>

      {items.length === 0 ? (
        <p className="px-6 py-10 text-center text-sm text-muted-foreground">
          {data.loading ? "Loading…" : "All clear. Every active client is paid up and using KAYA."}
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {items.map((item) => (
            <li key={`${item.org.id}-${item.kind}`} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-6 py-3.5">
              <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${dotTone[kindTone[item.kind]]}`} />
              <div className="min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() => onOpen(item.org.id, item.kind === "dormant" ? "usage" : item.kind === "no_date" ? "details" : "billing")}
                  className="truncate text-left text-sm font-semibold hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  {item.org.name}
                </button>
                <p className="text-xs text-muted-foreground">
                  {kindLabel[item.kind]}: {item.reason}
                  {item.fee > 0 ? ` · ${formatNaira(item.fee)} a month` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {item.org.contact_email ? (
                  <a
                    href={`mailto:${item.org.contact_email}?subject=${encodeURIComponent(`${item.org.name}: your KAYA subscription`)}`}
                    className="rounded-lg px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-secondary focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    Email
                  </a>
                ) : null}
                {item.kind === "overdue" || item.kind === "expiring" ? (
                  <button
                    type="button"
                    onClick={() => onOpen(item.org.id, "billing")}
                    className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    Record payment
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
