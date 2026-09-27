import { observeRoute } from "@/lib/observability/logger";
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { apiError, readJson, serverError } from "@/lib/api";
import { logEvent } from "@/lib/audit";
import { wouldExceedCap } from "@/lib/campaign/spend";
import { CampaignDeliveryError, MetaError, friendlyMetaError, type CampaignDeliverySnapshot } from "@/lib/meta/client";
import {
  ConnectionAccessError,
  recheckMetaConnection,
  requireOwnedBusiness,
  withMetaConnection,
} from "@/lib/meta/connection-access";
import { getCampaignSpend, getSpendLimits } from "@/lib/supabase/queries";
import { createClient } from "@/lib/supabase/server";
import { campaignActivationPatchSchema } from "@/lib/campaign/connect-contracts";
import { readStoredCampaignBinding } from "@/lib/campaign/binding";
import { activationConfirmationPayload, intendedCampaignChildren } from "@/lib/campaign/activation";
import { saveCampaign, deleteVerifiedCampaign } from "@/lib/campaign/trusted-write";
import { confirmCustomerCampaign, CustomerBalanceError, getCustomerBalance, reserveCustomerCampaign } from "@/lib/payments/customer-balance";

export const runtime = "nodejs";
export const maxDuration = 60;

export const GET = observeRoute("/api/campaigns/[id]", "GET", async (
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiError("Unauthorized", 401);
  const { data: campaign } = await supabase.from("campaigns").select("*").eq("id", id).maybeSingle();
  if (!campaign) return apiError("Campaign not found", 404);
  const binding = readStoredCampaignBinding(campaign);
  const children = intendedCampaignChildren(campaign);
  if (!campaign.meta_campaign_id || !binding.metaAdAccountId || !binding.metaPageId
    || binding.metaConnectionGeneration === null || !children || !Number.isFinite(campaign.daily_budget)) {
    return apiError("Campaign children or account need reconciliation before activation review.", 409);
  }
  try {
    const context = await requireOwnedBusiness(campaign.business_id);
    await recheckMetaConnection(context, binding.metaConnectionGeneration);
    const delivery = await withMetaConnection(context, {
      purpose: "activate",
      binding: { adAccountId: binding.metaAdAccountId, pageId: binding.metaPageId },
      expectedGeneration: binding.metaConnectionGeneration,
    }, async meta => meta.readCampaignDelivery(campaign.meta_campaign_id!, {
      dailyBudgetRupees: campaign.daily_budget!, status: campaign.status, ...children,
    }));
    return NextResponse.json({ delivery }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof CampaignDeliveryError) return apiError(error.message, 409);
    if (error instanceof ConnectionAccessError) return apiError(error.message, error.code === "UNAUTHENTICATED" ? 401 : 409);
    if (error instanceof MetaError) return apiError(friendlyMetaError(error), error.status && error.status >= 500 ? 502 : 400);
    return serverError("campaign.delivery", error, "Campaign delivery review is unavailable.");
  }
});

/**
 * Pause or resume a campaign. Updates the status on Meta, then mirrors it
 * locally so the dashboard reflects reality immediately.
 */
export const PATCH = observeRoute("/api/campaigns/[id]", "PATCH", handlePATCH);

async function handlePATCH(
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
    const verifiedSpend = await Promise.all([
      getSpendLimits(campaign.business_id),
      getCampaignSpend(campaign.business_id),
    ]).catch(() => null);
    if (!verifiedSpend) return apiError("Spend limits could not be verified. Try again before activating.", 503);
    const [limits, spend] = verifiedSpend;
    const otherActive = spend.filter((c) => c.status === "active" && c.id !== id);
    const projection = wouldExceedCap(
      otherActive,
      campaign.daily_budget ?? 0,
      limits.weeklyCapRupees,
    );
    if (!projection.verified) return apiError("Campaign budgets or the saved cap could not be verified. Sync campaigns and review spend settings before activating.", 503);
    const { exceeds, projectedAfter } = projection;
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
  const children = action === "active" ? intendedCampaignChildren(campaign) : null;
  if (action === "active" && !children) {
    return apiError("Campaign children need reconciliation before activation.", 409);
  }

  let deliveryAfter: CampaignDeliverySnapshot | null = null;
  try {
    const context = await requireOwnedBusiness(campaign.business_id);
    if (action === "active") {
      await recheckMetaConnection(context, storedBinding.metaConnectionGeneration);
    }
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
          const delivery = await meta.verifyCampaignActivation(campaign.meta_campaign_id!, {
            dailyBudgetRupees: campaign.daily_budget!, status: campaign.status, ...children!,
          });
          const expectedDigest = createHash("sha256").update(activationConfirmationPayload(campaign, connection, delivery)).digest("hex");
          if (parsed.data.confirmationDigest !== expectedDigest) {
            throw new ConnectionAccessError("CONFLICT", "Campaign or child review changed; review the current Meta delivery settings again.");
          }
          const reservation = await reserveCustomerCampaign(context, {
            campaignId: id, adAccountId: storedBinding.metaAdAccountId!,
            connectionGeneration: storedBinding.metaConnectionGeneration!, dailyBudgetRupees: campaign.daily_budget!,
            requestKey: parsed.data.confirmationDigest,
          });
          try {
            await meta.enforceCampaignSpendCap(campaign.meta_campaign_id!, reservation.mediaLimitPaise);
            await meta.updateCampaignStatus(campaign.meta_campaign_id!, "ACTIVE");
            deliveryAfter = await meta.verifyCampaignActivation(campaign.meta_campaign_id!, {
              dailyBudgetRupees: campaign.daily_budget!, status: "active", ...children!,
            });
            await confirmCustomerCampaign(context, id, reservation.reservationId, "active");
          } catch (error) {
            await confirmCustomerCampaign(context, id, reservation.reservationId, "uncertain").catch(() => undefined);
            throw error;
          }
          return;
        }
        const reservation = await getCustomerBalance(context)
          .then(balance => balance.reservations.find(item => item.campaignId === id && item.state !== "closed"))
          .catch(() => undefined);
        await meta.updateCampaignStatus(campaign.meta_campaign_id!, "PAUSED");
        if (reservation) await confirmCustomerCampaign(context, id, reservation.reservationId, "paused").catch(() => undefined);
      },
    );
  } catch (err) {
    if (err instanceof CustomerBalanceError) return apiError(err.message, 409);
    if (err instanceof CampaignDeliveryError) return apiError(err.message, 409);
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

  const { error } = await saveCampaign({ businessId: campaign.business_id, userId: user.id }, { status: action }, id)
    .catch(() => ({ error: new Error("Campaign storage unavailable.") }));
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

  return NextResponse.json({ ok: true, status: action, delivery: deliveryAfter });
}

/** Delete a campaign from Meta (best-effort) and remove it from AdBrain. */
export const DELETE = observeRoute("/api/campaigns/[id]", "DELETE", handleDELETE);

async function handleDELETE(
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
    return NextResponse.json(
      { error: "Meta deletion could not be confirmed. The campaign remains in AdBrain so you can check its status." },
      { status: 502 },
    );
  }

  const { error } = await deleteVerifiedCampaign({ businessId: campaign.business_id, userId: user.id }, id)
    .catch(() => ({ error: new Error("Campaign storage unavailable.") }));
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
