import { adReviewState, type AdReview } from "@/lib/meta/client";
import type { VerdictInput } from "@/lib/campaign/verdict";

/**
 * #1255 (CPO): one example per card state, so the CPO and Designer can judge the words in place at 360/390/1440
 * without seeding fake Meta campaigns into production (crons would read them, and the Manage row would count them).
 * Figures follow Solaride's real runs; nothing here is read from or written to the database.
 */
export type GalleryCard = { name: string; status: "Running" | "Paused" | "Ended"; input: VerdictInput; reviews?: AdReview[];
  /** #1841: a card line outside the verdict (deleted in Meta, #1600; a new audience waiting, #1560/#1749). */
  extra?: "deleted_in_meta" | "audience_waiting";
  /** #1854: the Brand category, so a segment's rejection words (#1645) show. */
  vertical?: string };

/** #1854: one rejected ad of three, with Meta's feedback in the shape of tests/core/fixtures/meta/ad-review-segments.json. */
const oneRejected = (policy: string, message: string) => [
  adReviewState({ id: "1", effective_status: "DISAPPROVED", ad_review_feedback: { global: { [policy]: message } } }),
  adReviewState({ id: "2", effective_status: "ACTIVE" }),
  adReviewState({ id: "3", effective_status: "ACTIVE" }),
];

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
    { name: "IELTS: promised a band or visa", status: "Running", input: { ...base, results: 3, spend: 320 }, vertical: "IELTS coaching",
      reviews: oneRejected("Misleading Claims", "Ads must not make claims that are deceptive or unrealistic, such as a guaranteed band score or visa approval.") },
    { name: "IELTS: talked about the reader's result", status: "Running", input: { ...base, results: 3, spend: 320 }, vertical: "IELTS coaching",
      reviews: oneRejected("Personal Attributes", "Ads must not assert or imply personal attributes. Failed IELTS? implies the viewer failed an exam.") },
    { name: "IELTS: read as a job or visa offer", status: "Running", input: { ...base, results: 3, spend: 320 }, vertical: "IELTS coaching",
      reviews: oneRejected("Unacceptable Business Practices", "Ads must not promote job offers or immigration schemes that may be deceptive.") },
    { name: "Interiors: read as a property ad", status: "Running", input: { ...base, results: 3, spend: 320 }, vertical: "Modular kitchens and interiors",
      reviews: oneRejected("Special Ad Categories", "Ads about housing, such as 2BHK flats and prices per sq ft, need the Housing special ad category.") },
    { name: "Interiors: lowest price, fixed handover", status: "Running", input: { ...base, results: 3, spend: 320 }, vertical: "Modular kitchens and interiors",
      reviews: oneRejected("Misleading Claims", "Ads must not claim the lowest price or a guaranteed handover date.") },
    { name: "Ended, it worked", status: "Ended", input: { ...base, status: "completed", comparison: own(240) } },
    { name: "Deleted in Meta", status: "Ended", input: { ...base, status: "completed" }, extra: "deleted_in_meta" },
    { name: "New audience waiting", status: "Paused", input: { ...base, status: "paused" }, extra: "audience_waiting" },
    { name: "People waiting", status: "Running", input: { ...base, waiting: 2 } },
  ];
}
