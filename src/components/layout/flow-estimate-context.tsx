"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

const STORAGE_KEY = "live-aum-flow-estimate-enabled";

interface FlowEstimateContextValue {
  includeFlowEstimate: boolean;
  setIncludeFlowEstimate: (value: boolean) => void;
}

const FlowEstimateContext = createContext<FlowEstimateContextValue | null>(null);

/**
 * Global (not per-page, unlike every other toggle in this app) -- flipping
 * this in the header stays on while navigating between Overview, an AMC
 * detail page, etc. localStorage read happens in an effect (not render) so
 * SSR/first paint always matches the default and never mismatches across a
 * hydration boundary; a private window or blocked site data just means the
 * toggle resets to Off next visit, same tradeoff as the existing
 * admin-secret storage in admin-client.ts.
 */
export function FlowEstimateProvider({ children }: { children: ReactNode }) {
  const [includeFlowEstimate, setIncludeFlowEstimateState] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "true") setIncludeFlowEstimate(true);
    } catch {
      // localStorage unavailable (private window, blocked site data) -- stay at the default (Off).
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function setIncludeFlowEstimate(value: boolean) {
    setIncludeFlowEstimateState(value);
    try {
      localStorage.setItem(STORAGE_KEY, String(value));
    } catch {
      // Best-effort persistence only -- the toggle still works for this page view either way.
    }
  }

  const value = useMemo(() => ({ includeFlowEstimate, setIncludeFlowEstimate }), [includeFlowEstimate]);
  return <FlowEstimateContext.Provider value={value}>{children}</FlowEstimateContext.Provider>;
}

export function useFlowEstimateDisplay(): FlowEstimateContextValue {
  const ctx = useContext(FlowEstimateContext);
  if (!ctx) {
    // Outside the provider (shouldn't happen -- it wraps the whole app in
    // layout.tsx), fall back to "Off" rather than throwing, consistent with
    // how a disconnected localStorage read degrades.
    return { includeFlowEstimate: false, setIncludeFlowEstimate: () => {} };
  }
  return ctx;
}
