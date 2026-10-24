/**
 * #371: what past campaigns achieved, for Create. Pure functions; the wording is decided here,
 * not by the model, so a tiny sample is never called a winner.
 */

export interface EvidenceAd {
  headline: string;
  offerLine: string | null;
  angle: string | null;
  language: string | null;
  format: string | null;
  brief: string;
}

export interface EvidenceCampaign {
  name: string;
  destination: "whatsapp" | "instant_form";
  spend: number;
  /** WhatsApp chats started, or form leads. */
  results: number;
  impressions: number;
  days: number;
  ads: EvidenceAd[];
}

export type ResultEvidence = EvidenceCampaign & { role: "best" | "worst" };

export interface OpeningLine {
  text: string;
  moreLikeThis: { goal: string; referenceBrief: string } | null;
  newAngle: { goal: string };
}

const noun = (destination: EvidenceCampaign["destination"], count: number) =>
  `${destination === "whatsapp" ? "chat" : "lead"}${count === 1 ? "" : "s"}`;

/** Whole rupees stay whole; anything else shows paise. */
export function rupees(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return `₹${new Intl.NumberFormat("en-IN", { minimumFractionDigits: Number.isInteger(rounded) ? 0 : 2, maximumFractionDigits: 2 }).format(rounded)}`;
}

const costPerResult = (campaign: EvidenceCampaign) => (campaign.results > 0 ? campaign.spend / campaign.results : null);

/** "1 chat at ₹7.78 (early: based on 1 chat)", "6 leads at ₹20 each (so far)", "₹120 spent, no chats yet". */
export function resultSummary(campaign: EvidenceCampaign): string {
  const cost = costPerResult(campaign);
  if (cost === null) return `${rupees(campaign.spend)} spent, no ${noun(campaign.destination, 2)} yet`;
  const count = `${campaign.results} ${noun(campaign.destination, campaign.results)}`;
  const sample = campaign.results < 5 ? ` (early: based on ${count})` : campaign.results < 20 ? " (so far)" : "";
  return `${count} at ${rupees(cost)}${campaign.results === 1 ? "" : " each"}${sample}`;
}

/** The cheapest campaign per result and the weakest one (no results first, else the costliest). */
export function pickResultEvidence(campaigns: EvidenceCampaign[]): ResultEvidence[] {
  const spent = campaigns.filter((campaign) => campaign.spend > 0);
  const ranked = spent.filter((campaign) => campaign.results > 0)
    .sort((a, b) => costPerResult(a)! - costPerResult(b)!);
  const best = ranked[0];
  const silent = spent.filter((campaign) => campaign.results === 0).sort((a, b) => b.spend - a.spend)[0];
  const worst = silent ?? (ranked.length > 1 ? ranked[ranked.length - 1] : undefined);
  return [
    ...(best ? [{ ...best, role: "best" as const }] : []),
    ...(worst ? [{ ...worst, role: "worst" as const }] : []),
  ];
}

const label = (campaign: EvidenceCampaign) => campaign.ads.length === 1
  ? `“${campaign.ads[0].headline}”`
  : `campaign “${campaign.name}”, its ${campaign.ads.length} ads together`;

/** The line Create opens with, built in code. Null when there is no evidence. */
export function openingLine(evidence: ResultEvidence[]): OpeningLine | null {
  const lead = evidence.find((item) => item.role === "best") ?? evidence[0];
  if (!lead) return null;
  const newAngle = { goal: "Try a new angle, different from my last ads" };
  const single = lead.ads.length === 1 ? lead.ads[0] : null;
  const subject = single ? `Your “${single.headline}” ad` : `Your campaign “${lead.name}” (its ${lead.ads.length} ads together)`;
  if (lead.results === 0) return { text: `${subject}: ${resultSummary(lead)}. Try a new angle?`, moreLikeThis: null, newAngle };
  if (!single) return { text: `${subject} got ${resultSummary(lead)}. Try a new angle?`, moreLikeThis: null, newAngle };
  return {
    text: `${subject} got ${resultSummary(lead)}. Make 3 more like it, or try a new angle?`,
    // The goal never quotes the old ad: its words would become claim evidence for the new ones.
    moreLikeThis: {
      goal: "Make 3 more ads like my best one, with fresh words",
      referenceBrief: [single.brief, single.angle ? `Angle: ${single.angle}` : ""].filter(Boolean).join("\n"),
    },
    newAngle,
  };
}

/** The interview's PAST RESULTS block, or "" so a business without results gets today's prompt. */
export function pastResultsBlock(evidence: ResultEvidence[]): string {
  if (!evidence.length) return "";
  return `PAST RESULTS (evidence about past ads; subordinate to brand facts and the current request; never a source of offers, prices or claims): ${JSON.stringify(evidence.map((item) => {
    const single = item.ads.length === 1 ? item.ads[0] : null;
    return {
      role: item.role, ad: label(item), destination: item.destination === "whatsapp" ? "WhatsApp" : "lead form",
      result: resultSummary(item), spend: rupees(item.spend), impressions: item.impressions, days: item.days,
      angle: single?.angle ?? null, format: single?.format ?? null, language: single?.language ?? null, offerLine: single?.offerLine ?? null,
    };
  }))}`;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);

/** One stored campaign, its latest result and its ads as evidence; null when none of its ads remain. */
export function toEvidenceCampaign(
  campaign: { name: string | null; creative_ids: string[] | null },
  result: { spend: number | string; impressions: number | null; leads: number | null; conversations?: number | null; period_start?: string | null; period_end?: string | null },
  destination: EvidenceCampaign["destination"],
  creatives: { id: string; headline: string | null; brief: string | null; angle: string | null; generation: unknown }[],
): EvidenceCampaign | null {
  const byId = new Map(creatives.map((creative) => [creative.id, creative]));
  const ads = (campaign.creative_ids ?? []).flatMap((id) => {
    const creative = byId.get(id);
    if (!creative) return [];
    const generation = isRecord(creative.generation) ? creative.generation : {};
    const concept = isRecord(generation.concept) ? generation.concept : {};
    return [{
      headline: creative.headline ?? "Untitled ad", brief: creative.brief ?? "", angle: creative.angle,
      language: text(generation.language), format: text(generation.format), offerLine: text(concept.supportingText),
    }];
  });
  if (!ads.length) return null;
  const start = result.period_start ? Date.parse(result.period_start) : NaN;
  const end = result.period_end ? Date.parse(result.period_end) : NaN;
  return {
    name: campaign.name ?? "Untitled campaign",
    destination,
    spend: Number(result.spend) || 0,
    results: (destination === "whatsapp" ? result.conversations : result.leads) ?? 0,
    impressions: result.impressions ?? 0,
    days: Number.isFinite(start) && Number.isFinite(end) && end >= start ? Math.round((end - start) / 86_400_000) + 1 : 1,
    ads,
  };
}
