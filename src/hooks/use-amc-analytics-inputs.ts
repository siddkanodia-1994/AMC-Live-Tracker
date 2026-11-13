import useSWR, { mutate as globalMutate } from "swr";
import type { AmcAnalyticsField, AmcAnalyticsInputs } from "@/lib/aum/amc-analytics-inputs";
import type { AmcScoreCard } from "@/lib/aum/amc-score";

async function fetcher<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed with status ${res.status}`);
  }
  return res.json();
}

export const amcAnalyticsInputsKey = (amcId: number) => `/api/amc-analytics/inputs?amcId=${amcId}`;
export const amcAnalyticsScoreKey = (amcId: number) => `/api/amc-analytics/amc-score?amcId=${amcId}`;

/** AMC Analytics' valuation and SIP inputs for one AMC (its latest stored row). */
export function useAmcAnalyticsInputs(amcId: number | null) {
  return useSWR<AmcAnalyticsInputs>(amcId !== null ? amcAnalyticsInputsKey(amcId) : null, fetcher, {
    revalidateOnFocus: false,
    keepPreviousData: true,
  });
}

export function useAmcAnalyticsScore(amcId: number | null) {
  return useSWR<{ card: AmcScoreCard | null; availableDates: string[] }>(amcId !== null ? amcAnalyticsScoreKey(amcId) : null, fetcher, {
    revalidateOnFocus: false,
  });
}

/** Refresh every view of these figures: AMC Analytics', the cross-AMC SIP table and the Fortnightly tab's own copy. */
export function revalidateAmcInputs() {
  return Promise.all([
    globalMutate((key) => typeof key === "string" && key.startsWith("/api/amc-analytics/"), undefined, { revalidate: true }),
    globalMutate("/api/sip-quarterly"),
    globalMutate((key) => typeof key === "string" && key.startsWith("/api/fortnightly-update?"), undefined, { revalidate: true }),
  ]);
}

/** Save one cell (to the AMC's latest stored row), then refresh. */
export async function saveAmcInput(amcId: number, field: AmcAnalyticsField, value: number | string | null): Promise<void> {
  const res = await fetch("/api/amc-analytics/inputs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ amcId, field, value }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? "Failed to save");
  }
  await revalidateAmcInputs();
}
