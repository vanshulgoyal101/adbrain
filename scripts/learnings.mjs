// #588: write the learning ledger's human half (QA 2 owns it): the hypothesis a run tests and its
// verdict, and, for runs launched before the ledger existed (#157), the settings snapshot.
//   node --env-file=.env.local scripts/learnings.mjs set <meta campaign id> [--hypothesis "…"] [--verdict "…"] [--snapshot file.json]
// Production data write (one campaign_learnings row; no schema change): uses SUPABASE_SERVICE_ROLE_KEY.
// Never put lead personal data in these fields. Read it back with `npm run stats -- --include-internal learnings`.
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { createClient } from "@supabase/supabase-js";

/** @param {{ hypothesis?: string, verdict?: string, snapshot?: unknown }} input */
export function learningUpdate({ hypothesis, verdict, snapshot }) {
  const update = {};
  for (const [key, value] of Object.entries({ hypothesis, verdict })) {
    if (value === undefined) continue;
    const trimmed = value.trim();
    if (trimmed.length < 1 || trimmed.length > 500) throw new Error(`--${key} must be 1–500 characters.`);
    update[key] = trimmed;
  }
  if (snapshot !== undefined) {
    if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) throw new Error("--snapshot must be a JSON object.");
    update.snapshot = { version: 1, backfilled: true, ...snapshot };
  }
  if (!Object.keys(update).length) throw new Error("Give --hypothesis, --verdict or --snapshot.");
  return { ...update, updated_at: new Date().toISOString() };
}

/**
 * Businesses sharing one ad account each import its campaigns on sync, so one Meta id can have
 * several AdBrain rows. The ledger row belongs to the one that launched it (it holds the snapshot).
 * @param {Array<{ id: string, business_id: string }>} campaigns
 * @param {string[]} ledgerCampaignIds campaign ids that already have a campaign_learnings row
 */
export function pickCampaign(campaigns, ledgerCampaignIds, metaCampaignId) {
  if (campaigns.length === 1) return campaigns[0];
  const launched = campaigns.filter((campaign) => ledgerCampaignIds.includes(campaign.id));
  if (launched.length === 1) return launched[0];
  if (!campaigns.length) throw new Error(`No AdBrain campaign has Meta id ${metaCampaignId}.`);
  throw new Error(`Meta id ${metaCampaignId} is on ${campaigns.length} AdBrain campaigns (businesses ${campaigns.map((c) => c.business_id.slice(0, 8)).join(", ")}) and ${launched.length} have a ledger row; fix the rows first.`);
}

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { hypothesis: { type: "string" }, verdict: { type: "string" }, snapshot: { type: "string" } } });
  const [command, metaCampaignId] = positionals;
  if (command !== "set" || !/^\d{6,24}$/.test(metaCampaignId ?? "")) throw new Error('Usage: scripts/learnings.mjs set <meta campaign id> [--hypothesis "…"] [--verdict "…"] [--snapshot file.json]');
  const update = learningUpdate({ hypothesis: values.hypothesis, verdict: values.verdict, snapshot: values.snapshot ? JSON.parse(readFileSync(values.snapshot, "utf8")) : undefined });
  const database = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data: campaigns, error } = await database.from("campaigns").select("id, business_id").eq("meta_campaign_id", metaCampaignId);
  if (error) throw new Error(`Couldn't read campaigns: ${error.message}`);
  const { data: ledger, error: ledgerError } = campaigns.length
    ? await database.from("campaign_learnings").select("campaign_id").in("campaign_id", campaigns.map((c) => c.id))
    : { data: [], error: null };
  if (ledgerError) throw new Error(`Couldn't read the ledger: ${ledgerError.message}`);
  const ledgerIds = ledger.map((row) => row.campaign_id);
  const campaign = pickCampaign(campaigns, ledgerIds, metaCampaignId);
  const write = ledgerIds.includes(campaign.id)
    ? database.from("campaign_learnings").update(update).eq("campaign_id", campaign.id)
    : database.from("campaign_learnings").insert({ campaign_id: campaign.id, business_id: campaign.business_id, ...update });
  const { error: writeError } = await write;
  if (writeError) throw new Error(`Couldn't save: ${writeError.message}`);
  console.log(`Saved ${Object.keys(update).filter((key) => key !== "updated_at").join(", ")} for campaign ${metaCampaignId}.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => { console.error(error.message); process.exit(1); });
}
