import { NextResponse } from "next/server";
import { requireAdminSecret, UnauthorizedError } from "../auth/admin-guard";

/**
 * Wraps a route handler so every /api/admin/* route gets consistent
 * shared-secret auth (401 JSON) and a catch-all 500 JSON error response,
 * without repeating try/catch in every route file.
 */
export function withAdminAuth<Args extends unknown[]>(
  handler: (request: Request, ...args: Args) => Promise<Response>
) {
  return async (request: Request, ...args: Args): Promise<Response> => {
    try {
      requireAdminSecret(request);
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      console.error(err);
      return NextResponse.json({ error: "Server misconfiguration" }, { status: 500 });
    }

    try {
      return await handler(request, ...args);
    } catch (err) {
      console.error(err);
      const message = err instanceof Error ? err.message : "Unknown error";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  };
}
