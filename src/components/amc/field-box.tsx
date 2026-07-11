import type { ReactNode } from "react";

// Shared boxed-field-card look introduced for the Overview toolbar's filter
// row -- a bordered box with a small uppercase eyebrow label above whatever
// control(s) it wraps. Reused by the Equity AUM Growth and Total AUM Growth
// tabs' own filter rows for visual consistency.
export function FieldBox({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-[190px] flex-1 flex-col gap-1 rounded-lg border bg-[var(--toolbar-accent-soft)]/40 px-3 py-2">
      <span className="text-[10.5px] font-semibold tracking-wide text-muted-foreground uppercase">{label}</span>
      {children}
    </div>
  );
}
