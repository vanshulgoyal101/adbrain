import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, readJson } from "@/lib/api";
import { adCopyEditSchema, editAdCopy } from "@/lib/campaign/ad-edit-service";
import { CampaignEditError } from "@/lib/campaign/edit-service";
import { ConnectionAccessError, requireOwnedBusiness } from "@/lib/meta/connection-access";
import { observeRoute } from "@/lib/observability/logger";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const bodySchema = z.object({ change: adCopyEditSchema, idempotencyKey: z.string().min(8).max(200) }).strict();

/** #775: change a launched ad's headline, text or description. The ad goes back to Meta review. */
export const PATCH = observeRoute("/api/campaigns/[id]/ads/[adId]", "PATCH", async (
  req: Request,
  { params }: { params: Promise<{ id: string; adId: string }> },
) => {
  const { id, adId } = await params;
  if (!/^\d{1,30}$/.test(adId)) return apiError("Ad not found", 404);
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiError("Unauthorized", 401);

  const parsed = bodySchema.safeParse(await readJson<unknown>(req));
  if (!parsed.success) return apiError("Send the new words and an idempotencyKey of 8 to 200 characters.", 400);

  // RLS scopes this to the user's own campaigns.
  const { data: campaign } = await supabase.from("campaigns").select("business_id").eq("id", id).maybeSingle();
  if (!campaign) return apiError("Campaign not found", 404);

  try {
    const context = await requireOwnedBusiness(campaign.business_id);
    const result = await editAdCopy(context, id, adId, parsed.data.change, { idempotencyKey: parsed.data.idempotencyKey });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    if (error instanceof CampaignEditError) return NextResponse.json({ error: error.message, retryable: error.retryable }, { status: error.status });
    if (error instanceof ConnectionAccessError) return apiError(error.message, error.code === "CONFLICT" ? 409 : error.code === "UNAUTHENTICATED" ? 401 : 400);
    console.error("[campaign.ad_edit]", error);
    return apiError("Could not change the ad.", 500);
  }
});
