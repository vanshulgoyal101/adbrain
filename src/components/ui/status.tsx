import { cn } from "@/lib/utils";
import type { Campaign, CampaignStatus } from "@/lib/types";
import { goneInMeta, pausedInMeta } from "@/lib/campaign/gone-in-meta";
import { OWNER_WORDS } from "@/lib/copy/owner-words";

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
  active: { label: OWNER_WORDS.running, tone: "live" },
  paused: { label: "Paused", tone: "neutral" },
  draft: { label: "Draft", tone: "neutral" },
  completed: { label: "Ended", tone: "neutral" },
};

/** #1150: one status word for a campaign on every page; deleted or archived in Meta says so. */
export function campaignStatus(campaign: Pick<Campaign, "status" | "raw">): { label: string; tone: keyof typeof TONES } {
  const gone = goneInMeta(campaign);
  if (pausedInMeta(campaign)) return { label: "Paused in Meta", tone: "neutral" };
  return gone ? { label: gone, tone: "neutral" } : CAMPAIGN_STATUS[campaign.status as CampaignStatus] ?? CAMPAIGN_STATUS.draft;
}
