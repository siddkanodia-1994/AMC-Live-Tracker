import { NextResponse } from "next/server";

/**
 * Wraps a route handler with a catch-all 500 JSON error response, so
 * unexpected errors don't leak an HTML stack trace and every /api/admin/*
 * route doesn't need to repeat the same try/catch.
 */
export function withErrorHandling<Args extends unknown[]>(
  handler: (request: Request, ...args: Args) => Promise<Response>
) {
  return async (request: Request, ...args: Args): Promise<Response> => {
    try {
      return await handler(request, ...args);
    } catch (err) {
      console.error(err);
      const message = err instanceof Error ? err.message : "Unknown error";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  };
}
