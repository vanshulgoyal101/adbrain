import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, readJson } from "@/lib/api";
import { CampaignEditError, switchCampaignAudience } from "@/lib/campaign/edit-service";
import { ConnectionAccessError, requireOwnedBusiness } from "@/lib/meta/connection-access";
import { observeRoute } from "@/lib/observability/logger";
import { createClient } from "@/lib/supabase/server";
import { ownerRefusal } from "@/lib/campaign/campaign-owner";

export const runtime = "nodejs";
export const maxDuration = 60;

const bodySchema = z.object({ operationId: z.string().uuid(), action: z.enum(["switch", "cancel"]) }).strict();

/** #765 (b): turn a waiting new-audience copy on in place of the running ad set, or cancel (delete) the copy. */
export const POST = observeRoute("/api/campaigns/[id]/audience/switch", "POST", async (
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiError("Unauthorized", 401);

  const parsed = bodySchema.safeParse(await readJson<unknown>(req));
  if (!parsed.success) return apiError("Send the operationId and an action of switch or cancel.", 400);

  // RLS scopes this to the user's own campaigns.
  const { data: campaign } = await supabase.from("campaigns").select("business_id,meta_campaign_id").eq("id", id).maybeSingle();
  if (!campaign) return apiError("Campaign not found", 404);
  const refused = await ownerRefusal(campaign.business_id, campaign.meta_campaign_id);
  if (refused) return refused;

  try {
    const context = await requireOwnedBusiness(campaign.business_id);
    const result = await switchCampaignAudience(context, id, parsed.data.operationId, parsed.data.action);
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    if (error instanceof CampaignEditError) return NextResponse.json({ error: error.message, retryable: error.retryable, ...error.code ? { code: error.code } : {} }, { status: error.status });
    if (error instanceof ConnectionAccessError) return apiError(error.message, error.code === "CONFLICT" ? 409 : error.code === "UNAUTHENTICATED" ? 401 : 400);
    console.error("[campaign.edit.switch]", error);
    return apiError("Could not switch the audience.", 500);
  }
});
