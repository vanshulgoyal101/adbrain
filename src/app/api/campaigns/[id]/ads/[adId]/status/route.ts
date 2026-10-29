import { NextResponse } from "next/server";
import { ownerError } from "@/i18n/request-locale";
import { editErrorWords } from "@/lib/campaign/owner-edit-error";
import { z } from "zod";
import { apiError, readJson } from "@/lib/api";
import { adResultsEnabled } from "@/lib/campaign/ad-results-store";
import { setAdDelivery } from "@/lib/campaign/ad-pause-service";
import { CampaignEditError } from "@/lib/campaign/edit-service";
import { ConnectionAccessError, requireOwnedBusiness } from "@/lib/meta/connection-access";
import { observeRoute } from "@/lib/observability/logger";
import { createClient } from "@/lib/supabase/server";
import { ownerRefusal } from "@/lib/campaign/campaign-owner";

export const runtime = "nodejs";
export const maxDuration = 60;

const bodySchema = z.object({ action: z.enum(["pause", "undo"]), reason: z.string().trim().max(200).optional() }).strict();

/**
 * #1045: pause one ad from the campaign card ("costs far more per enquiry than the best ad"), or undo
 * that pause. Off with "Which ad worked" (`AD_RESULTS_ENABLED`).
 */
export const POST = observeRoute("/api/campaigns/[id]/ads/[adId]/status", "POST", async (
  req: Request,
  { params }: { params: Promise<{ id: string; adId: string }> },
) => {
  if (!adResultsEnabled()) return apiError("Not found", 404);
  const { id, adId } = await params;
  if (!/^\d{1,30}$/.test(adId)) return apiError("Ad not found", 404);
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiError("Unauthorized", 401);
  const parsed = bodySchema.safeParse(await readJson<unknown>(req));
  if (!parsed.success) return apiError("Send action 'pause' or 'undo'.", 400);
  // RLS scopes this to the user's own campaigns.
  const { data: campaign } = await supabase.from("campaigns").select("business_id,meta_campaign_id").eq("id", id).maybeSingle();
  if (!campaign) return apiError("Campaign not found", 404);
  const refused = await ownerRefusal(campaign.business_id, campaign.meta_campaign_id);
  if (refused) return refused;
  try {
    const context = await requireOwnedBusiness(campaign.business_id);
    const result = await setAdDelivery(context, id, adId, parsed.data.action, parsed.data.reason);
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    if (error instanceof CampaignEditError) return NextResponse.json({ error: await editErrorWords(error, ownerError), retryable: error.retryable }, { status: error.status });
    if (error instanceof ConnectionAccessError) return apiError(error.message, error.code === "CONFLICT" ? 409 : error.code === "UNAUTHENTICATED" ? 401 : 400);
    console.error("[campaign.ad_pause]", error instanceof Error ? error.name : "error");
    return apiError("Could not change the ad.", 500);
  }
});
