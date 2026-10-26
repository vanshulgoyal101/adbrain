import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, readJson } from "@/lib/api";
import { audienceChangeSchema, CampaignEditError, editCampaignAudience } from "@/lib/campaign/edit-service";
import { ConnectionAccessError, requireOwnedBusiness } from "@/lib/meta/connection-access";
import { observeRoute } from "@/lib/observability/logger";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const bodySchema = z.object({
  change: audienceChangeSchema,
  preview: z.boolean().optional(),
  idempotencyKey: z.string().min(8).max(200),
}).strict();

export const POST = observeRoute("/api/campaigns/[id]/audience", "POST", async (
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiError("Unauthorized", 401);

  const parsed = bodySchema.safeParse(await readJson<unknown>(req));
  if (!parsed.success) return apiError("Send an audience change and an idempotencyKey of 8 to 200 characters.", 400);
  const { change, preview, idempotencyKey } = parsed.data;

  // RLS scopes this to the user's own campaigns.
  const { data: campaign } = await supabase.from("campaigns").select("business_id").eq("id", id).maybeSingle();
  if (!campaign) return apiError("Campaign not found", 404);

  try {
    const context = await requireOwnedBusiness(campaign.business_id);
    if (preview) return NextResponse.json({ ok: true, preview: await editCampaignAudience(context, id, change, { preview: true, idempotencyKey }) });
    const result = await editCampaignAudience(context, id, change, { idempotencyKey });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    if (error instanceof CampaignEditError) return NextResponse.json({ error: error.message, retryable: error.retryable }, { status: error.status });
    if (error instanceof ConnectionAccessError) return apiError(error.message, error.code === "CONFLICT" ? 409 : error.code === "UNAUTHENTICATED" ? 401 : 400);
    console.error("[campaign.edit]", error);
    return apiError("Could not change the audience.", 500);
  }
});
