"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

const STORAGE_KEY = "fortnightly-font-scale";
const MIN_SCALE = 0.85;
const MAX_SCALE = 1.25;
const STEP = 0.05;
const DEFAULT_SCALE = 1;

interface FontScaleContextValue {
  fontScale: number;
  increaseFontScale: () => void;
  decreaseFontScale: () => void;
  resetFontScale: () => void;
}

const FontScaleContext = createContext<FontScaleContextValue | null>(null);

/**
 * Scoped to the Fortnightly tab (FortnightlyUpdatePanel wraps its own
 * subtree in this, not layout.tsx) -- a readability toggle for that one
 * tab's tables and its PDF export, not a global app setting. Same
 * localStorage-in-an-effect convention as flow-estimate-context.tsx: SSR/
 * first paint always matches DEFAULT_SCALE, so there's no hydration
 * mismatch, and a private window or blocked site data just means the
 * toggle resets to 100% next visit.
 */
export function FontScaleProvider({ children }: { children: ReactNode }) {
  const [fontScale, setFontScaleState] = useState(DEFAULT_SCALE);

  useEffect(() => {
    try {
      const stored = Number(localStorage.getItem(STORAGE_KEY));
      if (stored >= MIN_SCALE && stored <= MAX_SCALE) setFontScaleState(stored);
    } catch {
      // localStorage unavailable (private window, blocked site data) -- stay at the default (100%).
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function persist(value: number) {
    const rounded = Math.round(value * 100) / 100;
    setFontScaleState(rounded);
    try {
      localStorage.setItem(STORAGE_KEY, String(rounded));
    } catch {
      // Best-effort persistence only -- the toggle still works for this page view either way.
    }
  }

  const value = useMemo<FontScaleContextValue>(
    () => ({
      fontScale,
      increaseFontScale: () => persist(Math.min(MAX_SCALE, fontScale + STEP)),
      decreaseFontScale: () => persist(Math.max(MIN_SCALE, fontScale - STEP)),
      resetFontScale: () => persist(DEFAULT_SCALE),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fontScale]
  );
  return <FontScaleContext.Provider value={value}>{children}</FontScaleContext.Provider>;
}

export function useFontScale(): FontScaleContextValue {
  const ctx = useContext(FontScaleContext);
  if (!ctx) {
    // Outside the provider -- degrade to a fixed 100% rather than throwing.
    return { fontScale: 1, increaseFontScale: () => {}, decreaseFontScale: () => {}, resetFontScale: () => {} };
  }
  return ctx;
}
