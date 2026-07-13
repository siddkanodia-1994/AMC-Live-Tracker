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

// A FieldBox variant for a quarter-select + optional custom date range, both
// describing the same underlying "window" -- merges what used to be two
// separate boxes into one. Widens itself when expanded so the two date
// inputs it reveals get the same roomy sizing a standalone range box would,
// instead of squeezing them into a single-select-width box.
export function WindowFieldBox({
  label,
  expanded,
  onToggleExpanded,
  children,
}: {
  label: string;
  expanded: boolean;
  onToggleExpanded: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className={`flex flex-col gap-1 rounded-lg border bg-[var(--toolbar-accent-soft)]/40 px-3 py-2 transition-[flex-basis,min-width] ${
        expanded ? "min-w-[320px] flex-[1_1_320px]" : "min-w-[190px] flex-1"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10.5px] font-semibold tracking-wide text-muted-foreground uppercase">{label}</span>
        <button
          type="button"
          onClick={onToggleExpanded}
          className="text-xs text-[var(--toolbar-accent)] underline underline-offset-2 hover:opacity-80"
        >
          {expanded ? "Custom ▾" : "Custom"}
        </button>
      </div>
      {children}
    </div>
  );
}
