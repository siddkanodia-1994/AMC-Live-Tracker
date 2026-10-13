import useSWR from "swr";
import type { EligibleAmc, FortnightlySheet } from "@/lib/aum/fortnightly-update";

async function fetcher<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed with status ${res.status}`);
  }
  return res.json();
}

export function useFortnightlyEligibleAmcs() {
  return useSWR<{ amcs: EligibleAmc[] }>("/api/fortnightly-update/amcs", fetcher, { revalidateOnFocus: false });
}

export function useFortnightlySheet(amcId: number | null, asOfDate: string | null) {
  const params = new URLSearchParams();
  if (amcId !== null) params.set("amcId", String(amcId));
  if (asOfDate) params.set("asOfDate", asOfDate);
  return useSWR<FortnightlySheet>(
    amcId !== null ? `/api/fortnightly-update?${params.toString()}` : null,
    fetcher,
    { revalidateOnFocus: false }
  );
}
