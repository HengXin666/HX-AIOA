import type { ReactNode } from "react";

export function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3">
      <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

export function Row({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="min-w-0 text-foreground">{label}</span>
      <span className="text-right text-muted-foreground">{value}</span>
    </div>
  );
}

export const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
