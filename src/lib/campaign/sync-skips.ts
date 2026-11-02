import { campaignsTranslator, type Words } from "@/i18n/words";

/** Why campaign sync left a Meta campaign unchanged (#671), so the banner can say it in plain words. */
export type CampaignSkipReason =
  | "not_running"
  | "other_account"
  | "other_page"
  | "other_connection"
  | "other_business"
  | "lifetime_budget"
  | "capped"
  | "unsupported";

export type SkippedCampaign = { name: string | null; reason: CampaignSkipReason };

/** One sentence per skipped campaign, up to three, then a count of the rest; reasons are `campaigns.sync.reasons` (#1438). */
export function describeSkippedCampaigns(skipped: readonly SkippedCampaign[], total = skipped.length, words?: Words<"campaigns">): string {
  const t = campaignsTranslator(words);
  const named = skipped.slice(0, 3).map(({ name, reason }) => {
    const why = t(`sync.reasons.${reason}`);
    return name ? t("sync.named", { name, reason: why }) : t("sync.unnamed", { reason: why });
  });
  const rest = total - named.length;
  if (rest > 0) named.push(t("sync.rest", { n: rest }));
  return named.join(" ");
}
