import type { ReactNode } from "react";

export function StatCard({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: "default" | "danger";
}) {
  return (
    <div className="panel p-5">
      <p className="stat-label">{label}</p>
      <div className="mt-1 flex items-baseline gap-2">
        <p className={`text-3xl font-bold ${tone === "danger" ? "text-destructive" : ""}`}>{value}</p>
        {hint ? (
          <span className={`text-xs font-medium ${tone === "danger" ? "text-destructive/80" : "text-subtle"}`}>
            {hint}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export function Panel({
  title,
  action,
  children,
  padded = true,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  padded?: boolean;
}) {
  return (
    <section className="panel overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-border px-6 py-4">
        <h2 className="font-bold">{title}</h2>
        {action}
      </div>
      <div className={padded ? "p-6" : ""}>{children}</div>
    </section>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <label className="field-label">{label}</label>
      {children}
    </div>
  );
}

const controlClass =
  "h-11 w-full rounded-lg border border-border bg-secondary px-3 text-sm text-foreground outline-none transition-colors focus:border-accent";

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${controlClass} ${props.className ?? ""}`} />;
}

export function SelectInput(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${controlClass} ${props.className ?? ""}`} />;
}

export function SubmitButton({ children, disabled }: { children: ReactNode; disabled?: boolean }) {
  return (
    <button
      type="submit"
      disabled={disabled}
      className="w-full rounded-xl bg-primary py-4 font-bold text-primary-foreground shadow-lg transition-transform hover:scale-[0.99] active:scale-95 disabled:opacity-50"
    >
      {children}
    </button>
  );
}

export function Tag({ tone, children }: { tone: "in" | "out" | "warn" | "danger"; children: ReactNode }) {
  const tones = {
    in: "bg-success/10 text-success",
    out: "bg-destructive/10 text-destructive",
    warn: "bg-warning/15 text-warning-strong",
    danger: "bg-destructive/10 text-destructive",
  } as const;
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function DataTable({ head, children }: { head: ReactNode[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-border bg-secondary text-xs font-bold uppercase text-muted-foreground">
            {head.map((cell, index) => (
              <th key={index} className={`px-6 py-3 ${index > 0 && index === head.length - 1 ? "text-right" : ""}`}>
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">{children}</tbody>
      </table>
    </div>
  );
}

export function EmptyRow({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-6 py-10 text-center text-sm text-muted-foreground">
        {children}
      </td>
    </tr>
  );
}
