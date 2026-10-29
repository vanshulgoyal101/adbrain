import { Badge } from "@/components/ui/card";
// Mirrors AdReviewState in lib/meta/client; UI files may not import the Meta adapter.
type ReviewState = "in_review" | "approved" | "rejected" | "issues" | "unknown";

const REVIEW_LABELS: Record<ReviewState, { label: string; style: string }> = {
  rejected: { label: "Rejected by Meta", style: "bg-red-50 text-red-700" },
  issues: { label: "Meta flagged issues", style: "bg-red-50 text-red-700" },
  in_review: { label: "In Meta's review", style: "bg-slate-100 text-slate-700" },
  unknown: { label: "Review status unknown", style: "bg-slate-100 text-slate-600" },
  approved: { label: "Approved by Meta", style: "bg-emerald-50 text-emerald-700" },
};

/** The least-ready ad decides the badge; flagged issues are shown as Meta wrote them, rejections by <RejectedAds> (#1274). */
export function AdReviewBadge({ reviews }: { reviews: { state: ReviewState; reasons: string[] }[] }) {
  const order: ReviewState[] = ["rejected", "issues", "in_review", "unknown", "approved"];
  const state = order.find(candidate => reviews.some(review => review.state === candidate))!;
  const reasons = [...new Set(reviews.filter(review => review.state === state).flatMap(review => review.reasons))];
  const count = reviews.filter(review => review.state === state).length;
  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-2">
      <Badge className={REVIEW_LABELS[state].style}>
        {REVIEW_LABELS[state].label}{reviews.length > 1 ? ` (${count} of ${reviews.length} ads)` : ""}
      </Badge>
      {reasons.length > 0 && state !== "rejected" && <span className="text-xs text-slate-600">{reasons.join(" ")}</span>}
    </span>
  );
}
