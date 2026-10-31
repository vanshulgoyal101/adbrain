import { observeRoute, currentRequestId, recordProductEvent } from "@/lib/observability/logger";
import { NextResponse } from "next/server";
import { z } from "zod";
import { ConnectionAccessError, managedRouteUser, requireOwnedBusiness } from "@/services/business-access";
import { runManagedBilling } from "@/services/managed-billing";

export const runtime = "nodejs";

const fail = (status: number, code: string, message: string) =>
  NextResponse.json({ ok: false, error: { code, message, retryable: status >= 500 }, requestId: currentRequestId() }, { status, headers: { "Cache-Control": "no-store" } });

const META_MESSAGES: Record<string, string> = {
  NOT_PERMITTED: "Facebook hasn't given AdBrain permission for this yet. AdBrain has been told; try again later.",
  META_BUSY: "Facebook is busy right now. Try again in a few minutes.",
  META_TIMEOUT: "Facebook is busy right now. Try again in a few minutes.",
  META_NETWORK: "Facebook didn't answer. Try again in a few minutes.",
};

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("invite"), businessId: z.uuid(), email: z.string().max(320) }),
  z.object({ action: z.literal("check"), businessId: z.uuid() }),
]);

export const POST = observeRoute("/api/managed/billing", "POST", handlePOST);

/** #2359: invite the owner's person to add their card in Meta; 'Check again' reads the ad account's funding from Meta. */
async function handlePOST(request: Request) {
  const gate = await managedRouteUser();
  if (!gate.ok) return gate.response;
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return fail(400, "INVALID_INPUT", "A business is required.");
  let actor;
  try {
    actor = await requireOwnedBusiness(body.data.businessId);
  } catch (error) {
    if (error instanceof ConnectionAccessError) {
      return fail(error.code === "UNAUTHENTICATED" ? 401 : error.code === "NOT_FOUND" ? 404 : 403, error.code, error.message);
    }
    return fail(503, "UNAVAILABLE", "Business access could not be checked.");
  }
  const name = `managed.billing.${body.data.action}`;
  const result = await runManagedBilling(actor.businessId, body.data.action === "invite" ? { action: "invite", email: body.data.email } : { action: "check" });
  if (result.ok) {
    recordProductEvent({ kind: "workflow", name, businessId: actor.businessId, outcome: "success" });
    return NextResponse.json({ ok: true, data: result.data, requestId: currentRequestId() }, { headers: { "Cache-Control": "no-store" } });
  }
  recordProductEvent({ kind: "workflow", name, businessId: actor.businessId, outcome: result.retryable ? "failed" : "rejected", attributes: { errorCode: result.code } });
  return fail(result.retryable ? 503 : 409, result.code,
    META_MESSAGES[result.code] ?? "We couldn't reach your ad account on Facebook just now. AdBrain has been told; try again later.");
}
