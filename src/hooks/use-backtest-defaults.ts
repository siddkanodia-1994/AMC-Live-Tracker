import useSWR from "swr";
import type { BacktestDefaults } from "@/lib/backtest/backtest-defaults";

async function fetcher(url: string): Promise<BacktestDefaults> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed with status ${res.status}`);
  }
  return res.json();
}

// Same shape as useAmcStockCorrelations -- no refreshInterval, this only
// ever changes when someone clicks "Save as default".
export function useBacktestDefaults() {
  return useSWR<BacktestDefaults>("/api/backtest-defaults", fetcher, {
    revalidateOnFocus: false,
  });
}
