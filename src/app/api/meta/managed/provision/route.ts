import { observeRoute, currentRequestId, recordProductEvent } from "@/lib/observability/logger";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { managedFail as fail, ownedManagedAttempt } from "@/lib/meta/managed-attempt";
import { runManagedProvisioning, runnerDeps } from "@/lib/meta/managed-provision-runner";

export const runtime = "nodejs";
export const maxDuration = 60;

// #521 (2-Tier): set up the caller's managed child business and ad account. Off unless MANAGED_ACCOUNTS_ENABLED.
export const POST = observeRoute("/api/meta/managed/provision", "POST", handlePOST);

const bodySchema = z.object({ attemptId: z.string().uuid() });

const OWNER_MESSAGES: Record<string, string> = {
  PROVISIONING_IN_PROGRESS: "AdBrain is already setting up your ad account. Check again in a minute.",
  CUSTOMER_REAUTH_REQUIRED: "Your Facebook connection has expired. Connect Facebook again to continue.",
  PAGE_NOT_LINKED: "Choose your Facebook Page first.",
  PAGE_ADMIN_REQUIRED: "You need to be an admin of your Facebook Page. Ask the Page's admin to add you, then try again.",
  PAGE_IN_OTHER_BUSINESS: "Your Page belongs to another business on Facebook. Ask that business to share it, or choose another Page.",
  PAGE_OWNER_DISALLOWED: "Facebook doesn't allow this Page for a new ad account. Choose another Page or contact AdBrain.",
  NOT_PERMITTED: "Facebook hasn't given AdBrain permission for this yet. AdBrain has been told; try again later.",
  META_BUSY: "Facebook is busy right now. Try again in a few minutes.",
  META_TIMEOUT: "Facebook is busy right now. Try again in a few minutes.",
  META_NETWORK: "Facebook didn't answer. Try again in a few minutes.",
  NOT_CONFIGURED: "Managed ad accounts aren't available yet.",
};

async function handlePOST(request: NextRequest) {
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return fail(400, "INVALID_INPUT", "A Facebook connection is required.");
  const owned = await ownedManagedAttempt(body.data.attemptId);
  if (!owned.ok) return owned.response;
  const { businessId, userId, tokenId } = owned.attempt;
  const result = await runManagedProvisioning({ businessId, customerTokenId: tokenId, requestId: currentRequestId() }, runnerDeps(businessId, userId));
  recordProductEvent({ kind: "workflow", name: "managed.provision", businessId, outcome: result.ok ? "success" : result.retryable ? "failed" : "rejected",
    attributes: result.ok ? {} : { errorCode: result.code } });
  if (result.ok) return NextResponse.json({ ok: true, data: { state: result.state, adAccountId: result.adAccountId }, requestId: currentRequestId() });
  const message = OWNER_MESSAGES[result.code] ?? "Your ad account couldn't be set up. AdBrain has been told and will follow up.";
  const status = result.code === "PROVISIONING_IN_PROGRESS" || !result.retryable && result.code !== "NOT_CONFIGURED" ? 409 : 503;
  return fail(status, result.code, message);
}
