import { observeRoute } from "@/lib/observability/logger";
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { apiError, readJson, serverError } from "@/lib/api";
import { logEvent } from "@/lib/audit";
import { wouldExceedCap } from "@/lib/campaign/spend";
import { CampaignDeliveryError, MetaError, friendlyMetaError, isMetaReauthError, type CampaignDeliverySnapshot, type CappedActivation, type PausedCampaignTree } from "@/lib/meta/client";
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
import { activationConfirmationPayload, intendedCampaignChildren, RESUME_IN_ADS_MANAGER, reviewableCampaign } from "@/lib/campaign/activation";
import { pausedAdIds } from "@/lib/campaign/ad-pause";
import { saveCampaign, deleteVerifiedCampaign } from "@/lib/campaign/trusted-write";
import { confirmCustomerCampaign, CustomerBalanceError, getCustomerBalance, observeCustomerCosts, reserveCustomerCampaign } from "@/lib/payments/customer-balance";
import { fundingMode, type FundingMode } from "@/lib/payments/operator-funding";
import { committedWords, fundingShortfall, readFunding } from "@/lib/campaign/funding-check";
import { formatMoney } from "@/lib/format";
import { getActivationLearning } from "@/lib/campaign/activation-learning";
import { recordLaunchCap } from "@/lib/campaign/learnings";
import { lacksAreaExclusions } from "@/lib/meta/service-area";
import { createAdminClient } from "@/lib/supabase/admin";

const exactRupees = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" });

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
  try {
    const context = await requireOwnedBusiness(campaign.business_id);
    const review = reviewableCampaign(campaign);
    if (!review) return apiError(RESUME_IN_ADS_MANAGER, 409);
    await recheckMetaConnection(context, review.generation);
    // #759: own-account and operator-funded runs are guarded on Meta, so the review shows Meta's funding.
    const mode = await fundingMode(campaign.business_id);
    const [{ delivery, funding }, learning] = await Promise.all([withMetaConnection(context, {
      purpose: "activate",
      binding: { adAccountId: review.adAccountId, pageId: review.pageId },
      expectedGeneration: review.generation,
    }, async meta => ({
      delivery: await meta.readCampaignDelivery(review.metaCampaignId, {
        dailyBudgetRupees: review.dailyBudgetRupees, status: campaign.status, ...review.children,
      }),
      funding: mode !== "managed" ? await readFunding(meta) : null,
    })), getActivationLearning(campaign)]);
    // #419 item 2: inputs for the learning-restart notes; not part of the confirmation digest.
    // #1055: ads the owner paused from the card stay paused when the campaign is turned back on.
    const keptPaused = pausedAdIds(campaign.raw).length;
    return NextResponse.json({ delivery, ...(funding ? { funding, spendLimitRequired: mode === "operator" } : {}), learning, ...(keptPaused ? { keptPaused } : {}) }, { headers: { "Cache-Control": "no-store" } });
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

  let context: Awaited<ReturnType<typeof requireOwnedBusiness>>;
  try {
    context = await requireOwnedBusiness(campaign.business_id);
  } catch (err) {
    if (err instanceof ConnectionAccessError) {
      return apiError(err.message, err.code === "CONFLICT" ? 409 : err.code === "UNAUTHENTICATED" ? 401 : 400);
    }
    return serverError("campaign.status", err, "Could not update the campaign.");
  }

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
      return apiError(
        `Activating this would commit about ${formatMoney(Math.round(projectedAfter))} a week, over your ${formatMoney(Math.round(limits.weeklyCapRupees!))} a week cap. Raise the cap in Settings or pause another campaign first.`,
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
  // #759: only a managed business spends an AdBrain-held allowance; the others are guarded by the cap on Meta.
  let mode: FundingMode = "managed";
  if (action === "active") {
    try {
      mode = await fundingMode(campaign.business_id);
    } catch {
      return apiError("Campaign funding could not be verified. Try again before activating.", 503);
    }
  }

  let deliveryAfter: CampaignDeliverySnapshot | null = null;
  let cappedAfter: CappedActivation | null = null;
  let launchCap: { lifetimeBudgetPaise: number; days: number; endTime: string } | null = null;
  let pauseResult: PausedCampaignTree | null = null;
  try {
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
          const capDays = parsed.data.capDays;
          const delivery = capDays
            ? await meta.readCampaignDelivery(campaign.meta_campaign_id!, { dailyBudgetRupees: campaign.daily_budget!, status: campaign.status, ...children! })
            : await meta.verifyCampaignActivation(campaign.meta_campaign_id!, {
              dailyBudgetRupees: campaign.daily_budget!, status: campaign.status, ...children!,
            });
          // #741: a tree built before the out-of-area rule must be rebuilt, never activated.
          if (delivery.adSets.some(adSet => lacksAreaExclusions(adSet.targeting))) {
            throw new CampaignDeliveryError("This campaign was built without out-of-area exclusions, so Meta could show it far outside your area. Add them first: More → Edit audience → Leave out places outside the area. Then turn it on.");
          }
          if (capDays && (delivery.adSets.some(adSet => adSet.status !== "PAUSED") || delivery.ads.some(ad => ad.status !== "PAUSED"))) {
            throw new CampaignDeliveryError("Pause the reviewed ad sets and ads in Meta first. AdBrain turns on only the capped copy.");
          }
          // #1055: ads AdBrain paused from the card (and, for a capped copy, the reviewed ad it came from)
          // stay out of what turns on. Read before anything is reserved or created.
          const pausedHere = pausedAdIds(campaign.raw);
          const keptPausedSources = new Set(pausedHere.length ? Object.values(await meta.adSources(pausedHere)) : []);
          const priorCappedAds = new Set(delivery.ads.filter(ad => children!.cappedAdSetIds.includes(ad.adSetId)).map(ad => ad.id));
          const cappedSourceAdIds = children!.adIds.filter(adId => !priorCappedAds.has(adId) && !keptPausedSources.has(adId));
          if (capDays && !cappedSourceAdIds.length) throw new CampaignDeliveryError("Every ad in this campaign is paused from its card. Undo one of those pauses before turning the campaign on.");
          const expectedDigest = createHash("sha256").update(activationConfirmationPayload(campaign, connection, delivery, capDays)).digest("hex");
          if (parsed.data.confirmationDigest !== expectedDigest) {
            throw new ConnectionAccessError("CONFLICT", "Campaign or child review changed; review the current Meta delivery settings again.");
          }
          const capPaise = capDays ? Math.round(campaign.daily_budget! * 100) * capDays : undefined;
          if (mode !== "managed") {
            // #245 operator / #759 own account: paid on Meta directly; the run's total limit on Meta is the guard.
            if (!capDays || !capPaise) {
              throw new CustomerBalanceError("This business is funded on Meta, so it runs only with a total limit. Pause the ad sets and ads in Meta and choose how many days to run.");
            }
            const funding = await readFunding(meta);
            // The operator must set an account spending limit; an owner's own limit, when set, must have room.
            const short = fundingShortfall({ mode, neededPaise: capPaise, account: funding });
            if (short?.kind === "no_limit") throw new CustomerBalanceError("Set a spending limit on the Meta ad account before activating.");
            if (short?.kind === "short") {
              throw new CustomerBalanceError(`Meta has ${exactRupees.format(short.roomPaise / 100)} left under the ad account's spending limit${committedWords(short.committed)}; this run needs ${exactRupees.format(short.neededPaise / 100)}. Add funds on Meta or choose fewer days.`);
            }
          } else {
            // #216: AdBrain records Meta's lifetime spend itself; the reserve below stays the gate.
            await meta.readLifetimeSpendPaise(campaign.meta_campaign_id!).then(mediaPaise => observeCustomerCosts(context, {
              campaignId: id, adAccountId: storedBinding.metaAdAccountId!, connectionGeneration: storedBinding.metaConnectionGeneration!, mediaPaise,
            })).catch(() => undefined);
          }
          const reservation = mode !== "managed" ? null : await reserveCustomerCampaign(context, {
            campaignId: id, adAccountId: storedBinding.metaAdAccountId!,
            connectionGeneration: storedBinding.metaConnectionGeneration!, dailyBudgetRupees: campaign.daily_budget!,
            requestKey: parsed.data.confirmationDigest, lifetimeCapPaise: capPaise,
          });
          const confirm = async (state: "active" | "paused" | "uncertain") => {
            if (reservation) await confirmCustomerCampaign(context, id, reservation.reservationId, state);
          };
          let liveTree = { adSetIds: children!.adSetIds, adIds: children!.adIds };
          try {
            if (capDays && capPaise) {
              if (reservation && fundingShortfall({ mode, neededPaise: capPaise, account: null, allowancePaise: reservation.mediaLimitPaise })) throw new CustomerBalanceError("The approved total is more than the available advertising funds.");
              const capped = await meta.createCappedAdSet(campaign.meta_campaign_id!, {
                sourceAdSetId: children!.adSetIds[0], sourceAdIds: cappedSourceAdIds, lifetimeBudgetPaise: capPaise,
                endTime: new Date(Date.now() + capDays * 86_400_000),
              });
              const tree = { adSetIds: [...children!.adSetIds, capped.adSetId], adIds: [...children!.adIds, ...capped.adIds] };
              launchCap = { lifetimeBudgetPaise: capped.lifetimeBudgetPaise, days: capDays, endTime: capped.endTime };
              liveTree = tree;
              const stored = campaign.raw as { metaResult: Record<string, unknown> } & Record<string, unknown>;
              const { error: recordError } = await saveCampaign({ businessId: campaign.business_id, userId: user.id }, {
                meta_ad_ids: tree.adIds,
                raw: {
                  ...stored, metaResult: { ...stored.metaResult, ...tree }, cap: { ...capped, days: capDays },
                  cappedAdSetIds: [...children!.cappedAdSetIds, capped.adSetId],
                },
              }, id).catch(() => ({ error: new Error("Campaign storage unavailable.") }));
              if (recordError) throw new CampaignDeliveryError("The capped ad set could not be recorded. Nothing was activated.");
              try {
                cappedAfter = await meta.activateCappedTree(campaign.meta_campaign_id!, capped);
              } catch (error) {
                await meta.pauseCampaignTree(campaign.meta_campaign_id!, tree).catch(() => undefined);
                throw error;
              }
            } else {
              if (!reservation) throw new CustomerBalanceError();
              await meta.enforceCampaignSpendCap(campaign.meta_campaign_id!, reservation.mediaLimitPaise);
              await meta.updateCampaignStatus(campaign.meta_campaign_id!, "ACTIVE");
              deliveryAfter = await meta.verifyCampaignActivation(campaign.meta_campaign_id!, {
                dailyBudgetRupees: campaign.daily_budget!, status: "active", ...children!,
                // #1055: an ad paused from the card stays paused; it isn't expected ACTIVE.
                keepPaused: pausedHere,
              });
            }
            await confirm("active");
          } catch (error) {
            await confirm("uncertain").catch(() => undefined);
            throw error;
          }
          // #208: never leave Meta running while AdBrain shows the campaign paused.
          // #672: launched_at is the first confirmed activation, not the creation date.
          const { error: activeError } = await saveCampaign({ businessId: campaign.business_id, userId: user.id }, { status: "active", ...(campaign.launched_at ? {} : { launched_at: new Date().toISOString() }) }, id)
            .catch(() => ({ error: new Error("Campaign storage unavailable.") }));
          if (activeError) {
            const paused = await meta.pauseCampaignTree(campaign.meta_campaign_id!, liveTree).catch(() => null);
            if (!paused?.objects.some(object => object.level === "campaign" && object.status === "PAUSED")) {
              await confirm("uncertain").catch(() => undefined);
              throw new CampaignDeliveryError("AdBrain could not record the activation and Meta did not confirm the pause. Pause the campaign in Ads Manager now.");
            }
            await confirm("paused").catch(() => undefined);
            throw new CampaignDeliveryError("AdBrain could not record the activation, so the campaign was paused again in Meta. Try again.");
          }
          // The ledger is best effort: the run is live whether or not this is written.
          if (launchCap) await Promise.resolve().then(() => recordLaunchCap(createAdminClient(), { campaignId: id, cap: launchCap! })).catch(() => false);
          return;
        }
        const reservation = await getCustomerBalance(context)
          .then(balance => balance.reservations.find(item => item.campaignId === id && item.state !== "closed"))
          .catch(() => undefined);
        const stopChildren = intendedCampaignChildren(campaign);
        pauseResult = await meta.pauseCampaignTree(
          campaign.meta_campaign_id!,
          stopChildren ? { adSetIds: stopChildren.adSetIds, adIds: stopChildren.adIds } : { adSetIds: [], adIds: [] },
        );
        if (!pauseResult.objects.some(object => object.level === "campaign" && object.status === "PAUSED")) {
          throw new CampaignDeliveryError("Meta did not confirm the pause. Pause the campaign in Ads Manager now.");
        }
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
    if (isMetaReauthError(err)) {
      // #757: a dead token can't stop delivery, so name the manual step first while the campaign may be running.
      const message = action === "paused" || campaign.status === "active"
        ? `Meta stopped accepting AdBrain's access, so we couldn't ${action === "paused" ? "pause" : "change"} this campaign. Pause it in Ads Manager now, then reconnect Facebook in Settings.`
        : "Meta stopped accepting AdBrain's access. Reconnect Facebook in Settings, then try again.";
      return NextResponse.json({ error: message, code: "META_REAUTH" }, { status: 409 });
    }
    if (err instanceof MetaError) {
      return apiError(friendlyMetaError(err), err.status && err.status >= 500 ? 502 : 400);
    }
    return serverError("campaign.status", err, "Could not update the campaign.");
  }

  const { error } = action === "active" ? { error: null } : await saveCampaign({ businessId: campaign.business_id, userId: user.id }, { status: action }, id)
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

  return NextResponse.json({ ok: true, status: action, delivery: deliveryAfter, cap: cappedAfter, pause: pauseResult });
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
