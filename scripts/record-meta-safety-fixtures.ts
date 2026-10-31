/**
 * #157: records real Graph responses for the first-activation safety checks from ONE
 * PAUSED test campaign (cap, review status, three-level pause), plus read-only ad
 * account insights, then archives the campaign. Any ACTIVE write is refused.
 *
 *   npx tsx --env-file=.env.local scripts/record-meta-safety-fixtures.ts <imageUrl> [capped-adset]
 */
import "./lib/meta-write-gate";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { metaClientFromEnv } from "./lib/meta-env";

type Exchange = { method: string; path: string; form?: Record<string, string>; status: number; body: unknown };

const GRAPH = "https://graph.facebook.com/v26.0/";
const OUT = join(process.cwd(), "tests/core/fixtures/meta/safety");
const CAP_PAISE = 60_000;
let tape: Exchange[] = [];
const realFetch = globalThis.fetch;

function scrub(value: unknown): unknown {
  if (typeof value === "string") return value.replace(/access_token=[^&"\s]+/g, "access_token=REDACTED");
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) =>
      [key, key === "access_token" ? "REDACTED" : scrub(item)]));
  }
  return value;
}

globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (!url.startsWith(GRAPH)) return realFetch(input, init);
  const formEntries = init?.body instanceof URLSearchParams ? [...init.body] : [];
  if (formEntries.some(([key, value]) => (key === "status" || key === "status_option") && value !== "PAUSED" && value !== "ARCHIVED")) {
    throw new Error("Recorder refuses any status other than PAUSED or ARCHIVED.");
  }
  const response = await realFetch(input, init);
  const body = await response.clone().json().catch(() => null);
  const parsed = new URL(url);
  parsed.searchParams.delete("access_token");
  const form = formEntries.length
    ? Object.fromEntries(formEntries.filter(([key]) => key !== "access_token")
      .map(([key, value]) => [key, key === "bytes" ? "<image bytes>" : value]))
    : undefined;
  tape.push({
    method: init?.method ?? "GET",
    path: parsed.pathname.replace("/v26.0/", "") + parsed.search,
    ...(form ? { form } : {}),
    status: response.status,
    body: scrub(body),
  });
  return response;
};

function save(name: string) {
  writeFileSync(join(OUT, `${name}.json`), `${JSON.stringify(tape, null, 2)}\n`);
  console.log(`${name}: ${tape.length} exchanges`);
  tape = [];
}

async function raw(path: string, form?: Record<string, string>) {
  const token = process.env.META_SYSTEM_USER_TOKEN!;
  const response = form
    ? await fetch(`${GRAPH}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ ...form, access_token: token }),
    })
    : await fetch(`${GRAPH}${path}${path.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(token)}`);
  return response.json() as Promise<Record<string, unknown>>;
}

async function main() {
  const imageUrl = process.argv[2];
  if (!imageUrl) throw new Error("Pass a public creative image URL.");
  const meta = metaClientFromEnv();
  if (!meta) throw new Error("Meta env credentials are missing.");
  const account = `act_${process.env.META_AD_ACCOUNT_ID!.replace(/^act_/, "")}`;
  mkdirSync(OUT, { recursive: true });

  await raw(`${account}?fields=id,currency,min_campaign_group_spend_cap,min_daily_budget,spend_cap,amount_spent`);
  save("account");

  const forms = await meta.listLeadForms();
  if (!forms.length) throw new Error("No active lead form on the Page.");
  const geo = await meta.resolveGeoTargeting(["Austin, Texas"], { cityScope: "city_only" });
  const created = await meta.createLeadCampaign({
    name: `AdBrain safety fixture ${new Date().toISOString().slice(0, 16)} (PAUSED test)`,
    dailyBudgetRupees: 200, leadFormId: forms[0].id, link: "https://adbrain.vanshul.com",
    creatives: [{ imageUrl, headline: "Safety fixture", message: "Recorded for #157. Never activated.", cta: "Learn More" }],
    ageMin: 25, ageMax: 55, gender: "all", interests: [], location: geo.targeting, destination: "instant_form",
  });
  tape = [];
  const campaignId = created.campaignId;
  const [adSetId] = created.adSetIds;
  const [adId] = created.adIds;
  console.log(JSON.stringify(created));
  try {
    if (process.argv[3] === "capped-adset") await recordCappedAdSet(meta, campaignId, adSetId, adId);
    else await record(meta, account, campaignId, adSetId, adId);
  } finally {
    if (tape.length) save("failed");
    await raw(campaignId, { status: "ARCHIVED" });
    await raw(`${campaignId}?fields=id,status,effective_status`);
    save("archive");
  }
}

async function record(meta: NonNullable<ReturnType<typeof metaClientFromEnv>>, account: string, campaignId: string, adSetId: string, adId: string) {
  // 1. Cap: a campaign spend cap through the existing client path, then an ad-set lifetime budget.
  try {
    await meta.enforceCampaignSpendCap(campaignId, CAP_PAISE);
    console.log("campaign spend_cap accepted");
  } catch (error) {
    console.log("campaign spend_cap refused:", error instanceof Error ? error.message : error);
  }
  save("campaign-spend-cap");

  const endTime = new Date(Date.now() + 3 * 86_400_000).toISOString();
  await raw(adSetId, { lifetime_budget: String(CAP_PAISE), end_time: endTime });
  save("switch-daily-to-lifetime");

  const lifetime = await raw(`${account}/adsets`, {
    name: "AdBrain safety fixture lifetime ad set (PAUSED test)",
    campaign_id: campaignId, status: "PAUSED", lifetime_budget: String(CAP_PAISE), end_time: endTime,
    billing_event: "IMPRESSIONS", optimization_goal: "LEAD_GENERATION", bid_strategy: "LOWEST_COST_WITHOUT_CAP",
    destination_type: "ON_AD", promoted_object: JSON.stringify({ page_id: process.env.META_PAGE_ID }),
    targeting: JSON.stringify({ geo_locations: { cities: [{ key: "2525495" }], location_types: ["home", "recent"] }, age_min: 25, age_max: 55, targeting_automation: { advantage_audience: 0 } }),
  });
  if (typeof lifetime.id === "string") {
    await raw(`${lifetime.id}?fields=id,status,effective_status,daily_budget,lifetime_budget,budget_remaining,start_time,end_time`);
  }
  save("adset-lifetime-budget");

  // 2. Review status as Meta reports it for this ad and for the account's existing ads.
  await raw(`${campaignId}/ads?fields=id,status,effective_status,configured_status,ad_review_feedback,issues_info&limit=100`);
  save("review-new-ad");
  await raw(`${account}/ads?fields=id,status,effective_status,ad_review_feedback,issues_info&limit=100`);
  const listing = tape[0].body as { data?: Array<{ effective_status?: string; ad_review_feedback?: unknown; issues_info?: unknown }> };
  const examples = new Map<string, unknown>();
  for (const ad of listing.data ?? []) {
    const key = `${ad.effective_status}:${ad.ad_review_feedback ? "feedback" : ""}:${ad.issues_info ? "issues" : ""}`;
    if (!examples.has(key)) examples.set(key, ad);
  }
  tape = [{ ...tape[0], body: { data: [...examples.values()] } }];
  save("review-account-examples");

  // 3. Emergency pause: campaign, ad set and ad, then read each back.
  await raw(campaignId, { status: "PAUSED" });
  await raw(adSetId, { status: "PAUSED" });
  await raw(adId, { status: "PAUSED" });
  await raw(`${campaignId}?fields=id,status,effective_status`);
  await raw(`${campaignId}/adsets?fields=id,status,effective_status&limit=100`);
  await raw(`${campaignId}/ads?fields=id,status,effective_status&limit=100`);
  save("pause-all");

  // 4. Spend observation: real insights shapes from the ad account (read-only).
  await raw(`${account}/insights?level=campaign&fields=campaign_id,spend,impressions,clicks,actions,account_currency,date_start,date_stop&date_preset=maximum&limit=25`);
  await raw(`${account}/insights?level=campaign&fields=campaign_id,spend,account_currency,date_start,date_stop&time_increment=1&date_preset=last_30d&limit=25`);
  await raw(`${campaignId}/insights?fields=impressions,clicks,spend,actions,date_start,date_stop`);
  save("insights");
}

type Meta = NonNullable<ReturnType<typeof metaClientFromEnv>>;

// Below the ₹5,000 campaign spend-cap minimum: lifetime-budget ad set with PAUSED ad copies, read back.
async function recordCappedAdSet(meta: Meta, campaignId: string, adSetId: string, adId: string) {
  const capped = await meta.createCappedAdSet(campaignId, {
    sourceAdSetId: adSetId, sourceAdIds: [adId], lifetimeBudgetPaise: CAP_PAISE, endTime: new Date(Date.now() + 3 * 86_400_000),
  });
  console.log(JSON.stringify(capped));
  save("capped-adset");
  await fetch(`${GRAPH}${capped.adSetId}?access_token=${encodeURIComponent(process.env.META_SYSTEM_USER_TOKEN!)}`, { method: "DELETE" });
  save("capped-adset-delete");
}

main().catch((error) => {
  if (tape.length) save("failed");
  console.error(error instanceof Error ? error.message : "Recording failed.");
  process.exitCode = 1;
});
