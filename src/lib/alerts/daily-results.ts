import { bestAd, type AdResult } from "@/lib/meta/insights";
import type { AlertLanguage } from "@/lib/alerts/sender";

/**
 * #1022 (#701 slice 3): the daily results line, `adbrain_daily_results`, sent at 09:00 IST with
 * yesterday's totals across the business's campaigns. Its numbers are #783's per-ad results for that
 * day: enquiries are form leads plus WhatsApp conversations started, the same count the campaign
 * card shows. Utility content only: no suggestion, offer or feedback ask (any of those is marketing).
 */

/** Sends only from 09:00 IST, and until noon so a failed morning run can still catch up. */
export const DAILY_SEND_WINDOW_IST = { from: 9, until: 12 } as const;

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** Yesterday's calendar date in India (UTC+05:30, no daylight saving), as YYYY-MM-DD. */
export function istYesterday(now: Date): string {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  ist.setUTCDate(ist.getUTCDate() - 1);
  return ist.toISOString().slice(0, 10);
}

/** The hour of day in India, 0–23. */
export function istHour(now: Date): number {
  return new Date(now.getTime() + IST_OFFSET_MS).getUTCHours();
}

export function inDailyWindow(now: Date): boolean {
  const hour = istHour(now);
  return hour >= DAILY_SEND_WINDOW_IST.from && hour < DAILY_SEND_WINDOW_IST.until;
}

type CampaignDay = { whatsapp: boolean; ads: AdResult[] };

const rupees = (amount: number) => Math.round(amount).toLocaleString("en-IN");

function dayLabel(day: string, language: AlertLanguage): string {
  return new Intl.DateTimeFormat(language === "hi" ? "hi-IN" : "en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })
    .format(new Date(`${day}T00:00:00Z`)).replace(",", "");
}

/**
 * The ad to name: #783's "Best so far" when it has one; else the ad with the most enquiries (lower
 * cost wins a tie); with no enquiries, the ad with the most WhatsApp taps (or link clicks).
 */
function highlight(campaigns: CampaignDay[], language: AlertLanguage): string {
  const ads = campaigns.flatMap((campaign) => campaign.ads.map((ad) => ({ ad, whatsapp: campaign.whatsapp })));
  const named = (ad: AdResult) => `'${(ad.name?.trim() || (language === "hi" ? "बिना नाम का विज्ञापन" : "Unnamed ad")).slice(0, 60)}'`;
  const enquiries = (count: number) => language === "hi" ? `${count} पूछताछ` : `${count} ${count === 1 ? "enquiry" : "enquiries"}`;
  const best = bestAd(ads.map(({ ad }) => ad));
  const top = best ?? ads.map(({ ad }) => ad).filter((ad) => ad.results > 0)
    .sort((left, right) => right.results - left.results || (left.costPerResult ?? Infinity) - (right.costPerResult ?? Infinity))[0];
  if (top) return `${named(top)} (${enquiries(top.results)})`;
  const tapped = ads.map(({ ad, whatsapp }) => ({ ad, taps: whatsapp ? ad.whatsappOpens ?? ad.clicks : ad.clicks, whatsapp }))
    .filter(({ taps }) => taps > 0).sort((left, right) => right.taps - left.taps)[0];
  if (!tapped) return "—";
  const unit = tapped.whatsapp ? (language === "hi" ? "WhatsApp टैप" : `WhatsApp ${tapped.taps === 1 ? "tap" : "taps"}`) : (language === "hi" ? "क्लिक" : tapped.taps === 1 ? "click" : "clicks");
  return `${named(tapped.ad)} (${tapped.taps} ${unit})`;
}

export type DailyTotals = { spend: number; enquiries: number };

export function dailyTotals(campaigns: CampaignDay[]): DailyTotals {
  const ads = campaigns.flatMap((campaign) => campaign.ads);
  return { spend: ads.reduce((total, ad) => total + ad.spend, 0), enquiries: ads.reduce((total, ad) => total + ad.results, 0) };
}

/**
 * The template's six parameters, or null on a day with no spend and no enquiry (no empty days):
 * business, date, ₹ spent, enquiries, ₹ each (or "none yet"), the ad to name.
 */
export function dailyResultsParams(input: { businessName: string; day: string; campaigns: CampaignDay[] }, language: AlertLanguage): string[] | null {
  const { spend, enquiries } = dailyTotals(input.campaigns);
  if (Math.round(spend) <= 0 && enquiries === 0) return null;
  const each = enquiries > 0
    ? (language === "hi" ? `₹${rupees(spend / enquiries)} प्रति पूछताछ` : `₹${rupees(spend / enquiries)} each`)
    : (language === "hi" ? "अभी कोई नहीं" : "none yet");
  return [input.businessName.trim().slice(0, 60) || "your business", dayLabel(input.day, language), rupees(spend), String(enquiries), each, highlight(input.campaigns, language)];
}
