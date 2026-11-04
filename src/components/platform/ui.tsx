import type { ReactNode } from "react";
import type { Tone } from "@/lib/platform";

const pillTone: Record<Tone, string> = {
  ok: "bg-success/10 text-success",
  warn: "bg-warning/15 text-warning-strong",
  danger: "bg-destructive/10 text-destructive",
  muted: "bg-secondary text-muted-foreground",
};

/** A status in words, with a dot. The words carry the meaning; the colour only reinforces it. */
export function StatusPill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${pillTone[tone]}`}>
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}

const barTone: Record<Tone, string> = {
  ok: "bg-success",
  warn: "bg-warning",
  danger: "bg-destructive",
  muted: "bg-subtle",
};

/** Decorative bar. Always shown next to text that says the same thing. */
export function ThinBar({ fraction, tone }: { fraction: number; tone: Tone }) {
  const width = `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
  return (
    <div aria-hidden="true" className="h-1 w-full overflow-hidden rounded-full bg-secondary">
      <div className={`h-full rounded-full ${barTone[tone]}`} style={{ width }} />
    </div>
  );
}

export const dotTone: Record<Tone, string> = {
  ok: "bg-success",
  warn: "bg-warning",
  danger: "bg-destructive",
  muted: "bg-subtle",
};

export function SectionTitle({ title, hint }: { title: string; hint?: string }) {
  return (
    <div>
      <h2 className="text-base font-bold">{title}</h2>
      {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
