import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api";
import { recordMediaConsent } from "@/lib/media/consent";
import { mediaSession, ownedBusiness } from "@/lib/media/route-helpers";
import { observeRoute } from "@/lib/observability/logger";
import { rateLimitResponse } from "@/lib/security/rate-limit";

export const runtime = "nodejs";

const body = z.object({ businessId: z.uuid(), rights: z.boolean(), people: z.boolean().default(false) }).strict();

/** #778 slice 3b (#784): saves the owner's rights tick from the upload sheet; `/api/media/sign` checks it. */
export const POST = observeRoute("/api/media/consent", "POST", async (req: Request) => {
  const session = await mediaSession();
  if (session instanceof NextResponse) return session;
  const limited = await rateLimitResponse(`media-consent:${session.user.id}`, { limit: 20, windowMs: 10 * 60_000 });
  if (limited) return limited;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiError("Tick the box above to add your photos.", 400);
  const business = await ownedBusiness(session.client, parsed.data.businessId);
  if (!business) return apiError("Business not found", 404);
  try {
    await recordMediaConsent(session.client, business, { rights: parsed.data.rights, people: parsed.data.people });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Your confirmation couldn't be saved. Try again.";
    return apiError(message, /^Confirm /.test(message) ? 400 : 503);
  }
  return NextResponse.json({ ok: true });
});
