import { complete } from "@/lib/llm";
import type { CampaignInsights } from "@/lib/meta/client";

/** Turn campaign metrics into one or two plain, friendly sentences. */
export async function summarizeInsights(
  campaignName: string,
  insights: CampaignInsights,
): Promise<string> {
  const destination = insights.destination ?? (insights.conversations !== undefined ? "whatsapp" : "instant_form");
  if (destination === "whatsapp" && insights.conversations == null) {
    return `WhatsApp conversation metrics are unavailable. INR ${insights.spend.toFixed(0)} spent. Refresh results before comparing outcomes.`;
  }
  if (destination === "whatsapp") {
    return `${insights.conversations} WhatsApp conversations started, INR ${insights.spend.toFixed(0)} spent.${insights.costPerConversation != null ? ` INR ${insights.costPerConversation.toFixed(0)} per conversation.` : ""} Conversations are not verified leads or sales.`;
  }
  if (destination !== "instant_form") {
    return `INR ${insights.spend.toFixed(0)} spent. Comparable outcome metrics are unavailable for this campaign destination.`;
  }
  if (insights.impressions === 0 && insights.spend === 0) {
    return "No delivery yet — this campaign hasn't spent or shown to anyone. It may be paused or still in review.";
  }

  try {
    const res = await complete(
      [
        {
          role: "system",
          content:
            "You turn ad metrics into one or two plain, friendly sentences for a small business owner. No jargon. Amounts are in Indian rupees (₹).",
        },
        {
          role: "user",
          content:
            `Campaign: ${campaignName}\n` +
            `Impressions: ${insights.impressions}\n` +
            `Clicks: ${insights.clicks}\n` +
            `Leads: ${insights.leads}\n` +
            `Spend: ₹${insights.spend.toFixed(0)}\n` +
            `Cost per lead: ${insights.cpl != null ? "₹" + insights.cpl.toFixed(0) : "n/a"}\n\n` +
            "Summarize how it's doing in 1–2 sentences.",
        },
      ],
      {
        routing: "budget",
        task: "campaign summary",
        temperature: 0.4,
        maxTokens: 120,
        cache: true,
        signal: AbortSignal.timeout(5_000),
      },
    );
    return res.text.trim();
  } catch {
    const parts = [
      `${insights.leads} leads`,
      `₹${insights.spend.toFixed(0)} spent`,
    ];
    if (insights.cpl != null) parts.push(`₹${insights.cpl.toFixed(0)} per lead`);
    return `${parts.join(", ")}.`;
  }
}
