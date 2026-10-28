import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { getEnv } from "@/lib/env";
import { isInternalUser, isScoreboardExcluded, type AccountIdentity } from "@/lib/internal-accounts";

/**
 * #1307 (#1255): AdBrain's own pooled results, from the #588 ledger: every AdBrain-made run (a `campaign_learnings`
 * row) that has stopped (paused or completed) and spent, with its latest read. Only totals leave this module, never a
 * business, campaign or person, so any owner may see them; and only once a pool is big enough that no one customer's
 * results can be read from it (Reviewer on #1400). Team, smoke, demo and prospect businesses never count.
 */
export type LedgerTotals = { results: number; spendRupees: number; runs: number };
type Destination = "whatsapp" | "instant_form";
type LedgerRead = { spend?: number | string | null; conversations?: number | null; leads?: number | null };
export type LedgerRun = LedgerRead & { businessId?: string | null; destination?: string | null; status?: string | null };

/** A destination's pool is quoted only from this many stopped runs, by this many different businesses. */
const MIN_RUNS = 5;
const MIN_BUSINESSES = 3;

/** The pooled totals per destination from each run's latest results; null until the pool is big enough. Running campaigns wait until they stop. */
export function poolLedger(runs: LedgerRun[]): Record<Destination, LedgerTotals | null> {
  const pools = { whatsapp: { results: 0, spendRupees: 0, runs: 0, businesses: new Set<string>() }, instant_form: { results: 0, spendRupees: 0, runs: 0, businesses: new Set<string>() } };
  for (const run of runs) {
    const spend = Number(run.spend ?? 0);
    if (run.status === "active" || !(spend > 0) || (run.destination !== "whatsapp" && run.destination !== "instant_form")) continue;
    const pool = pools[run.destination];
    pool.runs += 1;
    pool.spendRupees += spend;
    pool.results += run.destination === "whatsapp" ? run.conversations ?? 0 : run.leads ?? 0;
    if (run.businessId) pool.businesses.add(run.businessId);
  }
  const quoted = ({ results, spendRupees, runs, businesses }: typeof pools.whatsapp): LedgerTotals | null =>
    runs >= MIN_RUNS && businesses.size >= MIN_BUSINESSES ? { results, spendRupees: Math.round(spendRupees * 100) / 100, runs } : null;
  return { whatsapp: quoted(pools.whatsapp), instant_form: quoted(pools.instant_form) };
}

/** Accounts whose runs never shape a customer's expectation: the team, smoke, the demo workspace and sales prospects. */
export function excludedFromLedger(user: AccountIdentity, demoEmail?: string | null): boolean {
  return isInternalUser(user) || isScoreboardExcluded(user, demoEmail);
}

const TTL_MS = 60 * 60 * 1000;
let cached: { at: number; value: Promise<Record<Destination, LedgerTotals | null> | null> } | null = null;

/** The pooled totals, read at most hourly per server; null when the read fails (the line then keeps its recorded figures). */
export function ledgerTotals(now = Date.now()) {
  if (cached && now - cached.at < TTL_MS) return cached.value;
  const value = readLedger().catch(() => null);
  cached = { at: now, value };
  void value.then((result) => { if (!result && cached?.value === value) cached = null; });
  return value;
}

async function readLedger() {
  const admin = createAdminClient();
  // campaign_learnings isn't in the generated types yet.
  const { data: ledger, error } = await (admin as unknown as SupabaseClient).from("campaign_learnings").select("campaign_id").limit(1000);
  if (error) throw error;
  const ids = ((ledger ?? []) as { campaign_id: string }[]).map((row) => row.campaign_id);
  if (!ids.length) return poolLedger([]);
  const [{ data: campaigns, error: campaignsError }, { data: results, error: resultsError }] = await Promise.all([
    admin.from("campaigns").select("id, business_id, status, destination").in("id", ids),
    admin.from("campaign_results").select("campaign_id, spend, conversations, leads, fetched_at").in("campaign_id", ids).order("fetched_at", { ascending: false }).limit(5000),
  ]);
  if (campaignsError || resultsError) throw campaignsError ?? resultsError;
  const latest = new Map<string, LedgerRead>();
  for (const row of results ?? []) if (!latest.has(row.campaign_id)) latest.set(row.campaign_id, row);
  const excluded = await excludedBusinesses(admin, [...new Set((campaigns ?? []).map((campaign) => campaign.business_id))]);
  return poolLedger((campaigns ?? []).flatMap((campaign) => {
    const read = latest.get(campaign.id);
    return read && !excluded.has(campaign.business_id) ? [{ businessId: campaign.business_id, destination: campaign.destination, status: campaign.status, ...read }] : [];
  }));
}

/** The pooled businesses whose owner is excluded; an owner that can't be read is excluded too (the pool only shrinks). */
async function excludedBusinesses(admin: ReturnType<typeof createAdminClient>, businessIds: string[]): Promise<Set<string>> {
  if (!businessIds.length) return new Set();
  const { data: businesses, error } = await admin.from("businesses").select("id, owner_id").in("id", businessIds);
  if (error) throw error;
  const demo = getEnv().DEMO_USER_EMAIL;
  const owners = new Map<string, boolean>();
  for (const ownerId of new Set((businesses ?? []).map((business) => business.owner_id))) {
    const { data } = await admin.auth.admin.getUserById(ownerId).catch(() => ({ data: null }));
    owners.set(ownerId, !data?.user || excludedFromLedger(data.user, demo));
  }
  const known = new Set((businesses ?? []).map((business) => business.id));
  return new Set([...businessIds.filter((id) => !known.has(id)),
    ...(businesses ?? []).filter((business) => owners.get(business.owner_id) !== false).map((business) => business.id)]);
}

/** For tests: forget the hourly read. */
export function resetLedgerCache() {
  cached = null;
}
