import { NextResponse } from "next/server";
import { getStockHoldingsAcrossAmcs, searchStockCandidates } from "@/lib/aum/stock-search";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const isinParam = url.searchParams.get("isin");
  const q = url.searchParams.get("q");

  try {
    // isin present -- the client already resolved the stock (either the
    // search below returned exactly one candidate, or the user picked one
    // from a disambiguation list) -- skip resolution entirely.
    if (isinParam) {
      const result = await getStockHoldingsAcrossAmcs(isinParam);
      if (!result) {
        return NextResponse.json({ error: "No AMC held this stock in the last few reported months" }, { status: 404 });
      }
      return NextResponse.json({ type: "resolved", result });
    }

    if (!q || !q.trim()) {
      return NextResponse.json({ error: "Missing search query" }, { status: 400 });
    }

    const candidates = await searchStockCandidates(q);
    if (candidates.length === 0) {
      return NextResponse.json({ error: "No stock matched that search" }, { status: 404 });
    }
    if (candidates.length === 1) {
      const result = await getStockHoldingsAcrossAmcs(candidates[0].isin);
      if (!result) {
        return NextResponse.json({ error: "No AMC held this stock in the last few reported months" }, { status: 404 });
      }
      return NextResponse.json({ type: "resolved", result });
    }

    return NextResponse.json({ type: "candidates", candidates });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to search stock holdings" }, { status: 500 });
  }
}
