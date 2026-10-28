import Link from "next/link";
import { formatMoney } from "@/lib/format";
import type { WeeklyCapNotice } from "@/lib/campaign/spend";
import { cn } from "@/lib/utils";

/** The words for the cap line, shared by Review, activation and the budget field's refusal (#1342). */
export function weeklyCapWords(notice: WeeklyCapNotice): string {
  const cap = `Your weekly cap: ${formatMoney(notice.capRupees)}`;
  if (notice.projectedWeekly === null) return `${cap}.`;
  const week = `with this campaign, about ${formatMoney(Math.round(notice.projectedWeekly))} a week`;
  return notice.exceeds
    ? `${cap} · ${week}, over the cap. Lower the daily budget or raise the cap in Settings.`
    : `${cap} · ${week}.`;
}

/** #1342: the weekly cap from Settings, shown wherever the owner decides a budget. Renders nothing without a cap. */
export function WeeklyCapLine({ notice, id, className, announce = true }: {
  notice: WeeklyCapNotice | null;
  id?: string;
  className?: string;
  /** False where another line on screen already announces the same refusal. */
  announce?: boolean;
}) {
  if (!notice) return null;
  return (
    <p id={id} role={notice.exceeds && announce ? "alert" : undefined}
      className={cn("text-sm", notice.exceeds ? "font-medium text-red-800" : "text-slate-600", className)}>
      {weeklyCapWords(notice)}
      {notice.exceeds && <>{" "}<Link href="/settings" className="underline underline-offset-4">Open Settings</Link></>}
    </p>
  );
}
