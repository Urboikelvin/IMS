import { describeEvent, formatNaira, relativeTime } from "@/lib/platform";
import { dotTone, SectionTitle } from "./ui";
import type { PlatformData } from "./usePlatformData";

export function ActivityFeed({ data }: { data: PlatformData }) {
  const events = data.events.slice(0, 12);

  return (
    <section className="panel" aria-labelledby="activity-heading">
      <div className="border-b border-border px-6 py-4">
        <h2 id="activity-heading" className="sr-only">Platform activity</h2>
        <SectionTitle title="Platform activity" hint="Sign-ups, payments, suspensions and renewal changes. Recorded automatically." />
      </div>
      {events.length === 0 ? (
        <p className="px-6 py-10 text-center text-sm text-muted-foreground">Nothing yet. New clients, payments and status changes will show up here.</p>
      ) : (
        <ol className="divide-y divide-border">
          {events.map((event) => {
            const info = describeEvent(event, formatNaira);
            return (
              <li key={event.id} className="flex items-start gap-3 px-6 py-3">
                <span aria-hidden="true" className={`mt-1.5 size-2 shrink-0 rounded-full ${dotTone[info.tone]}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{info.title}</p>
                  {info.detail ? <p className="text-xs text-muted-foreground">{info.detail}</p> : null}
                </div>
                <time dateTime={event.created_at} className="shrink-0 text-xs text-muted-foreground">
                  {relativeTime(event.created_at)}
                </time>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
