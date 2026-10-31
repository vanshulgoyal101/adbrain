import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { logEvent } from "@/lib/audit";
import { cappedRunEnded, reviewableCampaign } from "@/lib/campaign/activation";
import { checkBudgetEdit } from "@/lib/campaign/budget-edit";
import { recordLaunchCap } from "@/lib/campaign/learnings";
import type { CampaignSpend } from "@/lib/campaign/spend";
import { saveCampaignBudget } from "@/lib/campaign/trusted-write";
import { formatMoney } from "@/lib/format";
import { CampaignDeliveryError, MetaError, friendlyMetaError, type AdSetBudget, type AdSetBudgetChange } from "@/lib/meta/client";
import { ConnectionAccessError, withMetaConnection, type AuthorizedBusiness } from "@/lib/meta/connection-access";
import { recordProductEvent } from "@/lib/observability/logger";
import { fundingMode, type FundingMode } from "@/lib/payments/operator-funding";
import { readFunding } from "@/lib/campaign/funding-check";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCampaignSpend, getSpendLimits } from "@/lib/supabase/queries";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/types";
import { CampaignEditError, refuseWhileSwitchPending } from "./edit-service";
import { OwnerEditError, ownerEditError } from "./owner-edit-error";

/**
 * #774: edit a launched campaign's daily budget, total cap or end date, in the same `campaign_edit_operations`
 * envelope as audience (#773) and ad (#775) edits (kind `budget`). The money rules (`checkBudgetEdit`) run on
 * what Meta reports now, before any write; a raise past what the owner approved needs a fresh confirmation
 * bound to that state. A capped run (#157) changes its lifetime ad set; an uncapped one its daily ad sets.
 *
 * `validate_only` runs in the preview, not right before the write: Meta allows one budget update per ad set
 * per 30 s and counts `validate_only` in it (#613, tests/core/fixtures/meta/edit-budget-rate-limited.json).
 * Each write is a single in-place ad-set update, so a refused one changes nothing.
 */

/** The edit row's stored text for an unexplained failure; the owner's words come from `errors.budgetFailed`/`budgetUnconfirmed`. */
const BUDGET_FAILED_LEDGER = "Could not change the budget.";

const rupees = (max: number) => z.number().finite().positive().max(max).refine(value => Number.isInteger(Math.round(value * 100 * 1e6) / 1e6), "Use at most two decimals.");
export const budgetChangeSchema = z.object({
  dailyRupees: rupees(10_000_000).optional(),
  capRupees: rupees(100_000_000).optional(),
  endTime: z.iso.datetime({ offset: true }).optional(),
}).strict().refine(change => change.dailyRupees !== undefined || change.capRupees !== undefined || change.endTime !== undefined, "Change the budget, cap or end date.");
export type BudgetChange = z.infer<typeof budgetChangeSchema>;

export type BudgetState = { dailyRupees: number; capRupees: number | null; endTime: string | null; spentRupees: number };
export type BudgetEditPreview = { before: BudgetState; after: BudgetState; needsConfirmation: boolean; confirmationDigest: string | null; notices: string[] };
export type BudgetEditResult = { before: BudgetState; after: BudgetState; notices: string[] };

type Row = { id: string; state: string; transmitted: boolean; request_hash: string; result: Json | null };
type Options = { idempotencyKey: string; preview?: boolean; confirmationDigest?: string };

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const toPaise = (value: number) => Math.round(value * 100);
const sameInstant = (left: string | null, right: string | null) => left === right || (left !== null && right !== null && Math.floor(Date.parse(left) / 1000) === Math.floor(Date.parse(right) / 1000));

type StoredCap = { adSetId: string; lifetimeBudgetPaise: number; endTime: string; days?: number };
function storedCap(raw: unknown): StoredCap | null {
  const parsed = z.object({ cap: z.object({
    adSetId: z.string().min(1), lifetimeBudgetPaise: z.number().int().positive(), endTime: z.iso.datetime({ offset: true }), days: z.number().int().positive().optional(),
  }) }).safeParse(raw);
  return parsed.success ? parsed.data.cap : null;
}

/** What the owner sees and Meta holds, from Meta's own read of the ad sets. */
function stateOf(budgets: AdSetBudget[], capped: boolean, storedDailyRupees: number): BudgetState {
  if (capped) {
    const [run] = budgets;
    return { dailyRupees: storedDailyRupees, capRupees: run.lifetimeBudgetPaise / 100, endTime: run.endTime, spentRupees: Math.max(run.lifetimeBudgetPaise - run.remainingPaise, 0) / 100 };
  }
  const ends = new Set(budgets.map(budget => budget.endTime));
  return { dailyRupees: budgets.reduce((sum, budget) => sum + budget.dailyBudgetPaise, 0) / 100, capRupees: null, endTime: ends.size === 1 ? [...ends][0] : null, spentRupees: 0 };
}

/** The change per ad set: a daily total is split evenly across an A/B campaign's ad sets. */
function metaChanges(budgets: AdSetBudget[], capped: boolean, before: BudgetState, change: BudgetChange): Array<{ adSetId: string; change: AdSetBudgetChange }> {
  const endTime = change.endTime !== undefined && !sameInstant(change.endTime, before.endTime) ? new Date(change.endTime).toISOString() : undefined;
  if (capped) {
    const lifetime = change.capRupees !== undefined && change.capRupees !== before.capRupees ? toPaise(change.capRupees) : undefined;
    const edit = { ...lifetime !== undefined ? { lifetimeBudgetPaise: lifetime } : {}, ...endTime ? { endTime } : {} };
    return Object.keys(edit).length ? [{ adSetId: budgets[0].adSetId, change: edit }] : [];
  }
  const perAdSet = change.dailyRupees !== undefined && change.dailyRupees !== before.dailyRupees ? Math.round(toPaise(change.dailyRupees) / budgets.length) : undefined;
  return budgets.flatMap(budget => {
    const edit = {
      ...perAdSet !== undefined && perAdSet !== budget.dailyBudgetPaise ? { dailyBudgetPaise: perAdSet } : {},
      ...endTime && !sameInstant(endTime, budget.endTime) ? { endTime } : {},
    };
    return Object.keys(edit).length ? [{ adSetId: budget.adSetId, change: edit }] : [];
  });
}

function afterState(before: BudgetState, budgets: AdSetBudget[], capped: boolean, writes: Array<{ adSetId: string; change: AdSetBudgetChange }>): BudgetState {
  const next = budgets.map(budget => {
    const edit = writes.find(write => write.adSetId === budget.adSetId)?.change ?? {};
    return { ...budget, dailyBudgetPaise: edit.dailyBudgetPaise ?? budget.dailyBudgetPaise, lifetimeBudgetPaise: edit.lifetimeBudgetPaise ?? budget.lifetimeBudgetPaise,
      remainingPaise: budget.remainingPaise + (edit.lifetimeBudgetPaise ?? budget.lifetimeBudgetPaise) - budget.lifetimeBudgetPaise, endTime: edit.endTime ?? budget.endTime };
  });
  return { ...stateOf(next, capped, before.dailyRupees), spentRupees: before.spentRupees };
}

function describe(before: BudgetState, after: BudgetState): string {
  const parts = [
    before.dailyRupees !== after.dailyRupees && `${formatMoney(before.dailyRupees)} → ${formatMoney(after.dailyRupees)} a day`,
    before.capRupees !== after.capRupees && `total cap ${formatMoney(before.capRupees ?? 0)} → ${formatMoney(after.capRupees ?? 0)}`,
    !sameInstant(before.endTime, after.endTime) && `end date ${before.endTime?.slice(0, 10) ?? "none"} → ${after.endTime?.slice(0, 10) ?? "none"}`,
  ].filter(Boolean);
  return parts.join(", ");
}

export function budgetConfirmationDigest(campaignId: string, metaCampaignId: string, budgets: AdSetBudget[], change: BudgetChange): string {
  const seen = budgets.map(({ adSetId, dailyBudgetPaise, lifetimeBudgetPaise, endTime }) => ({ adSetId, dailyBudgetPaise, lifetimeBudgetPaise, endTime }))
    .sort((left, right) => left.adSetId.localeCompare(right.adSetId));
  return sha256(JSON.stringify({ campaignId, metaCampaignId, budgets: seen, change: { dailyRupees: change.dailyRupees ?? null, capRupees: change.capRupees ?? null, endTime: change.endTime ? new Date(change.endTime).toISOString() : null } }));
}

export async function editCampaignBudget(context: AuthorizedBusiness, campaignId: string, change: BudgetChange, options: Options & { preview: true }): Promise<BudgetEditPreview>;
export async function editCampaignBudget(context: AuthorizedBusiness, campaignId: string, change: BudgetChange, options: Options & { preview?: false }): Promise<BudgetEditResult & { replay: boolean }>;
export async function editCampaignBudget(context: AuthorizedBusiness, campaignId: string, change: BudgetChange, options: Options): Promise<BudgetEditPreview | (BudgetEditResult & { replay: boolean })> {
  const database = createAdminClient() as unknown as SupabaseClient;
  const { data: campaign } = await (await createClient()).from("campaigns").select("*").eq("id", campaignId).eq("business_id", context.businessId).maybeSingle();
  if (!campaign) throw new CampaignEditError("Campaign not found", 404);

  const requestHash = sha256(JSON.stringify(["budget", campaignId, change.dailyRupees ?? null, change.capRupees ?? null, change.endTime ? new Date(change.endTime).toISOString() : null]));
  let row: Row | null = null;
  if (!options.preview) {
    const { data, error } = await database.from("campaign_edit_operations").select("*")
      .eq("business_id", context.businessId).eq("campaign_id", campaignId).eq("idempotency_key", options.idempotencyKey).maybeSingle();
    if (error) throw ownerEditError("editsUnavailable", 503, true);
    row = data as Row | null;
    if (row) {
      if (row.request_hash !== requestHash) throw new CampaignEditError("This idempotency key was used for a different change.", 409);
      if (row.state === "succeeded" && row.result) return { ...(row.result as unknown as BudgetEditResult), replay: true };
      if (row.state !== "failed" || row.transmitted) {
        throw ownerEditError(row.state === "failed" || row.state === "needs_reconciliation" ? "budgetEarlierAttempt" : "changeInProgress", 409);
      }
    }
  }

  const status = String(campaign.status).toLowerCase();
  if (status !== "active" && status !== "paused") throw ownerEditError("budgetNotRunning", 409);
  const review = reviewableCampaign(campaign);
  if (!review) throw ownerEditError("onlyEditOwn", 409);
  // #1146: a waiting new-audience copy holds a snapshot of the budget; switch or cancel it first.
  await refuseWhileSwitchPending(database, campaignId);
  const cap = storedCap(campaign.raw);
  if (cap && cappedRunEnded(campaign.raw)) throw ownerEditError("runEnded", 409);
  const capped = Boolean(cap && review.children.cappedAdSetIds.includes(cap.adSetId));
  if (capped && change.dailyRupees !== undefined && change.dailyRupees !== review.dailyBudgetRupees) {
    throw ownerEditError("cappedRunUseTotal", 422);
  }
  const targets = capped ? [cap!.adSetId] : review.children.adSetIds.filter(id => !review.children.cappedAdSetIds.includes(id));

  // A running campaign's daily budget is held by its AdBrain reservation (customer_ad_campaign_guard), so it
  // changes only while paused; resuming re-reserves at the new amount and checks the weekly limit (Reviewer on #901).
  if (!capped && status === "active" && change.dailyRupees !== undefined && change.dailyRupees !== review.dailyBudgetRupees) {
    throw ownerEditError("pauseForDaily", 409);
  }
  // A running capped run's pace (cap − spent over the days left) is checked against the weekly limit; unreadable fails closed.
  let weekly: { otherActive: CampaignSpend[]; weeklyLimitRupees: number | null } = { otherActive: [], weeklyLimitRupees: null };
  if (capped && status === "active" && (change.capRupees !== undefined || change.endTime !== undefined)) {
    const loaded = await Promise.all([getSpendLimits(context.businessId), getCampaignSpend(context.businessId)]).catch(() => null);
    if (!loaded) throw ownerEditError("budgetSpendLimitsUnverified", 503, true);
    weekly = { otherActive: loaded[1].filter(item => item.status === "active" && item.id !== campaignId), weeklyLimitRupees: loaded[0].weeklyCapRupees };
  }
  const raisesCap = capped && change.capRupees !== undefined && change.capRupees > (cap!.lifetimeBudgetPaise / 100);
  let mode: FundingMode | null = null;
  if (raisesCap) {
    mode = await fundingMode(context.businessId).catch(() => null);
    if (!mode) throw ownerEditError("budgetFundingUnverified", 503, true);
    // A managed run's allowance was reserved at launch; reserving more is not built yet.
    if (mode === "managed") throw ownerEditError("managedCapRaise", 422);
  }

  const touch = async (values: Record<string, unknown>) => {
    if (!row) return;
    const { error } = await database.from("campaign_edit_operations").update({ ...values, updated_at: new Date().toISOString() }).eq("id", row.id);
    if (error) throw ownerEditError("editNotRecorded", 503, true);
  };
  if (!options.preview) {
    const values = { state: "running", phase: "validate", transmitted: false, sanitized_error: null, change: change as unknown as Json };
    if (row) await touch(values);
    else {
      const { data, error } = await database.from("campaign_edit_operations").insert({
        business_id: context.businessId, campaign_id: campaignId, kind: "budget", idempotency_key: options.idempotencyKey, request_hash: requestHash, ...values,
      }).select("*").single();
      if (error || !data) throw ownerEditError(error?.code === "23505" ? "changeInProgress" : "editsUnavailable", error?.code === "23505" ? 409 : 503, error?.code !== "23505");
      row = data as Row;
    }
  }

  const done: Array<{ adSetId: string; change: AdSetBudgetChange }> = [];
  let transmitted = false;
  let budgets: AdSetBudget[] = [];
  let before: BudgetState | null = null;
  const fail = async (state: "failed" | "needs_reconciliation", message: string) => {
    await touch({ state, transmitted, sanitized_error: message.slice(0, 500) }).catch(() => undefined);
  };
  try {
    // Any end-date change may speed a capped run up (a shorter end) or run an uncapped one longer.
    const raisesSpend = (change.dailyRupees ?? 0) > review.dailyBudgetRupees || raisesCap || change.endTime !== undefined;
    const outcome = await withMetaConnection(context, {
      // A running campaign that may spend more needs Meta's activation access (and a managed account's spend-cap gate).
      purpose: status === "active" && raisesSpend ? "activate" : "create_paused",
      binding: { adAccountId: review.adAccountId, pageId: review.pageId },
      expectedGeneration: review.generation,
    }, async meta => {
      // The budgets come from Meta, not the mirror; a daily total that drifted from the record is refused.
      budgets = await Promise.all(targets.map(adSetId => meta.readAdSetBudget(review.metaCampaignId, adSetId)));
      if (capped ? budgets[0].lifetimeBudgetPaise <= 0 : budgets.some(budget => budget.dailyBudgetPaise <= 0)
        || budgets.reduce((sum, budget) => sum + budget.dailyBudgetPaise, 0) !== toPaise(review.dailyBudgetRupees)) {
        throw new CampaignDeliveryError("The budget was changed on Meta after you opened this. Reload the page, then try again.");
      }
      before = stateOf(budgets, capped, review.dailyBudgetRupees);
      // #1094: the room left after the account's other live runs; this run's own ad set is the one being raised.
      const account = raisesCap ? await readFunding(meta, targets).catch(() => null) : null;
      const check = checkBudgetEdit({
        current: { status, ...before },
        approved: { dailyRupees: review.dailyBudgetRupees, capRupees: cap ? cap.lifetimeBudgetPaise / 100 : null, capDays: cap?.days ?? null },
        change: { dailyRupees: change.dailyRupees, capRupees: change.capRupees, endTime: change.endTime },
        otherActive: weekly.otherActive, weeklyLimitRupees: weekly.weeklyLimitRupees,
        funding: { mode: mode ?? "own", account },
        now: Date.now(),
      });
      if (!check.ok) throw new CampaignEditError(check.message, 422);
      const writes = metaChanges(budgets, capped, before, change);
      if (!writes.length) throw ownerEditError("nothingToChange", 422);
      const digest = budgetConfirmationDigest(campaignId, review.metaCampaignId, budgets, change);
      const after = afterState(before, budgets, capped, writes);

      if (options.preview) {
        for (const write of writes) await meta.editAdSetBudget(review.metaCampaignId, write.adSetId, write.change, { validateOnly: true });
        return { kind: "preview" as const, preview: { before, after, needsConfirmation: check.needsConfirmation, confirmationDigest: check.needsConfirmation ? digest : null, notices: check.notices } };
      }
      if (check.needsConfirmation && options.confirmationDigest !== digest) throw ownerEditError("confirmBudget", 409);

      await touch({ phase: "edit", transmitted: true, before: { capped, adSets: budgets } as unknown as Json });
      transmitted = true;
      let failure: unknown = null;
      for (const write of writes) {
        try {
          await meta.editAdSetBudget(review.metaCampaignId, write.adSetId, write.change);
          done.push(write);
        } catch (error) {
          failure = error;
          // Meta refused the very first write (its 30 s limit, or a plain 4xx refusal): nothing was written.
          if (!done.length && error instanceof MetaError && !(error instanceof CampaignDeliveryError) && (error.status ?? 0) >= 400 && (error.status ?? 0) < 500) transmitted = false;
          break;
        }
      }
      return { kind: "saved" as const, after: afterState(before, budgets, capped, done), notices: check.notices, failure };
    });

    if (outcome.kind === "preview") return outcome.preview;
    const { after, notices, failure } = outcome;
    const start = before!;

    if (done.length) {
      // Mirror only what Meta confirmed, even when a later ad set failed, so the stored budget stays honest.
      await touch({ phase: "mirror" });
      const extendedDays = cap && after.endTime && !sameInstant(after.endTime, start.endTime)
        ? Math.round((Date.parse(after.endTime) - Date.parse(start.endTime ?? cap.endTime)) / 86_400_000) : 0;
      const nextCap = capped && cap ? { lifetimeBudgetPaise: toPaise(after.capRupees!), endTime: after.endTime!, days: (cap.days ?? 0) + extendedDays } : null;
      try {
        const { error } = await saveCampaignBudget({ businessId: context.businessId, userId: context.userId }, campaignId, current => {
          const raw = { ...current.raw && typeof current.raw === "object" && !Array.isArray(current.raw) ? current.raw as Record<string, Json | undefined> : {} };
          // #1903: AdBrain's own edit replaces any "changed in Meta Ads Manager" note a refresh wrote meanwhile.
          delete raw.metaBudgetChange;
          delete raw.metaEndTimeChange;
          const currentCap = raw.cap && typeof raw.cap === "object" && !Array.isArray(raw.cap) ? raw.cap : {};
          return nextCap ? { raw: { ...raw, cap: { ...currentCap, ...nextCap } } as Json } : { daily_budget: after.dailyRupees, raw: raw as Json };
        });
        if (error) throw error;
      } catch {
        await fail("needs_reconciliation", "Meta changed the budget but AdBrain could not record it. Check the campaign.");
        recordProductEvent({ kind: "workflow", name: "campaign.edit", outcome: "failed", businessId: context.businessId, attributes: { entityType: "campaign", count: done.length, errorCode: "EDIT_MIRROR_FAILED" } });
        throw ownerEditError("budgetNotRecorded", 502);
      }
      if (nextCap && nextCap.days > 0) await recordLaunchCap(database, { campaignId, cap: { ...nextCap, days: nextCap.days } }).catch(() => false);
    }
    if (failure) throw failure;

    const result: BudgetEditResult = { before: start, after, notices };
    await touch({ state: "succeeded", phase: "complete", result: result as unknown as Json });
    await logEvent({
      businessId: context.businessId, action: "campaign.edit", entityType: "campaign", entityId: campaignId, metaObjectId: campaign.meta_campaign_id,
      reason: `Changed the budget of "${campaign.name ?? campaignId}" (${describe(start, after)})`,
      details: { kind: "budget", before: start, after },
    });
    return { ...result, replay: false };
  } catch (error) {
    const known = toBudgetEditError(error);
    // A sent write that failed without Meta's own refusal (a timeout, a 5xx) may have changed the budget: check, don't retry.
    const uncertain = transmitted && !(error instanceof CampaignEditError) && !(error instanceof MetaError && (error.status ?? 0) >= 400 && (error.status ?? 0) < 500);
    const converted = uncertain ? ownerEditError("budgetUnconfirmed", known.status, false, BUDGET_FAILED_LEDGER) : known;
    // A 613 on a later A/B ad set leaves the edit to reconcile, not to retry (Reviewer on #901).
    const mapped = converted.retryable && transmitted ? converted instanceof OwnerEditError ? new OwnerEditError(converted.ownerKey, converted.status, false, converted.message) : new CampaignEditError(converted.message, converted.status, false) : converted;
    if (options.preview) throw mapped;
    if (!(error instanceof CampaignEditError && error.status === 502)) {
      await fail(transmitted ? "needs_reconciliation" : "failed", mapped.message);
      recordProductEvent({ kind: "workflow", name: "campaign.edit", outcome: done.length ? "partial" : "failed", businessId: context.businessId,
        attributes: { entityType: "campaign", count: done.length, ...error instanceof MetaError && error.code ? { metaCode: error.code } : {} } });
    }
    throw mapped;
  }
}

function toBudgetEditError(error: unknown): CampaignEditError {
  if (error instanceof CampaignEditError) return error;
  if (error instanceof MetaError && error.code === 613) return ownerEditError("budgetRateLimited", 429, true);
  if (error instanceof CampaignDeliveryError) return new CampaignEditError(error.message, 409);
  if (error instanceof ConnectionAccessError) return new CampaignEditError(error.message, error.code === "UNAUTHENTICATED" ? 401 : error.code === "CONFLICT" ? 409 : 400);
  if (error instanceof MetaError) return new CampaignEditError(friendlyMetaError(error), error.status && error.status >= 500 ? 502 : 400, Boolean(error.status && error.status >= 500));
  console.error("[campaign.edit.budget]", error);
  return ownerEditError("budgetFailed", 500, false, BUDGET_FAILED_LEDGER);
}
