import { NextResponse } from "next/server";
import { serverError } from "@/lib/api";
import { logEvent } from "@/lib/audit";
import { MetaError, metaClientFromEnv } from "@/lib/meta/client";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

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
