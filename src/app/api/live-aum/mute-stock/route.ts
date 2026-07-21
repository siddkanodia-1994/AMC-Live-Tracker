import { NextResponse } from "next/server";
import { computeLiveAum, NoDataImportedError } from "@/lib/aum/compute-live-aum";
import { acceptLastCloseReason } from "@/lib/aum/last-close-mute";

const MAX_REASON_LENGTH = 500;

// No auth gate -- explicitly chosen over Admin-only during planning, same
// public precedent as Check now / Ignore for today, despite this being a
// more permanent action (open to any visitor -- see plan file).
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const isin = typeof body?.isin === "string" ? body.isin.trim() : "";
    const reason = typeof body?.reason === "string" ? body.reason.trim() : "";

    if (!isin || !reason) {
      return NextResponse.json({ error: "isin and reason are required" }, { status: 400 });
    }
    if (reason.length > MAX_REASON_LENGTH) {
      return NextResponse.json({ error: `reason must be ${MAX_REASON_LENGTH} characters or fewer` }, { status: 400 });
    }

    const current = await computeLiveAum({ forceRefresh: false });
    const isFlagged = current.lastCloseStocks.some((s) => s.isin === isin);
    if (!isFlagged) {
      return NextResponse.json({ error: "This ISIN isn't currently flagged as last-close" }, { status: 400 });
    }

    await acceptLastCloseReason(isin, reason);
    const fresh = await computeLiveAum({ forceRefresh: true });
    return NextResponse.json(fresh);
  } catch (err) {
    if (err instanceof NoDataImportedError) {
      return NextResponse.json({ error: err.message, code: "NO_DATA" }, { status: 404 });
    }
    console.error(err);
    return NextResponse.json({ error: "Failed to mute stock" }, { status: 500 });
  }
}
