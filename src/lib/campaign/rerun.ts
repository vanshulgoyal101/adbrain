import { adResultViews, type StoredAdResult } from "./ad-results-store";
import type { DraftInput, TargetingInputDTO } from "./connect-contracts";

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
  destination?: "instant_form" | "whatsapp";
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

export function rerunPrefill(input: {
  campaign: RerunCampaign;
  draft: DraftInput | null;
  approvedIds: Iterable<string>;
  bestCreativeId: string | null;
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
      destination: draft.destination ?? "instant_form", leadFormId: draft.leadFormId, whatsappNumber: draft.whatsappNumber,
      whatsappLanguage: draft.whatsappLanguage, whatsappMessage: draft.whatsappMessage,
      targeting: draft.targeting, abTest: draft.abTest,
    };
  }
  const destination = campaign.destination === "whatsapp" || campaign.destination === "instant_form" ? campaign.destination : undefined;
  return {
    ...shared, source: "campaign", goal: "",
    dailyBudgetRupees: campaign.daily_budget && campaign.daily_budget > 0 ? Math.round(campaign.daily_budget) : DEFAULT_BUDGET_RUPEES,
    destination, leadFormId: null, abTest: false,
  };
}

/** The creative behind the campaign's Best ad (#783's rule), through the launch's ad → creative links. */
export function bestCreativeId(
  rows: StoredAdResult[],
  links: { meta_ad_id: string; creative_id: string | null }[],
  whatsapp: boolean,
): string | null {
  const best = adResultViews(rows, whatsapp).ads.find((ad) => ad.best);
  return best ? links.find((link) => link.meta_ad_id === best.adId)?.creative_id ?? null : null;
}
