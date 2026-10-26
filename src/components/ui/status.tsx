import { cn } from "@/lib/utils";
import type { CampaignStatus } from "@/lib/types";

/** #847: status is a dot plus a word in sentence case. Paused is a normal state, so it stays grey. */
const TONES = {
  live: "bg-primary",
  neutral: "bg-slate-400",
  review: "bg-warning",
  failed: "bg-danger",
} as const;

export function Status({ tone, children, className }: { tone: keyof typeof TONES; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", tone === "failed" && "text-danger", className)}>
      <span aria-hidden="true" className={cn("size-[7px] shrink-0 rounded-full", TONES[tone])} />
      {children}
    </span>
  );
}

export const CAMPAIGN_STATUS: Record<CampaignStatus, { label: string; tone: keyof typeof TONES }> = {
  active: { label: "Live", tone: "live" },
  paused: { label: "Paused", tone: "neutral" },
  draft: { label: "Draft", tone: "neutral" },
  completed: { label: "Ended", tone: "neutral" },
};
