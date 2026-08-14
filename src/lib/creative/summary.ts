import { complete } from "@/lib/llm";
import type { CampaignInsights } from "@/lib/meta/client";

/** Turn campaign metrics into one or two plain, friendly sentences. */
export async function summarizeInsights(
  campaignName: string,
  insights: CampaignInsights,
): Promise<string> {
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
      { temperature: 0.4, maxTokens: 120, cache: true },
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
