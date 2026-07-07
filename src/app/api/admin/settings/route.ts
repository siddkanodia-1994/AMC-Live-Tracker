import { NextResponse } from "next/server";
import { withErrorHandling } from "@/lib/api/with-error-handling";
import {
  getActiveDhanClientId,
  getActiveDhanToken,
  getDhanClientIdStatus,
  getDhanTokenStatus,
  setDhanClientId,
  setDhanToken,
} from "@/lib/dhan/token";
import { testDhanCredentials } from "@/lib/dhan/client";
import { invalidateLiveAumCache } from "@/lib/aum/cache";
import { db } from "@/lib/db/client";
import { instrumentMap } from "@/lib/db/schema";
import type { ExchangeSegment } from "@/lib/dhan/types";

export const GET = withErrorHandling(async () => {
  const [dhanToken, dhanClientId] = await Promise.all([getDhanTokenStatus(), getDhanClientIdStatus()]);
  return NextResponse.json({ dhanToken, dhanClientId });
});

export const POST = withErrorHandling(async (request: Request) => {
  const body = await request.json();
  const submittedClientId = typeof body?.dhanClientId === "string" ? body.dhanClientId.trim() : undefined;
  const submittedToken = typeof body?.dhanAccessToken === "string" ? body.dhanAccessToken.trim() : undefined;

  if (submittedClientId === undefined && submittedToken === undefined) {
    return NextResponse.json({ error: "dhanClientId or dhanAccessToken is required" }, { status: 400 });
  }
  if (submittedClientId === "" || submittedToken === "") {
    return NextResponse.json({ error: "Fields cannot be blank if provided" }, { status: 400 });
  }

  // Resolve the pair that will actually be in effect after this save, so the
  // live test call below validates reality -- not just whichever field was
  // touched this time (e.g. a plain "refresh today's token" call still gets
  // validated against whatever client ID is currently active).
  const [effectiveClientId, effectiveToken] = await Promise.all([
    submittedClientId ?? getActiveDhanClientId().catch(() => null),
    submittedToken ?? getActiveDhanToken().catch(() => null),
  ]);

  let warning: string | undefined;
  if (effectiveClientId && effectiveToken) {
    const [sample] = await db.select().from(instrumentMap).limit(1);
    if (sample) {
      const result = await testDhanCredentials(effectiveClientId, effectiveToken, {
        securityId: sample.securityId,
        exchangeSegment: sample.exchangeSegment as ExchangeSegment,
      });
      if (!result.ok && (result.status === 401 || result.status === 403)) {
        return NextResponse.json({ error: result.message }, { status: 400 });
      }
      if (!result.ok) {
        warning = `Could not verify immediately (${result.message}) — saved, but check the Overview banner shortly.`;
      }
    }
  }

  if (submittedClientId !== undefined) await setDhanClientId(submittedClientId);
  if (submittedToken !== undefined) await setDhanToken(submittedToken);
  invalidateLiveAumCache();

  const [dhanToken, dhanClientId] = await Promise.all([getDhanTokenStatus(), getDhanClientIdStatus()]);
  return NextResponse.json({ dhanToken, dhanClientId, warning });
});
