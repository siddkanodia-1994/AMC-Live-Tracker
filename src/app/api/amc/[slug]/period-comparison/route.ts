import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { amcs } from "@/lib/db/schema";
import { getPeriodComparison } from "@/lib/aum/period-comparison";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const [amc] = await db.select({ id: amcs.id }).from(amcs).where(eq(amcs.slug, slug));
  if (!amc) {
    return NextResponse.json({ error: `No AMC found with slug "${slug}"` }, { status: 404 });
  }

  try {
    const result = await getPeriodComparison(amc.id);
    return NextResponse.json(result);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to compute period comparison" }, { status: 500 });
  }
}
