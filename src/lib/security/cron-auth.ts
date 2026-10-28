import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";

const digest = (value: string) => createHash("sha256").update(value).digest();

/**
 * #1636: the one check every `/api/cron/*` route runs before any read. 404 while CRON_SECRET is unset (so an empty
 * secret can never match "Bearer "), 401 unless the bearer matches. Hashing first makes the compare constant-time
 * whatever the header's length.
 */
export function cronAuthError(request: Request, secret: string = getEnv().CRON_SECRET): NextResponse | null {
  if (!secret) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const given = request.headers.get("authorization") ?? "";
  return timingSafeEqual(digest(given), digest(`Bearer ${secret}`)) ? null : NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
