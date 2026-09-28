import { NextResponse } from "next/server";
import { computeLiveAumForAmcs } from "@/lib/aum/compute-live-aum";

const MAX_AMCS = 5;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const slugsParam = url.searchParams.get("slugs");
  const slugs = slugsParam
    ? [...new Set(slugsParam.split(",").map((s) => s.trim()).filter(Boolean))]
    : [];

  if (slugs.length === 0) {
    return NextResponse.json({ error: "No AMC slugs provided" }, { status: 400 });
  }
  if (slugs.length > MAX_AMCS) {
    return NextResponse.json({ error: `At most ${MAX_AMCS} AMCs can be compared at once` }, { status: 400 });
  }

  try {
    const results = await computeLiveAumForAmcs(slugs);
    const missing = slugs.filter((_, i) => results[i] === null);
    if (missing.length > 0) {
      return NextResponse.json({ error: `No AMC found with slug(s): ${missing.join(", ")}` }, { status: 404 });
    }

    const amcs = results.map((r, i) => ({
      slug: slugs[i],
      overviewName: r!.amc.overviewName,
      holdings: r!.holdings,
    }));
    return NextResponse.json({ amcs });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to compute live AUM for comparison" }, { status: 500 });
  }
}
