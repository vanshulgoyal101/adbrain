import { NextResponse } from "next/server";

/** Safely parse a JSON request body; returns null on any parse error. */
export async function readJson<T>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}

/** Standard JSON error response with a client-safe message. */
export function apiError(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

/**
 * Log the real error server-side and return a generic client message, so
 * internal details (table names, constraints, stack traces) never leak.
 */
export function serverError(
  context: string,
  err: unknown,
  clientMessage: string,
  status = 500,
): NextResponse {
  console.error(`[${context}]`, err);
  return NextResponse.json({ error: clientMessage }, { status });
}

/** Upper bound on how many ids a single request may reference. */
export const MAX_BATCH_IDS = 50;
