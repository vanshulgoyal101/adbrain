import "server-only";

import { recordProductEvent } from "@/lib/observability/logger";

export type MetaErrorDetails = { userTitle?: string; fbtraceId?: string; path?: string };

export class MetaError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: number,
    readonly subcode?: number,
    /** #615: Meta's own diagnosis for telemetry; never tokens or request bodies. */
    readonly details?: MetaErrorDetails,
  ) {
    super(message);
    this.name = "MetaError";
  }
}

/** #1838: Meta's rate limits: app (4), user/account (17, 613, 80000–80014), Page (32). */
export function isThrottleCode(code: number | undefined): boolean {
  return code === 4 || code === 17 || code === 32 || code === 613 || (code !== undefined && code >= 80000 && code <= 80014);
}

/**
 * #1838: scope says who waits (the app, an ad account, or a Page); crons skip, but a person's pause is still tried.
 */
export class MetaThrottledError extends MetaError {
  readonly reason = "rate_limited" as const;
  constructor(message: string, status: number | undefined, code: number | undefined, subcode: number | undefined,
    readonly scope: "app" | "account" | "page", readonly retryAfterMs: number, details?: MetaErrorDetails) {
    super(message, status, code, subcode, details);
    this.name = "MetaThrottledError";
  }
}

/** The longest wait from Meta's usage headers or Retry-After; null if none. */
export function throttleWaitMs(headers: Headers): number | null {
  const waits: number[] = [];
  const retryAfter = headers.get("retry-after")?.trim();
  if (retryAfter) {
    if (/^\d+$/.test(retryAfter)) waits.push(Number(retryAfter) * 1000);
    else {
      const date = Date.parse(retryAfter);
      if (Number.isFinite(date)) waits.push(Math.max(0, date - Date.now()));
    }
  }
  try {
    const usage = JSON.parse(headers.get("x-business-use-case-usage") ?? "{}") as Record<string, { estimated_time_to_regain_access?: number }[]>;
    for (const rows of Object.values(usage)) for (const row of Array.isArray(rows) ? rows : []) {
      if (typeof row?.estimated_time_to_regain_access === "number") waits.push(row.estimated_time_to_regain_access * 60_000);
    }
  } catch {}
  try {
    const account = JSON.parse(headers.get("x-ad-account-usage") ?? "{}") as { reset_time_duration?: number };
    if (typeof account.reset_time_duration === "number") waits.push(account.reset_time_duration * 1000);
  } catch {}
  const longest = Math.max(0, ...waits.filter((wait) => Number.isFinite(wait)));
  return longest > 0 ? longest : null;
}

/** #757: Graph 190 (any subcode) means the token is dead. */
export function isMetaReauthError(error: unknown): error is MetaError {
  return error instanceof MetaError && error.code === 190;
}

export function isMetaReadInterruption(error: unknown): boolean {
  return error instanceof MetaThrottledError || isMetaReauthError(error) || (error instanceof Error && error.name === "AbortError");
}

/** A short, loggable code for a failed Graph call: Meta's code/subcode, else the HTTP status. */
export function metaErrorCode(error: unknown): string {
  if (error instanceof MetaError) return error.code ? `${error.code}${error.subcode ? `.${error.subcode}` : ""}` : `http.${error.status ?? "unknown"}`;
  return error instanceof Error && error.name === "TimeoutError" ? "timeout" : "unknown";
}

export function optionalAdResultsFailure(error: unknown): null {
  if (isMetaReadInterruption(error)) throw error;
  recordProductEvent({ kind: "system", name: "meta.ad_results", outcome: "failed", attributes: { errorCode: metaErrorCode(error) } });
  return null;
}
