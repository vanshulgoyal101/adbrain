import { isDraftExpired, type DraftRecord } from "@/lib/campaign/draft-store";
import type { AppLocale } from "@/i18n/locale";
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
import type { LeadDestination } from "@/lib/types/campaign";
import type { ReviewDestination } from "@/lib/campaign/plan-check";
import { websiteAdLink } from "@/lib/campaign/website-review";
import type { WebsiteReach } from "@/lib/campaign/website-reach";

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
  /** #2599: opens a website ad's link; Review blocks the ad unless it reaches the advertiser's own site. */
  checkWebsite?: (url: string) => Promise<WebsiteReach>;
  /** #840: the WhatsApp message launch will send, and a problem with this campaign's edit; null when unreadable. */
  findWhatsAppMessage?: (actor: PreflightActor, draft: DraftInput) => Promise<{ message: ResolvedWhatsAppMessage; problem: string | null } | null>;
  /** The business's industry, for the health claim rules on the ad wording (#739). */
  findVertical?: (actor: PreflightActor) => Promise<string | null>;
  /** #418 rule 5: the Brand's facts (USPs, description), for the proof-line warning only. */
  findBrandFacts?: (actor: PreflightActor) => Promise<string[]>;
  /** #419 2(b): the business's own cost per result for this kind of campaign, or null. */
  findCostPerResult?: (actor: PreflightActor, destination: Exclude<LeadDestination, "call" | "website">) => Promise<number | null>;
  /** #2274: redraws one picture's printed phone over its saved background; the new picture's URL, or null. */
  redrawPictureNumber?: (actor: PreflightActor, creativeId: string, phone: string) => Promise<string | null>;
  /** #784: the owner confirmed the current rights terms for their own photos; read only when an ad uses one. */
  findMediaConsent?: (actor: PreflightActor) => Promise<boolean>;
  getConnection: (actor: PreflightActor) => Promise<PreflightConnection | null>;
  resolveGeo: (actor: PreflightActor, draft: DraftRecord) => Promise<PreflightGeo>;
  hash: (payload: string) => string;
};

export type PreflightServiceResult =
  | { kind: "review"; review: ReviewDTO }
  | { kind: "not_found" }
  | { kind: "forbidden" }
  | { kind: "stale"; draftVersion: number }
  /** #2688: a website draft from an account website ads aren't open to (website-gate.ts). */
  | { kind: "website_closed" };

export async function prepareCampaignReview(
  loaders: PreflightLoaders,
  input: {
    actor: PreflightActor;
    draftId: string;
    requestedDraftVersion: number;
    now: string;
    /** #2333: the blocker sentences' language; English when absent. */
    locale?: AppLocale;
    /** #2688: asked only for a website draft; absent means closed. */
    websiteOpen?: () => boolean | Promise<boolean>;
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

  const destination: ReviewDestination = draft.input.destination ?? "instant_form";
  // #2710: conversion contracts are accepted, but no account may launch them before the recorded tracking/payload gates.
  if (destination === "website" && ((draft.input.websiteGoal ?? "visits") !== "visits" || !(await input.websiteOpen?.()))) return { kind: "website_closed" };
  const [connection, creatives, form, geo, whatsappNumber, [website, websiteReach], costPerResultRupees, vertical, whatsappMessage, brandFacts] = await Promise.all([
    loaders.getConnection(input.actor),
    loaders.findCreatives(input.actor.businessId, draft.input.creativeIds),
    destination === "instant_form" && draft.input.leadFormId
      ? loaders.findForm(input.actor.businessId, draft.input.leadFormId)
      : Promise.resolve(null),
    loaders.resolveGeo(input.actor, draft),
    draft.input.destination === "whatsapp" ? loaders.findWhatsAppNumber?.(input.actor, draft.input.whatsappNumber) ?? Promise.resolve(null) : Promise.resolve(null),
    destination === "whatsapp" ? Promise.resolve([undefined, undefined] as const) : websiteAndReach(loaders, input.actor, destination === "website"),
    // Only a warning depends on it: an unreadable history means no budget warning, never a failed review.
    // TODO(#2601): website ads compare against their cost per landing-page view once results count them.
    destination === "website" ? Promise.resolve(null)
      : loaders.findCostPerResult?.(input.actor, destination).catch(() => null) ?? Promise.resolve(null),
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
  // A failed read throws (Review says try again), never a pass.
  const mediaConsent = creatives.some((creative) => creative.ownMedia) && loaders.findMediaConsent
    ? await loaders.findMediaConsent(input.actor)
    : undefined;

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
      websiteReach,
      vertical,
      brandFacts,
      geo,
      hash: loaders.hash,
      costPerResultRupees,
      locale: input.locale,
      mediaConsent,
    }),
  };
}
/** The Brand website, and for a website ad whether its link opens; a failed check reads as unreachable, never a pass. */
async function websiteAndReach(loaders: PreflightLoaders, actor: PreflightActor, check: boolean): Promise<readonly [string | null | undefined, WebsiteReach | undefined]> {
  const website = await loaders.findWebsite?.(actor);
  const url = check ? websiteAdLink(website) : null;
  if (!url || !loaders.checkWebsite) return [website, undefined];
  const reach = await loaders.checkWebsite(url).catch((): WebsiteReach => ({ url, ok: false, problem: "unreachable" }));
  return [website, reach];
}
