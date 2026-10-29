import { Badge } from "@/components/ui/card";
import { verdictTranslator, type Words } from "@/i18n/words";

type ReviewState = "rejected" | "issues" | "in_review" | "unknown" | "approved";

const ORDER: ReviewState[] = ["rejected", "issues", "in_review", "unknown", "approved"];
const STYLES: Record<ReviewState, string> = {
  rejected: "bg-red-50 text-red-700",
  issues: "bg-red-50 text-red-700",
  in_review: "bg-slate-100 text-slate-700",
  unknown: "bg-slate-100 text-slate-600",
  approved: "bg-emerald-50 text-emerald-700",
};

/** The least-ready ad decides the badge; flagged issues are shown as Meta wrote them, rejections by <RejectedAds> (#1274). */
export function AdReviewBadge({ reviews, words }: { reviews: { state: ReviewState; reasons: string[] }[]; words?: Words<"verdict"> }) {
  const t = verdictTranslator(words);
  const state = ORDER.find(candidate => reviews.some(review => review.state === candidate))!;
  const reasons = [...new Set(reviews.filter(review => review.state === state).flatMap(review => review.reasons))];
  const count = reviews.filter(review => review.state === state).length;
  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-2">
      <Badge className={STYLES[state]}>
        {t(`review.${state}`)}{reviews.length > 1 ? ` ${t("review.count", { count, total: reviews.length })}` : ""}
      </Badge>
      {reasons.length > 0 && state !== "rejected" && <span className="text-xs text-slate-600">{reasons.join(" ")}</span>}
    </span>
  );
}
