import { NextResponse } from "next/server";
import { withAdminAuth } from "@/lib/api/with-admin-auth";
import { getDhanTokenStatus, setDhanToken } from "@/lib/dhan/token";
import { invalidateLiveAumCache } from "@/lib/aum/cache";

export const GET = withAdminAuth(async () => {
  const status = await getDhanTokenStatus();
  return NextResponse.json(status);
});

export const POST = withAdminAuth(async (request: Request) => {
  const body = await request.json();
  const token = typeof body?.dhanAccessToken === "string" ? body.dhanAccessToken.trim() : "";

  if (!token) {
    return NextResponse.json({ error: "dhanAccessToken is required" }, { status: 400 });
  }

  await setDhanToken(token);
  invalidateLiveAumCache();

  const status = await getDhanTokenStatus();
  return NextResponse.json(status);
});
