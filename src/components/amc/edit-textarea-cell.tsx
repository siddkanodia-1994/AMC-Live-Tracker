"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A manually-editable free-text box -- the textarea counterpart to
 * EditNumberCell, same commit-on-blur/Enter-to-not-submit save shape
 * (NOT typing-debounce): local draft state, a saving spinner, a 1.5s
 * flash ✓/error, and reverting the draft on save failure. No numeric-
 * parse or reset-to-computed-default machinery -- a text field has no
 * computed default, only null/empty, so there's no override border or ×
 * reset button here.
 */
export function EditTextareaCell({
  value,
  onSave,
  placeholder,
  minRows = 5,
}: {
  value: string | null;
  onSave: (newValue: string | null) => Promise<void>;
  placeholder?: string;
  minRows?: number;
}) {
  const [draft, setDraft] = useState(value ?? "");
  const [prevValue, setPrevValue] = useState(value);
  const [focused, setFocused] = useState(false);
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState<"saved" | "error" | null>(null);
  const flashTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Resync the draft when the server value changes externally (e.g. the
  // "Regenerate from data" button writes a fresh draft elsewhere, or a
  // background refetch) -- skipped while focused so an in-flight edit is
  // never clobbered.
  if (value !== prevValue && !focused) {
    setPrevValue(value);
    setDraft(value ?? "");
  }

  useEffect(
    () => () => {
      if (flashTimeout.current) clearTimeout(flashTimeout.current);
    },
    []
  );

  function showFlash(kind: "saved" | "error") {
    setFlash(kind);
    if (flashTimeout.current) clearTimeout(flashTimeout.current);
    flashTimeout.current = setTimeout(() => setFlash(null), 1500);
  }

  async function commit() {
    const trimmed = draft.trim();
    const next = trimmed === "" ? null : draft;
    if (next === (value ?? null)) return;
    setSaving(true);
    try {
      await onSave(next);
      showFlash("saved");
    } catch {
      showFlash("error");
      setDraft(value ?? "");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <textarea
        value={draft}
        disabled={saving}
        placeholder={placeholder}
        rows={minRows}
        onFocus={() => setFocused(true)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          setFocused(false);
          void commit();
        }}
        className="w-full resize-y rounded-md border bg-background px-3 py-2 text-sm leading-relaxed focus:outline-none focus:ring-1 focus:ring-foreground/40"
      />
      <div className="flex h-4 items-center gap-1 text-xs text-muted-foreground">
        {saving && <span>Saving…</span>}
        {!saving && flash === "saved" && <span className="text-emerald-600 dark:text-emerald-400">✓ Saved</span>}
        {!saving && flash === "error" && <span className="text-red-600 dark:text-red-400">! Failed to save</span>}
      </div>
    </div>
  );
}
