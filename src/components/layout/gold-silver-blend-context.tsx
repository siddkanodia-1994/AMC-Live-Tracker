"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import useSWR from "swr";

const ENABLED_STORAGE_KEY = "gold-silver-blend-enabled";
const SELECTED_STORAGE_KEY = "gold-silver-blend-selected-amc-ids";
const DEFAULT_SELECTED_AMC_NAME = "Nippon India Mutual Fund";

export interface ListedAmc {
  id: number;
  slug: string;
  overviewName: string;
}

interface GoldSilverBlendContextValue {
  enabled: boolean;
  setEnabled: (value: boolean) => void;
  selectedAmcIds: number[];
  toggleAmcId: (id: number) => void;
  listedAmcs: ListedAmc[];
}

const GoldSilverBlendContext = createContext<GoldSilverBlendContextValue | null>(null);

async function fetchListedAmcs(url: string): Promise<{ amcs: ListedAmc[] }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Request failed with status ${res.status}`);
  return res.json();
}

/**
 * Global (not per-page, same as FlowEstimateContext) -- on by default,
 * with Nippon India pre-selected once the listed-AMC list loads (resolved
 * by NAME, not a hardcoded id, since ids are an implementation detail).
 * localStorage persists both the on/off state and the selected id list;
 * reads happen in an effect so SSR/first paint stay consistent and never
 * mismatch across the hydration boundary, same tradeoff as every other
 * client-persisted toggle in this app.
 */
export function GoldSilverBlendProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabledState] = useState(true);
  // null = nothing restored from localStorage or picked yet.
  const [storedSelectedAmcIds, setSelectedAmcIds] = useState<number[] | null>(null);
  const { data } = useSWR("/api/listed-amcs", fetchListedAmcs, { revalidateOnFocus: false });
  const listedAmcs = useMemo(() => data?.amcs ?? [], [data]);

  useEffect(() => {
    try {
      const storedEnabled = localStorage.getItem(ENABLED_STORAGE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- mount-time localStorage read, kept out of the initializer so SSR/first paint match (see docblock)
      if (storedEnabled !== null) setEnabledState(storedEnabled === "true");
      const storedSelected = localStorage.getItem(SELECTED_STORAGE_KEY);
      if (storedSelected !== null) setSelectedAmcIds(JSON.parse(storedSelected));
    } catch {
      // localStorage unavailable -- fall back to defaults below.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Default selection (Nippon) can only be resolved once the AMC list has
  // loaded -- used only while nothing was restored from localStorage above
  // or picked since (an explicit saved selection, including an
  // intentionally-empty one, always wins).
  const defaultSelectedAmcIds = useMemo(() => {
    const nippon = listedAmcs.find((a) => a.overviewName === DEFAULT_SELECTED_AMC_NAME);
    return nippon ? [nippon.id] : [];
  }, [listedAmcs]);
  const selectedAmcIds = storedSelectedAmcIds ?? defaultSelectedAmcIds;

  function setEnabled(value: boolean) {
    setEnabledState(value);
    try {
      localStorage.setItem(ENABLED_STORAGE_KEY, String(value));
    } catch {
      // Best-effort persistence only.
    }
  }

  const toggleAmcId = useCallback((id: number) => {
    setSelectedAmcIds((stored) => {
      const prev = stored ?? defaultSelectedAmcIds;
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      try {
        localStorage.setItem(SELECTED_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Best-effort persistence only.
      }
      return next;
    });
  }, [defaultSelectedAmcIds]);

  const value = useMemo(
    () => ({ enabled, setEnabled, selectedAmcIds, toggleAmcId, listedAmcs }),
    [enabled, selectedAmcIds, toggleAmcId, listedAmcs]
  );
  return <GoldSilverBlendContext.Provider value={value}>{children}</GoldSilverBlendContext.Provider>;
}

export function useGoldSilverBlend(): GoldSilverBlendContextValue {
  const ctx = useContext(GoldSilverBlendContext);
  if (!ctx) {
    return { enabled: false, setEnabled: () => {}, selectedAmcIds: [], toggleAmcId: () => {}, listedAmcs: [] };
  }
  return ctx;
}

/** The AMC ids to actually blend right now -- empty whenever the toggle is off,
 * regardless of what's checked in the dropdown. Every consuming hook should use
 * this (not `selectedAmcIds` directly) so "off" always means "no blending". */
export function useActiveGoldSilverBlendAmcIds(): number[] {
  const { enabled, selectedAmcIds } = useGoldSilverBlend();
  return enabled ? selectedAmcIds : [];
}
