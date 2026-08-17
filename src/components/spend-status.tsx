import Link from "next/link";
import { AlertTriangle, ShieldAlert } from "lucide-react";
import type { SpendEvaluation } from "@/lib/campaign/spend";
import { formatCurrency } from "@/lib/utils";

/** A dashboard banner shown only when spend is approaching or over the cap. */
export function SpendStatusBanner({
  evaluation,
}: {
  evaluation: SpendEvaluation;
}) {
  if (evaluation.status !== "approaching" && evaluation.status !== "over") {
    return null;
  }
  const over = evaluation.status === "over";
  const Icon = over ? ShieldAlert : AlertTriangle;
  return (
    <div
      role="alert"
      className={`flex items-start gap-3 rounded-xl border p-4 text-sm ${
        over
          ? "border-red-200 bg-red-50 text-red-800"
          : "border-amber-200 bg-amber-50 text-amber-800"
      }`}
    >
      <Icon className="mt-0.5 h-5 w-5 shrink-0" />
      <div className="min-w-0">
        <p className="font-semibold">
          {over
            ? `You've hit your weekly ad-spend cap of ${formatCurrency(evaluation.capRupees ?? 0)}.`
            : `You're at ${evaluation.pct}% of your weekly ad-spend cap.`}
        </p>
        <p className="mt-0.5">
          {formatCurrency(evaluation.usedRupees)} of{" "}
          {formatCurrency(evaluation.capRupees ?? 0)} committed this week
          {over
            ? ". Pause a campaign or raise the cap to keep spending."
            : `, ${formatCurrency(evaluation.headroomRupees)} left.`}{" "}
          <Link href="/settings" className="font-medium underline">
            Manage guardrails
          </Link>
        </p>
      </div>
    </div>
  );
}
