/**
 * #334: validates (never creates) Leads ad sets with Advantage+ audience on, under a
 * temporary empty PAUSED Leads campaign that is deleted afterwards. Nothing can spend.
 *
 *   npx tsx --env-file=<.env.local> scripts/record-meta-advantage-audience.ts
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { destinationPlan } from "@/lib/meta/client";

const GRAPH = "https://graph.facebook.com/v26.0/";
const VALIDATE = JSON.stringify(["validate_only"]);
const token = process.env.META_SYSTEM_USER_TOKEN!;
const account = `act_${process.env.META_AD_ACCOUNT_ID!.replace(/^act_/, "")}`;
const pageId = process.env.META_PAGE_ID!;

type Exchange = { name: string; method: string; path: string; form?: Record<string, string>; status: number; body: unknown };
const tape: Exchange[] = [];

async function graph(name: string, method: "GET" | "POST" | "DELETE", path: string, form?: Record<string, string>) {
  if (method === "POST" && form?.execution_options !== VALIDATE && !(path === `${account}/campaigns` && form?.status === "PAUSED")) {
    throw new Error("Only validate_only POSTs and one PAUSED campaign are allowed.");
  }
  const url = `${GRAPH}${path}${method === "POST" ? "" : `${path.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(token)}`}`;
  const response = await fetch(url, method === "POST"
    ? { method, headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ ...form, access_token: token }) }
    : { method });
  const body = await response.json();
  tape.push({ name, method, path: path.replace(account, "act_ACCOUNT").replace(pageId, "PAGE"), ...(form ? { form: JSON.parse(JSON.stringify(form).replaceAll(pageId, "PAGE")) } : {}), status: response.status, body });
  console.log(name, response.status, JSON.stringify(body).slice(0, 400));
  return body as Record<string, unknown>;
}

// Tricity (Chandigarh, Mohali, Panchkula), as on the Solaride run.
const geo = { geo_locations: { cities: [{ key: "1021145" }, { key: "2676092" }, { key: "1035473" }], location_types: ["home", "recent"] } };

async function main() {
  const found = await graph("interest-search", "GET", "search?type=adinterest&q=Solar%20energy&limit=1") as { data?: { id: string; name: string }[] };
  const interest = found.data?.[0];
  if (!interest) throw new Error("No interest found for the check.");

  const campaign = await graph("campaign-paused", "POST", `${account}/campaigns`, {
    name: "AdBrain #334 ad set check (PAUSED, empty, deleted after)", objective: "OUTCOME_LEADS", status: "PAUSED",
    special_ad_categories: "[]", is_adset_budget_sharing_enabled: "false",
  });
  const campaignId = String(campaign.id ?? "");
  if (!campaignId) throw new Error("Meta did not create the temporary campaign.");
  const plan = destinationPlan("instant_form");
  const variants: [string, Record<string, unknown>][] = [
    ["off-baseline", { ...geo, age_min: 25, age_max: 55, targeting_automation: { advantage_audience: 0 } }],
    ["on-age-25-55", { ...geo, age_min: 25, age_max: 55, targeting_automation: { advantage_audience: 1 } }],
    ["on-age-25-65", { ...geo, age_min: 25, age_max: 65, targeting_automation: { advantage_audience: 1 } }],
    ["on-min-25-no-max", { ...geo, age_min: 25, targeting_automation: { advantage_audience: 1 } }],
    ["on-min-30", { ...geo, age_min: 30, age_max: 65, targeting_automation: { advantage_audience: 1 } }],
    ["on-age-range-suggestion", { ...geo, age_min: 25, age_max: 65, age_range: [25, 55], targeting_automation: { advantage_audience: 1 } }],
    ["on-age-range-30-55", { ...geo, age_min: 25, age_max: 65, age_range: [30, 55], targeting_automation: { advantage_audience: 1 } }],
    ["on-age-range-41-55-split", { ...geo, age_min: 25, age_max: 65, age_range: [41, 55], targeting_automation: { advantage_audience: 1 } }],
    ["on-gender-interest", { ...geo, age_min: 25, age_max: 65, genders: [1], flexible_spec: [{ interests: [{ id: interest.id, name: interest.name }] }], targeting_automation: { advantage_audience: 1 } }],
    ["on-excluded-geo", { ...geo, excluded_geo_locations: { cities: [{ key: "1035473" }] }, age_min: 25, age_max: 65, targeting_automation: { advantage_audience: 1 } }],
  ];
  try {
    for (const [name, targeting] of variants) {
      await graph(`adset-${name}`, "POST", `${account}/adsets`, {
        name: `AdBrain #334 validate ${name}`, campaign_id: campaignId, status: "PAUSED", daily_budget: "28000", billing_event: "IMPRESSIONS",
        optimization_goal: plan.optimizationGoal, bid_strategy: "LOWEST_COST_WITHOUT_CAP", destination_type: plan.destinationType,
        promoted_object: JSON.stringify({ page_id: pageId }), targeting: JSON.stringify(targeting), execution_options: VALIDATE,
      });
    }
  } finally {
    await graph("campaign-delete", "DELETE", campaignId);
  }
  const scrub = (value: unknown) => JSON.parse(JSON.stringify(value).replaceAll(campaignId, "TEMP_CAMPAIGN"));
  const file = join(process.cwd(), "tests/core/fixtures/meta/advantage-audience-validate.json");
  writeFileSync(file, `${JSON.stringify({ recordedAt: new Date().toISOString(), tape: tape.map(scrub) }, null, 2)}\n`);
  console.log(`advantage-audience-validate: ${tape.length} exchanges`);
}

main().catch((error) => { console.error(error); process.exit(1); });
