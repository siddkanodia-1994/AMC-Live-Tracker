import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/lib/db/client";
import { amcListedStock } from "@/lib/db/schema";
import { computeLiveAumForAmc, NoDataImportedError } from "@/lib/aum/compute-live-aum";
import { getAmcAumHistory, getAmcListedStockPriceHistory, type AumHistoryPoint, type AmcStockPricePoint } from "@/lib/aum/history";
import { AmcDetailView } from "@/components/amc/amc-detail-view";
import type { AmcDetailResponse } from "@/hooks/use-live-aum-detail";

export const dynamic = "force-dynamic";

export default async function AmcDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  let initialData: AmcDetailResponse | undefined;
  let history: AumHistoryPoint[] = [];
  let stockPriceSeries: AmcStockPricePoint[] | undefined;
  let stockLabel: string | undefined;
  try {
    const result = await computeLiveAumForAmc(slug);
    if (!result) notFound();
    initialData = result;
    history = await getAmcAumHistory(result.amc.amcId).catch(() => []);

    // Only ~7 AMCs (of ~57) have their own separately-listed stock -- no
    // row here means no toggle renders at all (see aum-trend-chart.tsx).
    const [listedStock] = await db.select().from(amcListedStock).where(eq(amcListedStock.amcId, result.amc.amcId));
    if (listedStock) {
      stockPriceSeries = await getAmcListedStockPriceHistory(listedStock.isin, listedStock.backfillFromDate).catch(() => []);
      stockLabel = listedStock.tradingSymbol;
    }
  } catch (err) {
    if (err instanceof NoDataImportedError) {
      initialData = undefined;
    } else {
      throw err;
    }
  }

  return (
    <div className="px-4 py-8 sm:px-6">
      {initialData ? (
        <AmcDetailView
          slug={slug}
          initialData={initialData}
          history={history}
          stockPriceSeries={stockPriceSeries}
          stockLabel={stockLabel}
        />
      ) : (
        <p className="text-center text-muted-foreground">
          No data has been imported yet. Upload your Excel tracker from the Admin page.
        </p>
      )}
    </div>
  );
}
