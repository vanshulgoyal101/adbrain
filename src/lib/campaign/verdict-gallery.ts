import { adReviewState, type AdReview } from "@/lib/meta/client";
import type { VerdictInput } from "@/lib/campaign/verdict";

/**
 * #1255 (CPO): one example per card state, so the CPO and Designer can judge the words in place at 360/390/1440
 * without seeding fake Meta campaigns into production (crons would read them, and the Manage row would count them).
 * Figures follow Solaride's real runs; nothing here is read from or written to the database.
 */
export type GalleryCard = { name: string; status: "Running" | "Paused" | "Ended"; input: VerdictInput; reviews?: AdReview[] };

const DAY = 24 * 60 * 60 * 1000;
const own = (typical: number) => ({ kind: "own" as const, results: 24, typical });
const weakAd = {
  ad: { adId: "2", name: "Ad 2", creative: { headline: "Free site survey this week", imageUrl: null }, spend: 900, results: 3, costPerResult: 300 },
  reference: { adId: "1", name: "Ad 1", creative: { headline: "Cut your power bill", imageUrl: null }, costPerResult: 100 },
  reason: "expensive" as const,
};

export function galleryCards(now = Date.now()): GalleryCard[] {
  const base: VerdictInput = { destination: "whatsapp", status: "active", liveSince: new Date(now - 6 * DAY).toISOString(), impressions: 9000,
    results: 10, spend: 1500, opens: 40, waiting: 0, weakAd: null, comparison: null, now };
  return [
    { name: "Early days", status: "Running", input: { ...base, liveSince: new Date(now - 1 * DAY).toISOString(), impressions: 1200, results: 2, spend: 260 } },
    { name: "Working", status: "Running", input: { ...base, comparison: own(240) } },
    { name: "Costly", status: "Running", input: { ...base, results: 5, spend: 1600, comparison: own(200) } },
    { name: "Weak ad", status: "Running", input: { ...base, results: 9, spend: 1500, weakAd } },
    { name: "No chats, people opened WhatsApp", status: "Running", input: { ...base, results: 0, spend: 450, opens: 38 } },
    { name: "Not showing after a day", status: "Running", input: { ...base, impressions: 0, results: 0, spend: 0, opens: 0, liveSince: new Date(now - 2 * DAY).toISOString() } },
    {
      name: "1 of 3 ads rejected", status: "Running", input: { ...base, results: 3, spend: 320 },
      reviews: [
        adReviewState({ id: "1", effective_status: "DISAPPROVED", ad_review_feedback: { global: { "Misleading Claims": "Ads must not promise unrealistic outcomes." } } }),
        adReviewState({ id: "2", effective_status: "ACTIVE" }),
        adReviewState({ id: "3", effective_status: "ACTIVE" }),
      ],
    },
    { name: "Ended, it worked", status: "Ended", input: { ...base, status: "completed", comparison: own(240) } },
    { name: "People waiting", status: "Running", input: { ...base, waiting: 2 } },
  ];
}
