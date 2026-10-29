import { isDraftExpired, type DraftRecord } from "@/lib/campaign/draft-store";
import {
  runPreflight,
  type PreflightConnection,
  type PreflightCreative,
  type PreflightForm,
  type PreflightGeo,
} from "@/lib/campaign/preflight";
import type { DraftInput, ReviewDTO } from "@/lib/campaign/connect-contracts";
import type { ResolvedWhatsAppMessage } from "@/lib/campaign/whatsapp-template";
import { alignPrintedNumbers } from "@/lib/creative/chat-number";

export type PreflightActor = {
  businessId: string;
  userId: string;
};

export type PreflightLoaders = {
  findDraft: (actor: PreflightActor, draftId: string) => Promise<DraftRecord | null>;
  findCreatives: (businessId: string, creativeIds: string[]) => Promise<PreflightCreative[]>;
  findForm: (businessId: string, formId: string) => Promise<PreflightForm | null>;
  findWhatsAppNumber?: (actor: PreflightActor, requested?: string) => Promise<string | null>;
  findWebsite?: (actor: PreflightActor) => Promise<string | null>;
  /** #840: the WhatsApp message launch will send, and a problem with this campaign's edit; null when unreadable. */
  findWhatsAppMessage?: (actor: PreflightActor, draft: DraftInput) => Promise<{ message: ResolvedWhatsAppMessage; problem: string | null } | null>;
  /** The business's industry, for the health claim rules on the ad wording (#739). */
  findVertical?: (actor: PreflightActor) => Promise<string | null>;
  /** #418 rule 5: the Brand's facts (USPs, description), for the proof-line warning only. */
  findBrandFacts?: (actor: PreflightActor) => Promise<string[]>;
  /** #419 2(b): the business's own cost per result for this kind of campaign, or null. */
  findCostPerResult?: (actor: PreflightActor, destination: "instant_form" | "whatsapp") => Promise<number | null>;
  /** #2274: redraws one picture's printed phone over its saved background; the new picture's URL, or null. */
  redrawPictureNumber?: (actor: PreflightActor, creativeId: string, phone: string) => Promise<string | null>;
  getConnection: (actor: PreflightActor) => Promise<PreflightConnection | null>;
  resolveGeo: (actor: PreflightActor, draft: DraftRecord) => Promise<PreflightGeo>;
  hash: (payload: string) => string;
};

export type PreflightServiceResult =
  | { kind: "review"; review: ReviewDTO }
  | { kind: "not_found" }
  | { kind: "forbidden" }
  | { kind: "stale"; draftVersion: number };

export async function prepareCampaignReview(
  loaders: PreflightLoaders,
  input: {
    actor: PreflightActor;
    draftId: string;
    requestedDraftVersion: number;
    now: string;
  },
): Promise<PreflightServiceResult> {
  const draft = await loaders.findDraft(input.actor, input.draftId);
  if (!draft) return { kind: "not_found" };
  if (draft.businessId !== input.actor.businessId || draft.ownerId !== input.actor.userId) {
    return { kind: "forbidden" };
  }
  if (isDraftExpired(draft.expiresAt, input.now)) return { kind: "not_found" };
  if (draft.version !== input.requestedDraftVersion) {
    return { kind: "stale", draftVersion: draft.version };
  }

  const [connection, creatives, form, geo, whatsappNumber, website, costPerResultRupees, vertical, whatsappMessage, brandFacts] = await Promise.all([
    loaders.getConnection(input.actor),
    loaders.findCreatives(input.actor.businessId, draft.input.creativeIds),
    draft.input.destination !== "whatsapp" && draft.input.leadFormId
      ? loaders.findForm(input.actor.businessId, draft.input.leadFormId)
      : Promise.resolve(null),
    loaders.resolveGeo(input.actor, draft),
    draft.input.destination === "whatsapp" ? loaders.findWhatsAppNumber?.(input.actor, draft.input.whatsappNumber) ?? Promise.resolve(null) : Promise.resolve(null),
    draft.input.destination !== "whatsapp" ? loaders.findWebsite?.(input.actor) : Promise.resolve(undefined),
    // Only a warning depends on it: an unreadable history means no budget warning, never a failed review.
    loaders.findCostPerResult?.(input.actor, draft.input.destination ?? "instant_form").catch(() => null) ?? Promise.resolve(null),
    loaders.findVertical?.(input.actor) ?? Promise.resolve(null),
    draft.input.destination === "whatsapp" ? loaders.findWhatsAppMessage?.(input.actor, draft.input) ?? Promise.resolve(null) : Promise.resolve(null),
    // Only a warning depends on it, like the cost per result.
    loaders.findBrandFacts?.(input.actor).catch(() => []) ?? Promise.resolve([]),
  ]);
  // #2274: the picture prints the chat's number, not an older Brand phone. Before the creative hash, so
  // Review and launch both see the redrawn picture.
  const redraw = loaders.redrawPictureNumber;
  const aligned = draft.input.destination === "whatsapp" && whatsappNumber && /^\+[1-9]\d{6,14}$/.test(whatsappNumber) && redraw
    ? await alignPrintedNumbers(creatives, whatsappNumber, (creative, phone) => redraw(input.actor, creative.id, phone))
    : { creatives, notice: null };

  return {
    kind: "review",
    review: runPreflight({
      draft: draft.input,
      draftId: draft.id,
      draftVersion: draft.version,
      connection,
      creatives: aligned.creatives,
      pictureNotice: aligned.notice,
      form,
      whatsappNumber,
      whatsappMessage: whatsappMessage?.message ?? null,
      whatsappMessageProblem: whatsappMessage?.problem ?? null,
      website,
      vertical,
      brandFacts,
      geo,
      hash: loaders.hash,
      costPerResultRupees,
    }),
  };
}