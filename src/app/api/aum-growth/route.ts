import { NextResponse } from "next/server";
import {
  getAumGrowthComparison,
  getAvailableReportPeriods,
  getAvailableSnapshotDates,
  type RepriceBasis,
} from "@/lib/aum/aum-growth";
import { closestDateAtOrBefore, lastDayOfReportMonth } from "@/lib/aum/report-period";

const EMPTY_RESPONSE = {
  periodA: null,
  periodB: null,
  rows: [],
  datesForA: [] as string[],
  datesForB: [] as string[],
  repriceBasis: "A" as RepriceBasis,
  asOfDate: null,
};

export async function GET(request: Request) {
  const url = new URL(request.url);

  try {
    const periods = await getAvailableReportPeriods();
    if (periods.length < 2) {
      return NextResponse.json({ periods, ...EMPTY_RESPONSE });
    }

    const requestedA = url.searchParams.get("periodA");
    const requestedB = url.searchParams.get("periodB");
    const periodA = requestedA && periods.includes(requestedA) ? requestedA : periods[periods.length - 2];
    const periodB = requestedB && periods.includes(requestedB) ? requestedB : periods[periods.length - 1];

    const repriceBasis: RepriceBasis = url.searchParams.get("repriceBasis") === "B" ? "B" : "A";

    const [datesForA, datesForB] = await Promise.all([
      getAvailableSnapshotDates(periodA),
      getAvailableSnapshotDates(periodB),
    ]);
    const activeDates = repriceBasis === "B" ? datesForB : datesForA;

    const requestedAsOfDateRaw = url.searchParams.get("asOfDate");
    const requestedAsOfDate =
      requestedAsOfDateRaw && /^\d{4}-\d{2}-\d{2}$/.test(requestedAsOfDateRaw) ? requestedAsOfDateRaw : null;

    let asOfDate: string | null;
    if (requestedAsOfDate && activeDates.includes(requestedAsOfDate)) {
      asOfDate = requestedAsOfDate;
    } else if (repriceBasis === "A") {
      // Matches the pre-existing default exactly: closest available date on
      // or before periodB's month-end.
      asOfDate = closestDateAtOrBefore(datesForA, lastDayOfReportMonth(periodB));
    } else {
      // Basis B's dates always run forward from periodB's own report month --
      // there's no "month-end" equivalent to default to, so default to the
      // freshest available date instead.
      asOfDate = datesForB.length > 0 ? datesForB[datesForB.length - 1] : null;
    }

    const rows = await getAumGrowthComparison(periodA, periodB, { basis: repriceBasis, asOfDate });
    return NextResponse.json({ periods, periodA, periodB, rows, datesForA, datesForB, repriceBasis, asOfDate });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to compute AUM growth comparison" }, { status: 500 });
  }
}
