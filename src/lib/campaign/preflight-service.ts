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
  /** #419 2(b): the business's own cost per result for this kind of campaign, or null. */
  findCostPerResult?: (actor: PreflightActor, destination: "instant_form" | "whatsapp") => Promise<number | null>;
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

  const [connection, creatives, form, geo, whatsappNumber, website, costPerResultRupees, vertical, whatsappMessage] = await Promise.all([
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
  ]);

  return {
    kind: "review",
    review: runPreflight({
      draft: draft.input,
      draftId: draft.id,
      draftVersion: draft.version,
      connection,
      creatives,
      form,
      whatsappNumber,
      whatsappMessage: whatsappMessage?.message ?? null,
      whatsappMessageProblem: whatsappMessage?.problem ?? null,
      website,
      vertical,
      geo,
      hash: loaders.hash,
      costPerResultRupees,
    }),
  };
}