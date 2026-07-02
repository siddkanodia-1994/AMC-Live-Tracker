import { computeLiveAum, NoDataImportedError } from "@/lib/aum/compute-live-aum";
import { getIndustryAumHistory, type AumHistoryPoint } from "@/lib/aum/history";
import { AmcGrid } from "@/components/amc/amc-grid";
import type { LiveAumSnapshot } from "@/lib/aum/types";

export const dynamic = "force-dynamic";

async function getInitialSnapshot(): Promise<LiveAumSnapshot | undefined> {
  try {
    return await computeLiveAum();
  } catch (err) {
    if (err instanceof NoDataImportedError) return undefined;
    console.error(err);
    return undefined;
  }
}

export default async function OverviewPage() {
  const initialData = await getInitialSnapshot();
  const history = initialData ? await getIndustryAumHistory().catch((): AumHistoryPoint[] => []) : [];

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <AmcGrid initialData={initialData} history={history} />
    </div>
  );
}
