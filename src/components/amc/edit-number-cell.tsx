"use client";

import { useEffect, useRef, useState } from "react";
import { TableCell } from "@/components/ui/table";

/**
 * A manually-editable numeric table cell -- the first of its kind in this app
 * (every other cell is read-only formatted text). Saves on blur/Enter via
 * onSave; a × affordance appears once overridden, clearing back to the
 * computed default (onSave(null)). Reverts the draft on save failure.
 */
export function EditNumberCell({
  value,
  isOverridden,
  onSave,
}: {
  value: number;
  isOverridden: boolean;
  onSave: (newValue: number | null) => Promise<void>;
}) {
  const [draft, setDraft] = useState(() => String(value));
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
    setDraft(String(value));
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
    const trimmed = draft.trim();
    const parsed = trimmed === "" ? null : Number(trimmed);
    if (parsed !== null && !Number.isFinite(parsed)) {
      setDraft(String(value));
      return;
    }
    if (parsed === null ? !isOverridden : parsed === value && !isOverridden) return;
    setSaving(true);
    try {
      await onSave(parsed);
      showFlash("saved");
    } catch {
      showFlash("error");
      setDraft(String(value));
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
          type="number"
          step="any"
          value={draft}
          disabled={saving}
          onFocus={() => setFocused(true)}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            setFocused(false);
            void commit();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              setDraft(String(value));
              e.currentTarget.blur();
            }
          }}
          className={`w-28 rounded border bg-background px-1.5 py-0.5 text-right text-sm tabular-nums focus:outline-none focus:ring-1 focus:ring-foreground/40 ${
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
