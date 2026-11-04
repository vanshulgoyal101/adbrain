import { NextResponse } from "next/server";
import { z } from "zod";
import { BUSINESS_ACCESS_ERRORS } from "@/i18n/locale";
import { ownerWords } from "@/i18n/request-locale";
import { ConnectionAccessError, readAccountTracking, requireOwnedBusiness } from "@/lib/campaign/tracking-runtime";
import { websiteOpenFor } from "@/lib/campaign/website-gate";
import type { ErrorCode } from "@/lib/meta/connect-contracts";
import { currentRequestId, observeRoute, recordProductEvent } from "@/lib/observability/logger";
import { rateLimitResponse } from "@/lib/security/rate-limit";
import { isSignedOutAuthError } from "@/lib/supabase/auth-error";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const querySchema = z.object({
  businessId: z.uuid(),
  fresh: z.enum(["0", "1"]).optional(),
}).strict();
const accessStatus = { UNAUTHENTICATED: 401, FORBIDDEN: 403, NOT_FOUND: 404, CONFLICT: 409, UNAVAILABLE: 503 } as const;

function failure(requestId: string, status: number, code: ErrorCode, message: string, retryable = false, retryAfter?: string | null) {
  const headers = new Headers({ "Cache-Control": "no-store" });
  if (retryAfter) headers.set("Retry-After", retryAfter);
  return NextResponse.json({ ok: false, error: { code, message, retryable }, requestId }, { status, headers });
}

export const GET = observeRoute("/api/meta/tracking", "GET", async (request: Request) => {
  const requestId = currentRequestId();
  const say = await ownerWords();
  const params = new URL(request.url).searchParams;
  const keys = [...params.keys()];
  const parsed = querySchema.safeParse(Object.fromEntries(params));
  if (!parsed.success || new Set(keys).size !== keys.length) {
    return failure(requestId, 400, "INVALID_INPUT", say("requestLooksWrong"));
  }

  let user;
  try {
    const result = await (await createClient()).auth.getUser();
    if (result.error && isSignedOutAuthError(result.error)) {
      return failure(requestId, 401, "UNAUTHENTICATED", say("signInRequired"));
    }
    if (result.error) {
      recordProductEvent({ kind: "workflow", name: "meta.tracking", outcome: "failed", attributes: { errorCode: "TRACKING_AUTH_UNAVAILABLE" } });
      return failure(requestId, 503, "UNAVAILABLE", say("somethingDidntAnswer"), true);
    }
    user = result.data.user;
  } catch {
    recordProductEvent({ kind: "workflow", name: "meta.tracking", outcome: "failed", attributes: { errorCode: "TRACKING_AUTH_UNAVAILABLE" } });
    return failure(requestId, 503, "UNAVAILABLE", say("somethingDidntAnswer"), true);
  }
  if (!user) return failure(requestId, 401, "UNAUTHENTICATED", say("signInRequired"));
  if (!websiteOpenFor(user)) return failure(requestId, 403, "FORBIDDEN", say("websiteClosed"));

  let actor;
  try {
    actor = await requireOwnedBusiness(parsed.data.businessId);
  } catch (error) {
    if (error instanceof ConnectionAccessError) {
      const status = accessStatus[error.code];
      if (status >= 500) {
        recordProductEvent({ kind: "workflow", name: "meta.tracking", outcome: "failed", attributes: { errorCode: "TRACKING_BUSINESS_UNAVAILABLE" } });
      }
      return failure(requestId, status, error.code, say(BUSINESS_ACCESS_ERRORS[error.code]), status >= 500 || status === 409);
    }
    recordProductEvent({ kind: "workflow", name: "meta.tracking", outcome: "failed", attributes: { errorCode: "TRACKING_BUSINESS_UNAVAILABLE" } });
    return failure(requestId, 503, "UNAVAILABLE", say("businessAccessUnchecked"), true);
  }
  if (actor.userId !== user.id || actor.businessId !== parsed.data.businessId) {
    return failure(requestId, 403, "FORBIDDEN", say("businessAccessDenied"));
  }

  try {
    const limited = await rateLimitResponse(`meta-tracking:${actor.userId}`, { limit: 20, windowMs: 300_000 });
    if (limited) {
      const unavailable = limited.status === 503;
      return failure(requestId, limited.status, unavailable ? "UNAVAILABLE" : "RATE_LIMITED",
        say(unavailable ? "somethingDidntAnswer" : "aiBusy"), true, limited.headers.get("Retry-After"));
    }

    const read = await readAccountTracking(actor, parsed.data.fresh === "1");
    if (read.kind === "reauth_required") {
      recordProductEvent({ kind: "workflow", name: "meta.tracking", outcome: "rejected", businessId: actor.businessId,
        attributes: { errorCode: "TRACKING_REAUTH_REQUIRED" } });
      return failure(requestId, 409, "REAUTH_REQUIRED", say("metaAccessStopped"));
    }
    const unreadable = read.data.status.state === "unreadable";
    recordProductEvent({ kind: "workflow", name: "meta.tracking", outcome: unreadable ? "partial" : "success", businessId: actor.businessId,
      attributes: unreadable ? { errorCode: `TRACKING_${read.data.status.unreadable?.toUpperCase() ?? "UNREADABLE"}` } : {} });
    return NextResponse.json({ ok: true, data: read.data, requestId }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const code = error instanceof ConnectionAccessError ? error.code : "UNAVAILABLE";
    const status = accessStatus[code];
    recordProductEvent({ kind: "workflow", name: "meta.tracking", outcome: status < 500 ? "rejected" : "failed", businessId: actor.businessId,
      attributes: { errorCode: code === "CONFLICT" ? "TRACKING_CONNECTION_CHANGED" : `TRACKING_${code}` } });
    const message = code === "CONFLICT" ? "metaConnectionChanged"
      : code === "UNAVAILABLE" ? "somethingDidntAnswer" : BUSINESS_ACCESS_ERRORS[code];
    return failure(requestId, status, code, say(message), status >= 500 || status === 409);
  }
});
