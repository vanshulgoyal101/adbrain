import type { SupabaseClient } from "@supabase/supabase-js";
import { adCreativeLinks, adResultsEnabled } from "@/lib/campaign/ad-results-store";
import { pictureSource } from "@/lib/creative/picture-source";
import { defaultAdLanguage } from "@/lib/languages";
import { createAdminClient } from "@/lib/supabase/admin";
import { cardArea, cardLines, type CardLines, cardPhone, pickThumbnail, RESULTS_CARD_EVENTS, RESULTS_CARD_WINDOW_MS, resultsCardOffered } from "./offer";
import type { ResultsCardInput } from "./render";

/**
 * #2036: what decides the weekly results card. Callers check the owner first (`requireOwnedBusiness`, or the
 * dashboard's own business); every read here is scoped to that business. Throws when unreadable.
 */
export async function resultsCardFacts(businessId: string, now = Date.now()) {
  const db = createAdminClient();
  const since = new Date(now - RESULTS_CARD_WINDOW_MS).toISOString();
  const [business, leads, events] = await Promise.all([
    db.from("businesses").select("name, vertical, languages, locations, phone, logo_url, primary_color").eq("id", businessId).maybeSingle(),
    // Only enquiries the owner logged (Add an enquiry, Got a customer): raw chats never count (#2018).
    db.from("leads").select("campaign_id").eq("business_id", businessId).eq("source", "whatsapp_manual").gte("created_time", since).limit(1000),
    db.from("product_events").select("name, created_at").eq("business_id", businessId)
      .in("name", [RESULTS_CARD_EVENTS.shared, RESULTS_CARD_EVENTS.dismissed]).gte("created_at", since).limit(20),
  ]);
  if (business.error || !business.data || leads.error || events.error) throw new Error("Results card is unavailable.");
  const area = cardArea({ locations: business.data.locations ?? [] });
  const enquiries = leads.data.length;
  return {
    business: business.data,
    area,
    enquiries,
    leadCampaigns: leads.data.map((row) => row.campaign_id),
    offered: resultsCardOffered({ enquiries, area, events: events.data as { name: string; created_at: string }[], now }),
  };
}

export type ResultsCardFacts = Awaited<ReturnType<typeof resultsCardFacts>>;

/** The card's lines in the owner's ad language (#2018), also the caption shared under it. */
export function resultsCardLines({ business, enquiries, area }: ResultsCardFacts): CardLines {
  return cardLines(defaultAdLanguage(business.languages, business.vertical), { n: enquiries, area: area ?? "", phone: cardPhone(business.phone) });
}

/** The card for an offered business: its lines and the best ad's picture. */
export async function resultsCardInput(facts: ResultsCardFacts, businessId: string, footer: boolean): Promise<ResultsCardInput> {
  const { business } = facts;
  return {
    businessName: business.name,
    logoUrl: business.logo_url,
    primaryColor: business.primary_color,
    thumbnailUrl: await bestAdPicture(businessId, facts.leadCampaigns).catch(() => null),
    lines: resultsCardLines(facts),
    footer,
  };
}

/**
 * The picture of the ad with the most chats in the campaign with the most logged enquiries this week. Per-ad
 * chats are lifetime-to-date (ad_results keeps no weekly rows yet), so "this week" is the campaign, not the ad.
 * TODO(#789): rank by this week's per-ad chats once ad_results stores a weekly period.
 */
async function bestAdPicture(businessId: string, leadCampaigns: (string | null)[]): Promise<string | null> {
  const counts = new Map<string, number>();
  for (const id of leadCampaigns) if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  const campaignId = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!campaignId) return null;
  const db = createAdminClient();
  const { data: campaign } = await db.from("campaigns")
    .select("creative_ids, meta_campaign_id, meta_adset_id, meta_ad_ids, raw").eq("id", campaignId).eq("business_id", businessId).maybeSingle();
  const creativeIds = campaign?.creative_ids ?? [];
  if (!campaign || !creativeIds.length) return null;
  const { data: creatives } = await db.from("creatives").select("id, image_url, generation").eq("business_id", businessId).in("id", creativeIds);
  const byId = new Map((creatives ?? []).map((row) => [row.id, row]));
  const chats = new Map<string, number>();
  if (adResultsEnabled()) {
    const links = adCreativeLinks({ ...campaign, meta_ad_ids: campaign.meta_ad_ids ?? [] }, creativeIds);
    // ad_results isn't in the generated types yet (as in /api/campaigns/[id]/ads).
    const { data: rows } = await (db as unknown as SupabaseClient).from("ad_results").select("meta_ad_id, conversations")
      .eq("campaign_id", campaignId).is("period_start", null).is("period_end", null).limit(100);
    for (const row of (rows ?? []) as { meta_ad_id: string; conversations: number | null }[]) {
      const creativeId = links.get(row.meta_ad_id)?.creativeId;
      if (creativeId) chats.set(creativeId, (chats.get(creativeId) ?? 0) + (row.conversations ?? 0));
    }
  }
  return pickThumbnail(creativeIds.flatMap((id) => {
    const row = byId.get(id);
    return row ? [{ id, imageUrl: row.image_url, yours: pictureSource(row.generation) === "yours" }] : [];
  }), chats);
}
