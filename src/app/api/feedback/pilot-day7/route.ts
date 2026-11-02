import { NextResponse } from "next/server";
import { z } from "zod";
import { daysSinceLaunch, type PilotDay7Reason, PILOT_DAY7_ANSWERS, PILOT_DAY7_DISMISSED, PILOT_DAY7_EVENT, PILOT_DAY7_REASONS, pilotDay7Visible } from "@/lib/feedback/pilot-day7";
import { pilotDay7Facts } from "@/lib/feedback/pilot-day7-store";
import { ConnectionAccessError, requireOwnedBusiness } from "@/lib/meta/connection-access";
import { observeRoute, recordProductEvent } from "@/lib/observability/logger";
import { ownerError } from "@/i18n/request-locale";

export const runtime = "nodejs";

/** #1650: the owner's day-7 answer ('would you pay ₹999 a month?') or 'Not now', as one product event. Codes only. */
export const POST = observeRoute("/api/feedback/pilot-day7", "POST", handlePOST);

const bodySchema = z.union([
  z.strictObject({ businessId: z.uuid(), dismiss: z.literal(true) }),
  z.strictObject({ businessId: z.uuid(), answer: z.enum(PILOT_DAY7_ANSWERS), reason: z.string() })
    .refine((body) => (PILOT_DAY7_REASONS[body.answer] as readonly string[]).includes(body.reason)),
]);

async function handlePOST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: await ownerError("chooseAnswer") }, { status: 400 });
  const body = parsed.data;
  try {
    const { businessId } = await requireOwnedBusiness(body.businessId);
    const facts = await pilotDay7Facts(businessId);
    const now = new Date();
    // One answer per business, only while the question is actually showing.
    if (!pilotDay7Visible({ ...facts, now }) || !facts.firstLaunchAt) return NextResponse.json({ error: await ownerError("questionNotOpen") }, { status: 409 });
    if ("dismiss" in body) {
      recordProductEvent({ kind: "action", name: PILOT_DAY7_DISMISSED, outcome: "success", businessId });
    } else {
      recordProductEvent({ kind: "action", name: PILOT_DAY7_EVENT, outcome: "success", businessId,
        attributes: { answer: body.answer, reason: body.reason as PilotDay7Reason, days: daysSinceLaunch(facts.firstLaunchAt, now) } });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof ConnectionAccessError) {
      const status = { UNAUTHENTICATED: 401, NOT_FOUND: 404, FORBIDDEN: 403, CONFLICT: 409, UNAVAILABLE: 503 }[error.code] ?? 503;
      return NextResponse.json({ error: error.message }, { status });
    }
    return NextResponse.json({ error: await ownerError("answerNotSaved") }, { status: 503 });
  }
}
