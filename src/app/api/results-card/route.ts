import { NextResponse } from "next/server";
import { z } from "zod";
import { ConnectionAccessError, requireOwnedBusiness } from "@/services/business-access";
import { observeRoute, recordProductEvent } from "@/lib/observability/logger";
import { RESULTS_CARD_EVENTS } from "@/lib/results-card/offer";
import { renderResultsCard } from "@/lib/results-card/render";
import { resultsCardFacts, resultsCardInput } from "@/lib/results-card/store";
import { rateLimitResponse } from "@/lib/security/rate-limit";

export const runtime = "nodejs";

/** #2036: the weekly results card as a JPEG for the owner's WhatsApp Status. Only while the card is offered. */
export const GET = observeRoute("/api/results-card", "GET", handleGET);
/** #2036: the owner saw, shared or skipped the card. Shared or skipped hides it for 7 days. */
export const POST = observeRoute("/api/results-card", "POST", handlePOST);

const businessIdSchema = z.uuid();
const bodySchema = z.strictObject({ businessId: z.uuid(), event: z.enum(["shown", "shared", "dismissed"]) });

async function handleGET(request: Request) {
  const url = new URL(request.url);
  const parsed = businessIdSchema.safeParse(url.searchParams.get("businessId"));
  if (!parsed.success) return NextResponse.json({ error: "Choose a business." }, { status: 400 });
  try {
    const { businessId, userId } = await requireOwnedBusiness(parsed.data);
    const limited = await rateLimitResponse(`results-card:${userId}`, { limit: 20, windowMs: 10 * 60_000 });
    if (limited) return limited;
    const facts = await resultsCardFacts(businessId);
    if (!facts.offered) return NextResponse.json({ error: "There's no results card this week." }, { status: 409 });
    const jpeg = await renderResultsCard(await resultsCardInput(facts, businessId, url.searchParams.get("footer") !== "0"));
    return new Response(Buffer.from(jpeg), { headers: { "content-type": "image/jpeg", "cache-control": "private, no-store" } });
  } catch (error) {
    return failure(error, "The card couldn't be made. Try again.");
  }
}

async function handlePOST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose an action." }, { status: 400 });
  try {
    const { businessId } = await requireOwnedBusiness(parsed.data.businessId);
    const facts = await resultsCardFacts(businessId);
    if (!facts.offered) return NextResponse.json({ error: "There's no results card this week." }, { status: 409 });
    recordProductEvent({ kind: "action", name: RESULTS_CARD_EVENTS[parsed.data.event], outcome: "success", businessId });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return failure(error, "That couldn't be saved. Try again.");
  }
}

function failure(error: unknown, message: string) {
  if (error instanceof ConnectionAccessError) {
    const status = { UNAUTHENTICATED: 401, NOT_FOUND: 404, FORBIDDEN: 403, CONFLICT: 409, UNAVAILABLE: 503 }[error.code] ?? 503;
    return NextResponse.json({ error: error.message }, { status });
  }
  return NextResponse.json({ error: message }, { status: 503 });
}
