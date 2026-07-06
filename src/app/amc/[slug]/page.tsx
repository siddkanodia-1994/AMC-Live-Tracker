import { notFound } from "next/navigation";
import { computeLiveAumForAmc, NoDataImportedError } from "@/lib/aum/compute-live-aum";
import { getAmcAumHistory, type AumHistoryPoint } from "@/lib/aum/history";
import { AmcDetailView } from "@/components/amc/amc-detail-view";
import type { AmcDetailResponse } from "@/hooks/use-live-aum-detail";

export const dynamic = "force-dynamic";

export default async function AmcDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  let initialData: AmcDetailResponse | undefined;
  let history: AumHistoryPoint[] = [];
  try {
    const result = await computeLiveAumForAmc(slug);
    if (!result) notFound();
    initialData = result;
    history = await getAmcAumHistory(result.amc.amcId).catch(() => []);
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
        <AmcDetailView slug={slug} initialData={initialData} history={history} />
      ) : (
        <p className="text-center text-muted-foreground">
          No data has been imported yet. Upload your Excel tracker from the Admin page.
        </p>
      )}
    </div>
  );
}
