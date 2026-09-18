import { z } from "zod";
import type { CampaignDestination } from "@/lib/campaign/outcomes";

export interface CampaignInsights {
  destination?: CampaignDestination;
  periodStart?: string | null;
  periodEnd?: string | null;
  impressions: number;
  clicks: number;
  leads: number;
  spend: number;
  cpl: number | null;
  conversations?: number;
  costPerConversation?: number | null;
}

const amountSchema = z.string().regex(/^\d+(?:\.\d+)?$/).transform(Number)
  .pipe(z.number().nonnegative().max(Number.MAX_SAFE_INTEGER));
const countSchema = amountSchema.pipe(z.number().int());
const insightsSchema = z.object({
  data: z.array(z.object({
    impressions: countSchema.optional(),
    clicks: countSchema.optional(),
    spend: amountSchema.optional(),
    date_start: z.iso.date().optional(),
    date_stop: z.iso.date().optional(),
    actions: z.array(z.object({ action_type: z.string(), value: z.string() })).optional(),
  })).max(1),
  paging: z.object({ next: z.string().optional() }).optional(),
});

export function decodeCampaignInsights(payload: unknown, destination: CampaignDestination): CampaignInsights {
  const parsed = insightsSchema.safeParse(payload);
  if (!parsed.success || parsed.data.paging?.next) throw new Error("Campaign insights are incomplete or invalid.");
  const row = parsed.data.data[0];
  if (row?.date_start && row.date_stop && row.date_start > row.date_stop) throw new Error("Campaign insight dates are invalid.");
  const actionCount = (names: string[]) => {
    for (const name of names) {
      const matches = row?.actions?.filter(action => action.action_type === name) ?? [];
      if (matches.length > 1) throw new Error("Campaign insight actions are ambiguous.");
      if (matches.length === 1) {
        const count = countSchema.safeParse(matches[0].value);
        if (!count.success) throw new Error("Campaign insight count is invalid.");
        return count.data;
      }
    }
    return 0;
  };
  const spend = row?.spend ?? 0;
  const leads = actionCount(["lead", "onsite_conversion.lead_grouped"]);
  const conversations = actionCount(["onsite_conversion.messaging_conversation_started_7d"]);
  return {
    destination,
    periodStart: row?.date_start ?? null,
    periodEnd: row?.date_stop ?? null,
    impressions: row?.impressions ?? 0,
    clicks: row?.clicks ?? 0,
    spend, leads, cpl: leads > 0 ? spend / leads : null,
    ...(destination === "whatsapp" ? { conversations, costPerConversation: conversations > 0 ? spend / conversations : null } : {}),
  };
}