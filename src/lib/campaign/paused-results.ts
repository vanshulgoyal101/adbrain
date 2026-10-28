/**
 * #1003 (QA 2's #1133 audit): Meta keeps attributing results to an ad for days after it stops, so a paused
 * campaign's card would freeze at the pause minute. After a pause the results are read again once a day
 * later and once at Meta's 7-day attribution window, then left as final.
 */
export const PAUSED_FOLLOW_UPS_MS = [1, 7].map((days) => days * 86_400_000);

/** AdBrain's own pauses: the owner's (card or Ads page) and its spend-cap or capped-run stops. */
export const PAUSE_ACTIONS = ["campaign.pause", "spend.auto_paused"] as const;

/**
 * Whether the scheduled refresh should read a paused campaign now. One with no stored result (an imported
 * campaign) gets one lifetime read. Otherwise only AdBrain's own pause is a reliable start: a campaign paused
 * in Ads Manager has none and keeps its last read.
 */
export function pausedResultsReadDue(pausedAt: string | null, latestFetchedAt: string | null, now = Date.now()): boolean {
  if (!latestFetchedAt) return true;
  if (!pausedAt) return false;
  const paused = Date.parse(pausedAt);
  const latest = Date.parse(latestFetchedAt);
  if (Number.isNaN(paused) || Number.isNaN(latest)) return false;
  return PAUSED_FOLLOW_UPS_MS.some((after) => now >= paused + after && latest < paused + after);
}
