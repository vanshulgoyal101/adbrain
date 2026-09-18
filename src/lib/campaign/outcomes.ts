import { z } from "zod";

export const campaignDestinationSchema = z.enum(["instant_form", "whatsapp", "call", "mixed", "unknown"]);
export type CampaignDestination = z.infer<typeof campaignDestinationSchema>;

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

export function destinationFromAdSets(adSets: ReadonlyArray<{ destination_type?: string }>): CampaignDestination {
  if (!adSets.length || adSets.some(adSet => !adSet.destination_type)) return "unknown";
  const types = new Set(adSets.map(adSet => adSet.destination_type));
  if (types.size > 1) return "mixed";
  switch (adSets[0].destination_type) {
    case "WHATSAPP": return "whatsapp";
    case "ON_AD": return "instant_form";
    case "PHONE_CALL": return "call";
    default: return "unknown";
  }
}