/**
 * #1799 (QA, recorded validate_only, Oct 28): an uncapped run sets the campaign's spend_cap to the reserved allowance,
 * and Meta refuses one under the ad account's `min_campaign_group_spend_cap` (₹5,000 for INR; subcode 2446307).
 * The activation route passes the live minimum into the one real reservation (`customer_ad_reserve`), which refuses
 * in its own transaction: nothing held, no Meta write, no "uncertain" reservation. Unread: the reservation goes
 * ahead without it and Meta's own refusal is mapped by its subcode.
 */

export type SpendCapMinimumAccount = { id?: string; currency?: string; min_campaign_group_spend_cap?: string };

/** Meta's minimum in paise for this INR account; null for another account, another currency or a malformed value. */
export function minCampaignSpendCapPaise(account: SpendCapMinimumAccount, adAccountId: string): number | null {
  const value = account.min_campaign_group_spend_cap;
  return account.id === adAccountId && account.currency === "INR" && value && /^\d{1,15}$/.test(value) ? Number(value) : null;
}

/** The reservation argument for an uncapped managed run: `{ minMediaLimitPaise }` when Meta's minimum was read, else none. */
export async function spendCapMinimum(meta: { readMinCampaignSpendCapPaise(): Promise<number | null> }): Promise<{ minMediaLimitPaise?: number }> {
  const minimum = await Promise.resolve().then(() => meta.readMinCampaignSpendCapPaise()).catch(() => null);
  return minimum ? { minMediaLimitPaise: minimum } : {};
}
