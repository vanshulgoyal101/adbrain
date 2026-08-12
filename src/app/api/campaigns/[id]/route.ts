import { NextResponse } from "next/server";
import { apiError, readJson, serverError } from "@/lib/api";
import { logEvent } from "@/lib/audit";
import { MetaError, metaClientFromEnv } from "@/lib/meta/client";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Pause or resume a campaign. Updates the status on Meta, then mirrors it
 * locally so the dashboard reflects reality immediately.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiError("Unauthorized", 401);

  const body = await readJson<{ status?: string }>(req);
  const action = (body?.status ?? "").toLowerCase();
  if (action !== "active" && action !== "paused") {
    return apiError('status must be "active" or "paused"', 400);
  }

  // RLS scopes this to the user's own campaigns.
  const { data: campaign } = await supabase
    .from("campaigns")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!campaign) return apiError("Campaign not found", 404);

  const meta = metaClientFromEnv();
  if (!meta || !campaign.meta_campaign_id) {
    return apiError("This campaign isn't linked to Meta yet.", 400);
  }

  try {
    await meta.updateCampaignStatus(
      campaign.meta_campaign_id,
      action === "active" ? "ACTIVE" : "PAUSED",
    );
  } catch (err) {
    if (err instanceof MetaError) {
      return apiError(err.message, err.status && err.status >= 500 ? 502 : 400);
    }
    return serverError("campaign.status", err, "Could not update the campaign.");
  }

  const { error } = await supabase
    .from("campaigns")
    .update({ status: action })
    .eq("id", id);
  if (error) {
    return serverError("campaign.status", error, "Could not update the campaign.");
  }

  await logEvent({
    businessId: campaign.business_id,
    action: action === "active" ? "campaign.resume" : "campaign.pause",
    entityType: "campaign",
    entityId: id,
    metaObjectId: campaign.meta_campaign_id,
    reason: `${action === "active" ? "Resumed" : "Paused"} campaign "${campaign.name ?? id}"`,
  });

  return NextResponse.json({ ok: true, status: action });
}

/** Delete a campaign from Meta (best-effort) and remove it from AdBrain. */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // RLS scopes this to the user's own campaigns.
  const { data: campaign } = await supabase
    .from("campaigns")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!campaign) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  // Remove it from Meta first (best-effort — it may already be gone there).
  let metaDeleted = false;
  const meta = metaClientFromEnv();
  if (meta && campaign.meta_campaign_id) {
    try {
      await meta.deleteObject(campaign.meta_campaign_id);
      metaDeleted = true;
    } catch (err) {
      // A campaign already deleted in Meta shouldn't block local cleanup.
      console.error("[campaign.delete] Meta delete failed", err);
      if (err instanceof MetaError && err.status && err.status >= 500) {
        return NextResponse.json(
          { error: "Meta couldn't delete this campaign right now — try again." },
          { status: 502 },
        );
      }
    }
  }

  const { error } = await supabase.from("campaigns").delete().eq("id", id);
  if (error) {
    return serverError("campaign.delete", error, "Could not delete the campaign.");
  }

  await logEvent({
    businessId: campaign.business_id,
    action: "campaign.delete",
    entityType: "campaign",
    entityId: id,
    metaObjectId: campaign.meta_campaign_id,
    reason: `Deleted campaign "${campaign.name ?? id}"`,
    details: { metaDeleted },
  });

  return NextResponse.json({ ok: true, metaDeleted });
}
