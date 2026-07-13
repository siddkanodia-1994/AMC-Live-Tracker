import useSWR from "swr";
import type { OverviewAdjustments } from "@/lib/aum/overview-adjustments";

async function fetcher(url: string): Promise<OverviewAdjustments> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed with status ${res.status}`);
  }
  return res.json();
}

// Reported AUM per period and both Avg AUM windows are all pure historical
// DB aggregates -- no DHAN calls, no polling needed. keepPreviousData avoids
// flashing back to the default figures while a new selection's fetch is
// still in flight.
export function useOverviewAdjustments(
  reportPeriod?: string,
  avgFrom?: string,
  avgTo?: string,
  currentAvgFrom?: string,
  currentAvgTo?: string,
  histLiveDate?: string
) {
  const params = new URLSearchParams();
  if (reportPeriod) params.set("reportPeriod", reportPeriod);
  if (avgFrom) params.set("avgFrom", avgFrom);
  if (avgTo) params.set("avgTo", avgTo);
  if (currentAvgFrom) params.set("currentAvgFrom", currentAvgFrom);
  if (currentAvgTo) params.set("currentAvgTo", currentAvgTo);
  if (histLiveDate) params.set("histLiveDate", histLiveDate);
  const qs = params.toString();
  return useSWR<OverviewAdjustments>(`/api/overview-adjustments${qs ? `?${qs}` : ""}`, fetcher, {
    revalidateOnFocus: false,
    keepPreviousData: true,
  });
}
