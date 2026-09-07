import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { apiError, readJson, serverError } from "@/lib/api";
import { logEvent } from "@/lib/audit";
import { wouldExceedCap } from "@/lib/campaign/spend";
import { MetaError, friendlyMetaError } from "@/lib/meta/client";
import {
  ConnectionAccessError,
  requireOwnedBusiness,
  withMetaConnection,
} from "@/lib/meta/connection-access";
import { getCampaignSpend, getSpendLimits } from "@/lib/supabase/queries";
import { createClient } from "@/lib/supabase/server";
import { campaignActivationPatchSchema } from "@/lib/campaign/connect-contracts";
import { readStoredCampaignBinding } from "@/lib/campaign/binding";
import { activationConfirmationPayload } from "@/lib/campaign/activation";

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

  const body = await readJson<unknown>(req);
  const parsed = campaignActivationPatchSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(
      'status must be "paused", or "active" with a fresh confirmationDigest and connectionGeneration',
      400,
    );
  }
  const action = parsed.data.status;

  // RLS scopes this to the user's own campaigns.
  const { data: campaign } = await supabase
    .from("campaigns")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!campaign) return apiError("Campaign not found", 404);

  // Spend guardrail: block turning a campaign on if it would push the weekly
  // commitment past the business's cap.
  if (action === "active") {
    const [limits, spend] = await Promise.all([
      getSpendLimits(campaign.business_id),
      getCampaignSpend(campaign.business_id),
    ]);
    const otherActive = spend.filter((c) => c.status === "active" && c.id !== id);
    const { exceeds, projectedAfter } = wouldExceedCap(
      otherActive,
      campaign.daily_budget ?? 0,
      limits.weeklyCapRupees,
    );
    if (exceeds) {
      const fmt = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
      return apiError(
        `Activating this would commit about ${fmt(projectedAfter)}/week, over your ${fmt(limits.weeklyCapRupees!)}/week cap. Raise the cap in Settings or pause another campaign first.`,
        422,
      );
    }
  }

  if (!campaign.meta_campaign_id) {
    return apiError("This campaign isn't linked to Meta yet.", 400);
  }

  const storedBinding = readStoredCampaignBinding(campaign);
  if (
    !storedBinding.metaAdAccountId ||
    !storedBinding.metaPageId ||
    storedBinding.metaConnectionGeneration === null
  ) {
    return apiError("This campaign needs account reconciliation before it can be changed.", 409);
  }
  if (
    action === "active" &&
    parsed.data.connectionGeneration !== storedBinding.metaConnectionGeneration
  ) {
    return apiError("Meta connection changed; review the campaign again.", 409);
  }

  try {
    const context = await requireOwnedBusiness(campaign.business_id);
    await withMetaConnection(
      context,
      {
        purpose: action === "active" ? "activate" : "pause",
        binding: {
          adAccountId: storedBinding.metaAdAccountId,
          pageId: storedBinding.metaPageId,
        },
        expectedGeneration: storedBinding.metaConnectionGeneration,
      },
      async (meta, connection) => {
        if (action === "active" && connection.capabilities.canActivate.state !== "available") {
          throw new ConnectionAccessError(
            "UNAVAILABLE",
            "Meta has not confirmed campaign activation access.",
          );
        }
        if (parsed.data.status === "active") {
          if (!Number.isFinite(campaign.daily_budget) || (campaign.daily_budget ?? 0) <= 0 || connection.selected?.currency !== "INR") {
            throw new ConnectionAccessError("UNAVAILABLE", "Campaign budget and currency must be verified before activation.");
          }
          const expectedDigest = createHash("sha256").update(activationConfirmationPayload(campaign, connection)).digest("hex");
          if (parsed.data.confirmationDigest !== expectedDigest) {
            throw new ConnectionAccessError("CONFLICT", "Campaign review changed; review the current budget and Meta assets again.");
          }
        }
        await meta.updateCampaignStatus(
          campaign.meta_campaign_id!,
          action === "active" ? "ACTIVE" : "PAUSED",
        );
      },
    );
  } catch (err) {
    if (err instanceof ConnectionAccessError) {
      return apiError(
        err.message,
        err.code === "CONFLICT" ? 409 : err.code === "UNAUTHENTICATED" ? 401 : 400,
      );
    }
    if (err instanceof MetaError) {
      return apiError(friendlyMetaError(err), err.status && err.status >= 500 ? 502 : 400);
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

  const storedBinding = readStoredCampaignBinding(campaign);
  if (
    !storedBinding.metaAdAccountId ||
    !storedBinding.metaPageId ||
    storedBinding.metaConnectionGeneration === null
  ) {
    return NextResponse.json(
      { error: "This campaign needs account reconciliation before it can be deleted." },
      { status: 409 },
    );
  }

  // Remove it from Meta first (best-effort — it may already be gone there).
  let metaDeleted = false;
  try {
    const context = await requireOwnedBusiness(campaign.business_id);
    await withMetaConnection(
      context,
      {
        purpose: "delete",
        binding: {
          adAccountId: storedBinding.metaAdAccountId,
          pageId: storedBinding.metaPageId,
        },
        expectedGeneration: storedBinding.metaConnectionGeneration,
      },
      async (meta) => {
        if (campaign.meta_campaign_id) await meta.deleteObject(campaign.meta_campaign_id);
      },
    );
    metaDeleted = Boolean(campaign.meta_campaign_id);
  } catch (err) {
    if (err instanceof ConnectionAccessError) {
      return NextResponse.json({ error: err.message }, { status: err.code === "CONFLICT" ? 409 : 400 });
    }
    // A campaign already deleted in Meta shouldn't block local cleanup.
    console.error("[campaign.delete] Meta delete failed", err);
    if (err instanceof MetaError && err.status && err.status >= 500) {
      return NextResponse.json(
        { error: "Meta couldn't delete this campaign right now — try again." },
        { status: 502 },
      );
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
