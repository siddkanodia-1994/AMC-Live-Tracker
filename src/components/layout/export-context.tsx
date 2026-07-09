"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

export interface ExportSheet {
  // Workbook filename without the .xlsx extension.
  fileName: string;
  // Sheet tab name (Excel caps these at 31 chars).
  sheetName: string;
  // One object per table row; keys become the header row, in insertion order.
  rows: Record<string, string | number | null>[];
}

type ExportGetter = () => ExportSheet | null;

interface ExportContextValue {
  getter: ExportGetter | null;
  register: (fn: ExportGetter) => () => void;
}

const ExportContext = createContext<ExportContextValue | null>(null);

/**
 * Lets whichever dashboard table is currently mounted offer itself to the
 * header's Download Excel button. Tab panels unmount when inactive (Base UI
 * keepMounted=false), so at most one table is registered at a time and the
 * button always exports exactly what's on screen.
 */
export function ExportProvider({ children }: { children: ReactNode }) {
  const [getter, setGetter] = useState<ExportGetter | null>(null);
  const register = useCallback((fn: ExportGetter) => {
    setGetter(() => fn);
    return () => setGetter((current) => (current === fn ? null : current));
  }, []);
  const value = useMemo(() => ({ getter, register }), [getter, register]);
  return <ExportContext.Provider value={value}>{children}</ExportContext.Provider>;
}

/**
 * Register the calling table as the export target while it's mounted. The
 * builder runs lazily at download time and always sees the latest render's
 * rows/filters via a ref, so callers don't manage dependency lists.
 */
export function useRegisterExport(build: ExportGetter) {
  const ctx = useContext(ExportContext);
  const buildRef = useRef(build);
  useEffect(() => {
    buildRef.current = build;
  });
  const register = ctx?.register;
  useEffect(() => {
    if (!register) return;
    return register(() => buildRef.current());
  }, [register]);
}

export function useExportGetter(): ExportGetter | null {
  return useContext(ExportContext)?.getter ?? null;
}
