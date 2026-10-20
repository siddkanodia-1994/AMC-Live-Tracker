import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { amcListedStock, amcs } from "@/lib/db/schema";

// The 8 AMCs with their own listed stock (Stock Correlation tab's
// universe) -- just {id, slug, overviewName}, independent of any heavier
// per-tab data, since the Gold/Silver blend toggle lives in the global
// header and needs this list regardless of which page is active.
export async function GET() {
  try {
    const rows = await db
      .select({ id: amcs.id, slug: amcs.slug, overviewName: amcs.overviewName })
      .from(amcListedStock)
      .innerJoin(amcs, eq(amcListedStock.amcId, amcs.id))
      .orderBy(amcs.overviewName);
    return NextResponse.json({ amcs: rows });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to list listed-stock AMCs" }, { status: 500 });
  }
}
