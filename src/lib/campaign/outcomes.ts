import { z } from "zod";

export const campaignDestinationSchema = z.enum(["instant_form", "whatsapp", "call", "website", "mixed", "unknown"]);
export type CampaignDestination = z.infer<typeof campaignDestinationSchema>;

const DEFINITIONS = {
  whatsapp: {
    campaignField: "conversations", adField: "conversations", insightField: "conversations",
    metaActions: ["onsite_conversion.messaging_conversation_started_7d"], metaValueActions: [],
    unit: "chat", summaryUnit: { one: "WhatsApp chat", many: "WhatsApp chats", per: "chat" },
    figure: "figures.chats", costFigure: "figures.costChat",
    costField: "cost_per_conversation", insightCostField: "costPerConversation",
    comparable: true, performanceRank: 1, countsAsEnquiry: true,
  },
  instant_form: {
    campaignField: "leads", adField: "leads", insightField: "leads",
    metaActions: ["lead", "onsite_conversion.lead_grouped"], metaValueActions: [],
    unit: "lead", summaryUnit: { one: "enquiry", many: "enquiries", per: "enquiry" },
    figure: "figures.leads", costFigure: "figures.costLead",
    costField: "cpl", insightCostField: "cpl",
    comparable: true, performanceRank: 0, countsAsEnquiry: true,
  },
  website: {
    campaignField: "landing_page_views", adField: "landing_page_views", insightField: "landingPageViews",
    metaActions: ["landing_page_view", "omni_landing_page_view"], metaValueActions: [],
    unit: "visit", summaryUnit: { one: "website visit", many: "website visits", per: "visit" },
    figure: "figures.visits", costFigure: "figures.costVisit",
    costField: null, insightCostField: null,
    comparable: true, performanceRank: 2, countsAsEnquiry: false,
  },
} as const;
const UNJUDGED = { ...DEFINITIONS.instant_form, comparable: false, performanceRank: 3 } as const;

/** Objectives do not change the result yet. Unjudged destinations retain readers' legacy lead fallback. */
export function outcomeDefinition(destination: string | null | undefined, _objective?: string | null) {
  void _objective;
  if (destination === "whatsapp") return DEFINITIONS.whatsapp;
  if (destination === "website") return DEFINITIONS.website;
  return destination === "instant_form" ? DEFINITIONS.instant_form : UNJUDGED;
}

const storedOutcomeSchema = z.object({
  metaResult: z.object({ destination: campaignDestinationSchema }).optional(),
});

export function campaignDestination(
  campaign: { destination?: string | null; raw?: unknown; objective?: string },
  result?: { conversations?: number | null; destination?: string | null },
): CampaignDestination {
  const snapshot = campaignDestinationSchema.safeParse(result?.destination);
  if (snapshot.success && snapshot.data !== "unknown") return snapshot.data;
  const explicit = campaignDestinationSchema.safeParse(campaign.destination);
  if (explicit.success && explicit.data !== "unknown") return explicit.data;
  const stored = storedOutcomeSchema.safeParse(campaign.raw);
  if (stored.success && stored.data.metaResult) return stored.data.metaResult.destination;
  if (result?.conversations != null) return "whatsapp";
  if (campaign.objective === "leads") return "instant_form";
  return "unknown";
}

/**
 * #2716: a website leads/sales goal's Meta-attributed pixel result (Analyst fields, #2595). Meta lists the count in
 * `actions` and the value in `action_values` under the same action type. Visits have no conversion.
 */
export const WEBSITE_CONVERSIONS = {
  leads: { customEventType: "LEAD", metaActions: ["offsite_conversion.fb_pixel_lead"], metaValueActions: ["offsite_conversion.fb_pixel_lead"] },
  sales: { customEventType: "PURCHASE", metaActions: ["offsite_conversion.fb_pixel_purchase"], metaValueActions: ["offsite_conversion.fb_pixel_purchase"] },
} as const;
export type ConversionGoal = keyof typeof WEBSITE_CONVERSIONS;

/**
 * #2716: a website campaign's conversion goal, from its ad sets' promoted pixel event (the binding read already asks
 * for `promoted_object`). Null for visits, and for anything AdBrain didn't build (mixed or other events), so its
 * conversions are never guessed.
 */
export function conversionGoalFromAdSets(adSets: ReadonlyArray<{ promoted_object?: { custom_event_type?: string } }>): ConversionGoal | null {
  const events = new Set(adSets.map(adSet => adSet.promoted_object?.custom_event_type));
  if (events.size !== 1) return null;
  const [event] = events;
  return event === WEBSITE_CONVERSIONS.leads.customEventType ? "leads" : event === WEBSITE_CONVERSIONS.sales.customEventType ? "sales" : null;
}

export function destinationFromAdSets(adSets: ReadonlyArray<{ destination_type?: string }>): CampaignDestination {
  if (!adSets.length || adSets.some(adSet => !adSet.destination_type)) return "unknown";
  const types = new Set(adSets.map(adSet => adSet.destination_type));
  if (types.size > 1) return "mixed";
  switch (adSets[0].destination_type) {
    case "WHATSAPP": return "whatsapp";
    case "ON_AD": return "instant_form";
    case "PHONE_CALL": return "call";
    case "WEBSITE": return "website";
    default: return "unknown";
  }
}