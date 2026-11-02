import { observeRoute, recordProductEvent, currentRequestId } from "@/lib/observability/logger";
import { NextResponse } from "next/server";
import {
  preflightRequestSchema,
} from "@/lib/campaign/connect-contracts";
import { buildCampaignPreflightLoaders } from "@/lib/campaign/preflight-runtime";
import { prepareCampaignReview } from "@/lib/campaign/preflight-service";
import {
  ConnectionAccessError,
  requireOwnedBusiness,
} from "@/lib/meta/connection-access";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// #681: the owner sees this text as is, so it names the way out. A draft that's gone or not theirs has the same fix.
const DRAFT_GONE = "This campaign draft has expired or was removed. Reload the page and set up the campaign again. Nothing was sent to Meta.";

function errorResponse(
  requestId: string,
  status: number,
  code: "UNAUTHENTICATED" | "NOT_FOUND" | "FORBIDDEN" | "INVALID_INPUT" | "CONFLICT" | "UNAVAILABLE",
  message: string,
  retryable = false,
) {
  return NextResponse.json(
    { ok: false, error: { code, message, retryable }, requestId },
    { status },
  );
}

export const POST = observeRoute("/api/campaigns/preflight", "POST", handlePOST);

async function handlePOST(request: Request) {
  const started = performance.now();
  const requestId = currentRequestId();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return errorResponse(requestId, 401, "UNAUTHENTICATED", "Sign in required.");

  const parsed = preflightRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorResponse(requestId, 400, "INVALID_INPUT", "A valid business, draft, and version are required.");

  let actor;
  try {
    actor = await requireOwnedBusiness(parsed.data.businessId);
  } catch (error) {
    if (error instanceof ConnectionAccessError) {
      const status = error.code === "UNAUTHENTICATED" ? 401 : error.code === "FORBIDDEN" ? 403 : error.code === "NOT_FOUND" ? 404 : 503;
      return errorResponse(requestId, status, error.code === "NOT_FOUND" ? "NOT_FOUND" : error.code, error.message, status >= 500);
    }
    return errorResponse(requestId, 503, "UNAVAILABLE", "Business access could not be checked.", true);
  }

  try {
    const result = await prepareCampaignReview(
      buildCampaignPreflightLoaders(supabase, actor),
      {
        actor,
        draftId: parsed.data.draftId,
        requestedDraftVersion: parsed.data.draftVersion,
        now: new Date().toISOString(),
      },
    );

    if (result.kind === "not_found") return errorResponse(requestId, 404, "NOT_FOUND", DRAFT_GONE);
    if (result.kind === "forbidden") return errorResponse(requestId, 403, "FORBIDDEN", DRAFT_GONE);
    if (result.kind === "stale") return errorResponse(requestId, 409, "CONFLICT", "Draft changed in another tab. Review the latest version.", true);
    // #688: every blocker's own reason, so production can rank which fix owners need.
    const blockerCodes = result.review.blockers.map((blocker) => blocker.reason ?? blocker.code);
    recordProductEvent({ kind: "workflow", name: "campaign.review", outcome: result.review.canCreatePaused ? "success" : "rejected",
      businessId: actor.businessId, durationMs: Math.round(performance.now() - started),
      attributes: { failedCount: result.review.blockers.length, errorCode: blockerCodes[0], blockerCodes, destination: result.review.destination } });
    return NextResponse.json(
      { ok: true, data: result.review, requestId },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof ConnectionAccessError) {
      const status = error.code === "CONFLICT" ? 409 : error.code === "UNAUTHENTICATED" ? 401 : 503;
      return errorResponse(requestId, status, error.code === "CONFLICT" ? "CONFLICT" : error.code, error.message, status >= 500);
    }
    return errorResponse(requestId, 503, "UNAVAILABLE", "Couldn't check your campaign just now. Nothing was sent to Meta. Try again in a minute.", true);
  }
}