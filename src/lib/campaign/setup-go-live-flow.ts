import { z } from "zod";
import { activationConfirmationPayload, campaignDeliverySnapshotSchema } from "@/lib/campaign/activation";
import { createCampaignRequestSchema, type CreateCampaignRequest, type DraftInput, type OperationDTO } from "@/lib/campaign/connect-contracts";
import { campaignNameDate, defaultCampaignName } from "@/lib/campaign/draft-name";
import { defaultTargeting, targetingFromEditor } from "@/lib/campaign/editor-targeting";
import { buildManualDraftInput, pickWhatsAppNumber } from "@/lib/campaign/manual-draft-input";
import { parseWhatsAppStatus } from "@/lib/meta/whatsapp-status-shared";
import type { MetaConnectClient } from "@/lib/meta-connect-ui/client";
import { buildActivationPatch, buildCreateCampaignRequest, isTerminalOperation } from "@/lib/meta-connect-ui/campaign-flow";
import type { Campaign } from "@/lib/types";

/**
 * #1529: Go live's draft: the composer's defaults (WhatsApp, default targeting, no A/B, the saved or AdBrain's
 * message). Step 3 previews its welcome from this same draft, so what it shows is what launches.
 */
export function setupDraftInput(input: { businessId: string; name: string; adIds: string[]; dailyBudgetRupees: number; whatsappNumber: string }): DraftInput {
  return buildManualDraftInput({
    businessId: input.businessId, name: input.name, goal: input.name, mode: "manual", creativeIds: input.adIds,
    dailyBudgetRupees: input.dailyBudgetRupees, destination: "whatsapp", leadFormId: "", whatsappNumber: input.whatsappNumber,
    whatsappLanguage: "ad", whatsappMessage: null, targeting: targetingFromEditor(defaultTargeting, [], []), abTest: false,
  });
}

/**
 * #1271 (#1251 WS1 step 3) slice 4b: setup's one-tap "Go live", through the same routes the Campaigns page uses:
 * save the draft → review it (preflight) → create it PAUSED → activate it as a capped run of `capDays` days.
 * Nothing is spent before the activation PATCH, which enforces the Meta total limit, the weekly cap and funding.
 */
export type GoLiveStep = "check" | "create" | "activate";

export type GoLiveResult =
  | { kind: "connect" }
  | { kind: "live"; campaignId: string }
  // #1990: `billing` is Meta's BILLING_REQUIRED, said in the owner's language by step 3 rather than in `messages`.
  | { kind: "blocked"; messages: string[]; billing?: true }
  | { kind: "refused"; message: string; campaignId?: string }
  | { kind: "failed"; message: string };

export type GoLiveDeps = {
  client: Pick<MetaConnectClient, "status" | "saveDraft" | "preflight" | "createCampaign" | "operation" | "operationForRequest">;
  fetch: typeof fetch;
  /** sessionStorage in the browser: the create request survives a reload so it's resumed, never sent as a new one. */
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
  newKey?: () => string;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
};

export type GoLiveInput = {
  businessId: string;
  businessName: string;
  ads: { id: string; headline?: string | null }[];
  dailyBudgetRupees: number;
  capDays: number;
};

const POLLS = 60;
const POLL_MS = 1000;

const pendingSchema = z.object({ request: createCampaignRequestSchema });

export function goLiveStorageKey(input: Pick<GoLiveInput, "businessId" | "ads" | "dailyBudgetRupees">): string {
  const ids = input.ads.map((ad) => ad.id).sort().join(",");
  return `adbrain:setup-go-live:v1:${input.businessId}:${ids}:${input.dailyBudgetRupees}`;
}

function readPending(storage: GoLiveDeps["storage"], key: string, businessId: string): CreateCampaignRequest | null {
  try {
    const saved = pendingSchema.parse(JSON.parse(storage?.getItem(key) ?? "null")).request;
    return saved.businessId === businessId ? saved : null;
  } catch { return null; }
}

const errorText = (reason: unknown, fallback: string) => reason instanceof Error && reason.message ? reason.message : fallback;

/** #2046: Go live has no "Check my campaign" or "Refresh review" button; tapping Go live again checks it afresh. */
export const GO_LIVE_STALE = "This campaign changed after it was checked. Nothing was spent. Tap Go live again.";
const isConflict = (reason: unknown) => typeof reason === "object" && reason !== null && (reason as { code?: unknown }).code === "CONFLICT";

async function sha256Hex(payload: string): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error("Activation confirmation is unavailable in this browser.");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const body = await response.json();
    return body && typeof body === "object" ? body as Record<string, unknown> : {};
  } catch { return {}; }
}

export async function goLive(deps: GoLiveDeps, input: GoLiveInput, onStep: (step: GoLiveStep) => void = () => {}): Promise<GoLiveResult> {
  const { client, storage } = deps;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const key = goLiveStorageKey(input);
  const forget = () => storage?.removeItem(key);

  onStep("check");
  let connection;
  try {
    connection = await client.status(input.businessId);
  } catch (reason) {
    return { kind: "failed", message: errorText(reason, "Couldn't check your Meta connection. Try again.") };
  }
  if (connection.authorization !== "connected" || !connection.selected) return { kind: "connect" };
  // Stop before anything is created when Meta already says this account can't run ads.
  if (connection.capabilities.canActivate.state === "blocked") {
    const { blockers } = connection.capabilities.canActivate;
    const billing = blockers.some((blocker) => blocker.code === "BILLING_REQUIRED");
    const messages = blockers.filter((blocker) => blocker.code !== "BILLING_REQUIRED").map((blocker) => blocker.message);
    return billing ? { kind: "blocked", messages, billing } : { kind: "blocked", messages };
  }

  let operation: OperationDTO | null = null;
  try {
    let request = readPending(storage, key, input.businessId);
    // A reload or retry after the create was sent: find that request's operation instead of creating again.
    if (request) operation = await client.operationForRequest(input.businessId, request.idempotencyKey);
    if (!request) {
      const whatsapp = await deps.fetch(`/api/meta/whatsapp?businessId=${encodeURIComponent(input.businessId)}`, { cache: "no-store" })
        .then(async (response) => parseWhatsAppStatus(response.ok ? await response.json() : null))
        .catch(() => parseWhatsAppStatus(null));
      const name = defaultCampaignName({
        headline: input.ads[0]?.headline, businessName: input.businessName, destination: "whatsapp",
        date: campaignNameDate(deps.now?.() ?? new Date()),
      });
      const draft = await client.saveDraft(setupDraftInput({
        businessId: input.businessId, name, adIds: input.ads.map((ad) => ad.id), dailyBudgetRupees: input.dailyBudgetRupees,
        whatsappNumber: pickWhatsAppNumber(whatsapp.state === "ready" ? whatsapp.numbers : [], ""),
      }));
      const review = await client.preflight(input.businessId, draft.draftId, draft.version);
      if (!review.canCreatePaused || review.blockers.length || !review.planHash) {
        const messages = review.blockers.map((blocker) => blocker.message);
        return { kind: "blocked", messages: messages.length ? messages : ["Meta can't take this campaign yet."] };
      }
      request = buildCreateCampaignRequest(input.businessId, draft, review, (deps.newKey ?? (() => crypto.randomUUID()))());
      storage?.setItem(key, JSON.stringify({ request }));
    }
    onStep("create");
    if (!operation) {
      try {
        operation = await client.createCampaign(request);
      } catch (reason) {
        // #2046: the server refused this saved request as stale (the review, draft or Meta connection changed since
        // it was checked). Unless it's already running, the next tap starts over instead of resending it.
        if (!isConflict(reason) || await client.operationForRequest(input.businessId, request.idempotencyKey)) throw reason;
        forget();
        return { kind: "failed", message: GO_LIVE_STALE };
      }
    }
    for (let poll = 0; !isTerminalOperation(operation) && poll < POLLS; poll += 1) {
      await sleep(POLL_MS);
      operation = await client.operation(operation.operationId);
    }
  } catch (reason) {
    return { kind: "failed", message: errorText(reason, "Couldn't create your campaign. Nothing was spent. Try again.") };
  }

  if (operation.state === "failed") {
    forget();
    return { kind: "failed", message: operation.blockers[0]?.message ?? "Meta couldn't create your campaign. Nothing was spent." };
  }
  if (operation.state === "needs_reconciliation") {
    return { kind: "failed", message: "Your campaign needs checking before anything else. Open Campaigns; don't create it again. Nothing was spent." };
  }
  if (operation.state !== "succeeded" || !operation.campaignId) {
    return { kind: "failed", message: "Meta is still creating your campaign. Check again in a minute. Nothing was spent." };
  }

  const campaignId = operation.campaignId;
  onStep("activate");
  try {
    const list = await deps.fetch(`/api/campaigns/list?businessId=${encodeURIComponent(input.businessId)}&status=paused`, { cache: "no-store" });
    const listed = await readJson(list);
    const campaign = (Array.isArray(listed.campaigns) ? listed.campaigns as Campaign[] : []).find((row) => row.id === campaignId);
    if (!list.ok || !campaign) return { kind: "refused", campaignId, message: typeof listed.error === "string" ? listed.error : "Couldn't read your new campaign." };

    const reviewResponse = await deps.fetch(`/api/campaigns/${campaignId}`, { cache: "no-store" });
    const review = await readJson(reviewResponse);
    if (!reviewResponse.ok) return { kind: "refused", campaignId, message: typeof review.error === "string" ? review.error : "Campaign delivery review is unavailable." };
    const delivery = campaignDeliverySnapshotSchema.parse(review.delivery);
    const confirmationDigest = await sha256Hex(activationConfirmationPayload(campaign, connection, delivery, input.capDays));

    const patch = await deps.fetch(`/api/campaigns/${campaignId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildActivationPatch(confirmationDigest, connection.generation, input.capDays)),
    });
    if (!patch.ok) {
      const refused = await readJson(patch);
      return { kind: "refused", campaignId, message: typeof refused.error === "string" ? refused.error : "Couldn't turn your campaign on." };
    }
  } catch (reason) {
    return { kind: "refused", campaignId, message: errorText(reason, "Couldn't turn your campaign on.") };
  }
  forget();
  return { kind: "live", campaignId };
}
