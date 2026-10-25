/**
 * One-off (#245): adopt a capped run created outside AdBrain (the #157 run) so AdBrain's
 * Pause, sync and results manage it. Creates the campaign row from its saved draft
 * through saveCampaign, after an exact read-back of the Meta tree. Read-only on Meta.
 * Dry run by default; --apply writes the row. Mark the business operator-funded first.
 *
 *   npx tsx --env-file=.env.local scripts/adopt-capped-run.ts --draft <draft id> \
 *     --campaign <meta campaign> --source-adset <id> --source-ad <id> \
 *     --capped-adset <id> --capped-ad <id> --days <1-7> [--apply]
 */
import { parseArgs } from "node:util";
import { z } from "zod";
import { intendedCampaignChildren } from "@/lib/campaign/activation";
import { effectiveDailyBudget } from "@/lib/campaign/spend";
import { saveCampaign } from "@/lib/campaign/trusted-write";
import { MetaClient } from "@/lib/meta/client";
import { getMetaCredentialsFromEnv } from "./lib/meta-env";
import { isOperatorFunded } from "@/lib/payments/operator-funding";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/types";

const id = z.string().regex(/^\d{6,30}$/);
const args = z.object({
  draft: z.uuid(), campaign: id, "source-adset": id, "source-ad": id, "capped-adset": id, "capped-ad": id,
  days: z.coerce.number().int().min(1).max(7), apply: z.boolean(),
}).parse(parseArgs({ options: {
  draft: { type: "string" }, campaign: { type: "string" }, "source-adset": { type: "string" }, "source-ad": { type: "string" },
  "capped-adset": { type: "string" }, "capped-ad": { type: "string" }, days: { type: "string" }, apply: { type: "boolean", default: false },
} }).values);

async function main() {
  const database = createAdminClient();
  const { data: draft, error: draftError } = await database.from("campaign_drafts")
    .select("id,business_id,owner_id,input").eq("id", args.draft).single();
  if (draftError || !draft) throw new Error("Draft not found.");
  const input = z.object({
    name: z.string().min(1), dailyBudgetRupees: z.number().positive(),
    destination: z.enum(["instant_form", "whatsapp"]).default("instant_form"), creativeIds: z.array(z.uuid()).default([]),
  }).parse(draft.input);
  const operatorFunded = await isOperatorFunded(draft.business_id).catch(() => false);
  if (args.apply && !operatorFunded) throw new Error("Mark the business operator-funded before adopting an active run.");
  const { data: existing } = await database.from("campaigns").select("id")
    .eq("business_id", draft.business_id).eq("meta_campaign_id", args.campaign).maybeSingle();
  if (existing) throw new Error(`Already adopted as campaign ${existing.id}.`);
  const { data: connection } = await database.from("meta_connections")
    .select("generation,authorization_status,ad_account_id,page_id").eq("business_id", draft.business_id).single();
  const creds = getMetaCredentialsFromEnv();
  if (!creds || !connection || connection.authorization_status !== "connected"
    || connection.ad_account_id !== creds.adAccountId || connection.page_id !== creds.pageId) {
    throw new Error("The env Meta credentials must match the business's connected ad account and Page.");
  }

  const meta = new MetaClient(creds);
  const tree = { adSetIds: [args["source-adset"], args["capped-adset"]], adIds: [args["source-ad"], args["capped-ad"]] };
  const delivery = await meta.readCampaignDelivery(args.campaign, {
    dailyBudgetRupees: input.dailyBudgetRupees, status: "active", ...tree, cappedAdSetIds: [args["capped-adset"]],
  });
  const response = await fetch(`https://graph.facebook.com/v21.0/${args["capped-adset"]}?fields=id,campaign_id,lifetime_budget,end_time&access_token=${encodeURIComponent(creds.accessToken)}`);
  const cappedSet = z.object({ id: z.literal(args["capped-adset"]), campaign_id: z.literal(args.campaign), lifetime_budget: z.string().regex(/^[1-9]\d*$/), end_time: z.string() })
    .parse(await response.json());
  const cappedAd = delivery.ads.find(ad => ad.id === args["capped-ad"]);
  if (cappedAd?.adSetId !== args["capped-adset"]) throw new Error("The capped ad is not in the capped ad set.");
  const live = delivery.campaign.status === "ACTIVE" && delivery.adSets.find(adSet => adSet.id === args["capped-adset"])?.status === "ACTIVE";

  const cap = { adSetId: args["capped-adset"], adIds: [args["capped-ad"]], lifetimeBudgetPaise: Number(cappedSet.lifetime_budget), endTime: new Date(cappedSet.end_time).toISOString(), days: args.days };
  const row = {
    name: input.name, objective: input.destination === "whatsapp" ? "OUTCOME_ENGAGEMENT" : "leads", destination: input.destination,
    daily_budget: effectiveDailyBudget(input.dailyBudgetRupees, 1), status: live ? "active" as const : "paused" as const,
    meta_campaign_id: args.campaign, meta_adset_id: args["source-adset"], meta_ad_ids: tree.adIds,
    meta_ad_account_id: connection.ad_account_id, meta_page_id: connection.page_id, meta_connection_generation: connection.generation,
    creative_ids: input.creativeIds,
    raw: {
      source: "campaign_operation",
      metaResult: { campaignId: args.campaign, adSetId: args["source-adset"], ...tree, destination: input.destination },
      cap, cappedAdSetIds: [args["capped-adset"]],
    },
  };
  if (!intendedCampaignChildren(row)?.cappedAdSetIds.includes(args["capped-adset"])) throw new Error("AdBrain would not recognise this tree.");
  console.log(JSON.stringify({ businessId: draft.business_id, operatorFunded, row }, null, 2));
  if (!args.apply) return console.log("Dry run: nothing written. Re-run with --apply.");
  const { data: saved, error } = await saveCampaign({ businessId: draft.business_id, userId: draft.owner_id }, { ...row, raw: row.raw as unknown as Json });
  if (error || !saved) throw new Error(`Campaign row not saved: ${error?.message ?? "unknown"}`);
  console.log(`Adopted as campaign ${saved.id} (${saved.status}).`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
