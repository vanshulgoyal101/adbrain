import { adResultViews, type StoredAdResult } from "./ad-results-store";
import type { DraftInput, TargetingInputDTO } from "./connect-contracts";
import type { LeadDestination } from "@/lib/types/campaign";
import { whatsappTemplateSchema } from "./whatsapp-template";

/**
 * #1050 "Run this again": a campaign whose Best ad is known is copied into a new paused campaign. The
 * prefill comes from the draft it was launched from (ads, budget, destination, WhatsApp message, areas
 * and exclusions); older or synced campaigns without one fall back to the campaign row. Only ads that
 * are still approved are kept, Best first. Nothing goes to Meta until Review → Send to Meta (paused).
 */
export type RerunCampaign = {
  name: string | null;
  creative_ids: string[];
  daily_budget: number | null;
  destination?: string | null;
};

export type RerunPrefill = {
  name: string;
  goal: string;
  creativeIds: string[];
  dailyBudgetRupees: number;
  // TODO(#2595): add "website" once Create can launch website campaigns (slices B to D); until then a copy picks its destination again.
  destination?: Exclude<LeadDestination, "call" | "website">;
  leadFormId: string | null;
  whatsappNumber?: string;
  whatsappLanguage?: DraftInput["whatsappLanguage"];
  whatsappMessage?: DraftInput["whatsappMessage"];
  /** Absent for a campaign without its launch draft: the composer keeps its defaults. */
  targeting?: TargetingInputDTO;
  abTest: boolean;
  /** Ads of the original campaign left out because they are no longer approved. */
  dropped: number;
  source: "draft" | "campaign";
};

const NAME_MAX = 120;
const DEFAULT_BUDGET_RUPEES = 300;

/** #1174 (CEO): the next run starts with the Call now button off; runs without it got more chats. The owner can turn it back on. */
function withoutCallButton(message: DraftInput["whatsappMessage"]): DraftInput["whatsappMessage"] {
  return message?.opening.kind === "prefill" && message.opening.callButton ? { ...message, opening: { ...message.opening, callButton: false } } : message;
}

/** The run's own message with Call off; a run that sent the Brand's saved Call-on message gets that message, Call off, as its own. */
function nextRunMessage(own: DraftInput["whatsappMessage"], saved: unknown): DraftInput["whatsappMessage"] {
  if (own) return withoutCallButton(own);
  const parsed = whatsappTemplateSchema.safeParse(saved);
  return parsed.success && parsed.data.opening.kind === "prefill" && parsed.data.opening.callButton ? withoutCallButton(parsed.data) : undefined;
}

export function rerunPrefill(input: {
  campaign: RerunCampaign;
  draft: DraftInput | null;
  approvedIds: Iterable<string>;
  bestCreativeId: string | null;
  /** `businesses.whatsapp_template`: what a WhatsApp run without its own message sent. */
  savedMessage?: unknown;
}): RerunPrefill | { error: string } {
  const { campaign, draft } = input;
  const approved = new Set(input.approvedIds);
  const original = [...new Set(draft?.creativeIds.length ? draft.creativeIds : campaign.creative_ids)];
  const kept = original.filter((id) => approved.has(id));
  if (!kept.length) {
    return { error: original.length
      ? "None of this campaign's ads is approved anymore. Approve them in Ads, or make new ones."
      : "This campaign has no AdBrain ads to copy. Make new ads in Create." };
  }
  const best = input.bestCreativeId && kept.includes(input.bestCreativeId) ? input.bestCreativeId : null;
  const creativeIds = best ? [best, ...kept.filter((id) => id !== best)] : kept;
  const base = (draft?.name || campaign.name || "Campaign").trim().replace(/\s+\(again\)$/, "");
  const suffix = " (again)";
  const name = `${base.slice(0, NAME_MAX - suffix.length).trimEnd()}${suffix}`;
  const shared = { name, creativeIds, dropped: original.length - kept.length };
  if (draft) {
    return {
      ...shared, source: "draft", goal: draft.goal, dailyBudgetRupees: draft.dailyBudgetRupees,
      // #1216: a draft saved before destinations existed is a form campaign, as preflight and launch read it.
      destination: draft.destination === "website" ? undefined : draft.destination ?? "instant_form", leadFormId: draft.leadFormId, whatsappNumber: draft.whatsappNumber,
      whatsappLanguage: draft.whatsappLanguage, whatsappMessage: draft.destination === "whatsapp" ? nextRunMessage(draft.whatsappMessage, input.savedMessage) : draft.whatsappMessage,
      targeting: draft.targeting, abTest: draft.abTest,
    };
  }
  const destination = campaign.destination === "whatsapp" || campaign.destination === "instant_form" ? campaign.destination : undefined;
  return {
    ...shared, source: "campaign", goal: "",
    dailyBudgetRupees: campaign.daily_budget && campaign.daily_budget > 0 ? Math.round(campaign.daily_budget) : DEFAULT_BUDGET_RUPEES,
    destination, leadFormId: null, abTest: false,
    ...(destination === "whatsapp" ? { whatsappMessage: nextRunMessage(undefined, input.savedMessage) } : {}),
  };
}

/** The creative behind the campaign's Best ad (#783's rule), through the launch's ad → creative links. */
export function bestCreativeId(
  rows: StoredAdResult[],
  links: { meta_ad_id: string; creative_id: string | null }[],
  destination: string | null | undefined,
): string | null {
  const best = adResultViews(rows, destination).ads.find((ad) => ad.best);
  return best ? links.find((link) => link.meta_ad_id === best.adId)?.creative_id ?? null : null;
}
