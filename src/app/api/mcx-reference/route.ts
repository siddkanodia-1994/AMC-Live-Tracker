import { NextResponse } from "next/server";
import { getMcxReferenceRows } from "@/lib/mcx/compute";

export async function GET() {
  try {
    const rows = await getMcxReferenceRows();
    return NextResponse.json({ rows, computedAt: new Date().toISOString() });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to compute MCX reference rows" }, { status: 500 });
  }
}
