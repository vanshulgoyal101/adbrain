/** Why campaign sync left a Meta campaign unchanged (#671), so the banner can say it in plain words. */
export type CampaignSkipReason =
  | "not_running"
  | "other_account"
  | "other_page"
  | "other_connection"
  | "lifetime_budget"
  | "capped"
  | "unsupported";

export type SkippedCampaign = { name: string | null; reason: CampaignSkipReason };

export const SKIP_REASON_TEXT: Record<CampaignSkipReason, string> = {
  not_running: "it's archived or deleted in Meta",
  other_account: "it belongs to a different ad account",
  other_page: "it advertises a different Facebook Page",
  other_connection: "it was launched from a different ad account or Page",
  lifetime_budget: "it uses a lifetime budget set in Meta, which AdBrain doesn't manage",
  capped: "it runs on a spend cap AdBrain manages, so sync leaves it as is",
  unsupported: "its ad sets or budget aren't a setup AdBrain can manage",
};

/** One sentence per skipped campaign, up to three, then a count of the rest. */
export function describeSkippedCampaigns(skipped: readonly SkippedCampaign[], total = skipped.length): string {
  const named = skipped.slice(0, 3).map(({ name, reason }) => `${name ? `"${name}"` : "A campaign"} was left unchanged: ${SKIP_REASON_TEXT[reason]}.`);
  const rest = total - named.length;
  if (rest > 0) named.push(`${rest} more campaign${rest === 1 ? " was" : "s were"} left unchanged.`);
  return named.join(" ");
}
