import { NextResponse } from "next/server";
import { z } from "zod";
import { ownerError } from "@/i18n/request-locale";
import { apiError } from "@/lib/api";
import { MediaConsentError, recordMediaConsent } from "@/lib/media/consent";
import { mediaSession, ownedBusiness } from "@/lib/media/route-helpers";
import { observeRoute } from "@/lib/observability/logger";
import { rateLimitResponse } from "@/lib/security/rate-limit";

export const runtime = "nodejs";

const body = z.object({ businessId: z.uuid(), rights: z.boolean(), people: z.boolean().default(false) }).strict();

/** #778 slice 3b (#784): saves the owner's rights tick (upload sheet, or Review's confirm link); `/api/media/sign` and Review check it. Works with uploads off: Brand photos in an ad need it too. */
export const POST = observeRoute("/api/media/consent", "POST", async (req: Request) => {
  const session = await mediaSession({ whenUploadsOff: true });
  if (session instanceof NextResponse) return session;
  const limited = await rateLimitResponse(`media-consent:${session.user.id}`, { limit: 20, windowMs: 10 * 60_000 });
  if (limited) return limited;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiError(await ownerError("mediaRightsRequired"), 400);
  const business = await ownedBusiness(session.client, parsed.data.businessId);
  if (!business) return apiError(await ownerError("businessMissing"), 404);
  try {
    await recordMediaConsent(session.client, business, { rights: parsed.data.rights, people: parsed.data.people });
  } catch (error) {
    const refusal = error instanceof MediaConsentError ? error : new MediaConsentError("mediaConsentNotSaved", 503);
    return apiError(await ownerError(refusal.ownerKey), refusal.status);
  }
  return NextResponse.json({ ok: true });
});
