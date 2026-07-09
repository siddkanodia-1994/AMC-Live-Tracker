"use client";

import { useEffect, useRef, useState } from "react";
import { TableCell } from "@/components/ui/table";

// Comma-grouped, 1 decimal -- same en-IN convention as formatCr elsewhere, just one
// fewer decimal place (as requested) since these are manually-typed working figures,
// not display-only currency values.
function formatDisplay(value: number): string {
  return value.toLocaleString("en-IN", { maximumFractionDigits: 1, minimumFractionDigits: 1 });
}

/**
 * A manually-editable numeric table cell -- the first of its kind in this app
 * (every other cell is read-only formatted text). Shows a comma-grouped,
 * 1-decimal value at rest (matching the rest of the table's number styling);
 * switches to the raw full-precision number while focused so edits aren't
 * hampered by pre-rounding, then reformats on blur. Saves on blur/Enter via
 * onSave; a × affordance appears once overridden, clearing back to the
 * computed default (onSave(null)). Reverts the draft on save failure.
 */
export function EditNumberCell({
  value,
  isOverridden,
  onSave,
  title,
}: {
  value: number;
  isOverridden: boolean;
  onSave: (newValue: number | null) => Promise<void>;
  // Hover text for the input -- used for the override audit-trail note
  // ("Overridden {date} — was {value}").
  title?: string;
}) {
  const [draft, setDraft] = useState(() => formatDisplay(value));
  const [prevValue, setPrevValue] = useState(value);
  const [focused, setFocused] = useState(false);
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState<"saved" | "error" | null>(null);
  const flashTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Resync the draft when the computed/server value changes externally (e.g.
  // after a save elsewhere triggers a table refresh) -- adjusted during
  // render rather than in an effect, and skipped while focused so an
  // in-flight edit is never clobbered by a background refetch.
  if (value !== prevValue && !focused) {
    setPrevValue(value);
    setDraft(formatDisplay(value));
  }

  useEffect(() => () => {
    if (flashTimeout.current) clearTimeout(flashTimeout.current);
  }, []);

  function showFlash(kind: "saved" | "error") {
    setFlash(kind);
    if (flashTimeout.current) clearTimeout(flashTimeout.current);
    flashTimeout.current = setTimeout(() => setFlash(null), 1500);
  }

  async function commit() {
    const cleaned = draft.replace(/,/g, "").trim();
    const parsed = cleaned === "" ? null : Number(cleaned);
    if (parsed !== null && !Number.isFinite(parsed)) {
      setDraft(formatDisplay(value));
      return;
    }
    if (parsed === null ? !isOverridden : parsed === value && !isOverridden) {
      setDraft(formatDisplay(value));
      return;
    }
    setSaving(true);
    try {
      await onSave(parsed);
      showFlash("saved");
      // Reformat immediately using what was just saved -- the resync-on-
      // external-change block above only fires when the refetched `value`
      // prop differs from before, which it won't if the saved amount happens
      // to match what was already stored (e.g. re-saving an unchanged
      // override), otherwise leaving the raw unformatted draft on screen.
      if (parsed !== null) setDraft(formatDisplay(parsed));
    } catch {
      showFlash("error");
      setDraft(formatDisplay(value));
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    setSaving(true);
    try {
      await onSave(null);
      showFlash("saved");
    } catch {
      showFlash("error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <TableCell className="text-right tabular-nums">
      <div className="flex items-center justify-end gap-1">
        <input
          type="text"
          inputMode="decimal"
          value={draft}
          disabled={saving}
          title={title}
          onFocus={() => {
            setFocused(true);
            setDraft(String(value));
          }}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            setFocused(false);
            void commit();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              setDraft(formatDisplay(value));
              setFocused(false);
              e.currentTarget.blur();
            }
          }}
          className={`w-28 rounded border bg-transparent px-1.5 py-0.5 text-right text-sm tabular-nums focus:outline-none focus:ring-1 focus:ring-foreground/40 ${
            isOverridden ? "border-amber-500/60" : ""
          }`}
        />
        {isOverridden && !saving && (
          <button
            type="button"
            onClick={handleReset}
            title="Reset to computed default"
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            ×
          </button>
        )}
        {saving && <span className="text-xs text-muted-foreground">…</span>}
        {!saving && flash === "saved" && <span className="text-xs text-emerald-600 dark:text-emerald-400">✓</span>}
        {!saving && flash === "error" && <span className="text-xs text-red-600 dark:text-red-400">!</span>}
      </div>
    </TableCell>
  );
}
