import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * #1307 (#1255): AdBrain's own pooled results, from the #588 ledger: every AdBrain-made run (a `campaign_learnings`
 * row) that has stopped (paused or completed) and spent, with its latest read. Only totals leave this module, never a
 * business, campaign or person, so any owner may see them. Today: 6 chats for ₹1,195 (Analyst, Oct 28).
 */
export type LedgerTotals = { results: number; spendRupees: number; runs: number };
type LedgerRead = { spend?: number | string | null; conversations?: number | null; leads?: number | null };
export type LedgerRun = LedgerRead & { destination?: string | null; status?: string | null };

/** The pooled totals per destination, from each run's latest results. Running campaigns aren't counted until they stop. */
export function poolLedger(runs: LedgerRun[]): Record<"whatsapp" | "instant_form", LedgerTotals> {
  const pooled = { whatsapp: { results: 0, spendRupees: 0, runs: 0 }, instant_form: { results: 0, spendRupees: 0, runs: 0 } };
  for (const run of runs) {
    const spend = Number(run.spend ?? 0);
    if (run.status === "active" || !(spend > 0) || (run.destination !== "whatsapp" && run.destination !== "instant_form")) continue;
    const totals = pooled[run.destination];
    totals.runs += 1;
    totals.spendRupees += spend;
    totals.results += run.destination === "whatsapp" ? run.conversations ?? 0 : run.leads ?? 0;
  }
  for (const totals of Object.values(pooled)) totals.spendRupees = Math.round(totals.spendRupees * 100) / 100;
  return pooled;
}

const TTL_MS = 60 * 60 * 1000;
let cached: { at: number; value: Promise<Record<"whatsapp" | "instant_form", LedgerTotals> | null> } | null = null;

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
    admin.from("campaigns").select("id, status, destination").in("id", ids),
    admin.from("campaign_results").select("campaign_id, spend, conversations, leads, fetched_at").in("campaign_id", ids).order("fetched_at", { ascending: false }).limit(5000),
  ]);
  if (campaignsError || resultsError) throw campaignsError ?? resultsError;
  const latest = new Map<string, LedgerRead>();
  for (const row of results ?? []) if (!latest.has(row.campaign_id)) latest.set(row.campaign_id, row);
  return poolLedger((campaigns ?? []).flatMap((campaign) => {
    const read = latest.get(campaign.id);
    return read ? [{ destination: campaign.destination, status: campaign.status, ...read }] : [];
  }));
}

/** For tests: forget the hourly read. */
export function resetLedgerCache() {
  cached = null;
}
