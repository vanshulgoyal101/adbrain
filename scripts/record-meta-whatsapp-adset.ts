/**
 * #209/#157: validates (never creates) the WhatsApp ad set Prepare would send, under a
 * temporary empty PAUSED Engagement campaign that is deleted afterwards. Phone numbers
 * come from the business's WhatsApp Business Accounts and are redacted in the tape.
 *
 *   npx tsx --env-file=<.env.local> scripts/record-meta-whatsapp-adset.ts <businessId>
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { destinationPlan } from "@/lib/meta/client";

const GRAPH = "https://graph.facebook.com/v21.0/";
const VALIDATE = JSON.stringify(["validate_only"]);
const token = process.env.META_SYSTEM_USER_TOKEN!;
const account = `act_${process.env.META_AD_ACCOUNT_ID!.replace(/^act_/, "")}`;
const pageId = process.env.META_PAGE_ID!;
const businessId = process.argv[2];
if (!businessId) throw new Error("Pass the Meta business id.");

type Exchange = { name: string; method: string; path: string; form?: Record<string, string>; status: number; body: unknown };
const tape: Exchange[] = [];
const secrets: [string, string][] = [];
const redact = (value: string) => secrets.reduce((text, [secret, label]) => text.replaceAll(secret, label), value);

async function graph(name: string, method: "GET" | "POST" | "DELETE", path: string, form?: Record<string, string>) {
  if (method === "POST" && form?.execution_options !== VALIDATE && !(path === `${account}/campaigns` && form?.status === "PAUSED")) {
    throw new Error("Only validate_only POSTs and one PAUSED campaign are allowed.");
  }
  const url = `${GRAPH}${path}${method === "POST" ? "" : `${path.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(token)}`}`;
  const response = await fetch(url, method === "POST"
    ? { method, headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ ...form, access_token: token }) }
    : { method });
  const body = await response.json();
  tape.push({ name, method, path: redact(path), ...(form ? { form: JSON.parse(redact(JSON.stringify(form))) } : {}), status: response.status, body: JSON.parse(redact(JSON.stringify(body))) });
  console.log(name, response.status, redact(JSON.stringify(body)).slice(0, 300));
  return body as Record<string, unknown>;
}

async function main() {
  const wabas = await fetch(`${GRAPH}${businessId}/owned_whatsapp_business_accounts?fields=id,name,phone_numbers{display_phone_number}&access_token=${encodeURIComponent(token)}`).then(r => r.json()) as { data: { name: string; phone_numbers?: { data: { display_phone_number: string }[] } }[] };
  const numbers = wabas.data.flatMap(waba => (waba.phone_numbers?.data ?? []).map(phone => ({ waba: waba.name, digits: phone.display_phone_number.replace(/\D/g, "") })));
  for (const { digits } of numbers) secrets.push([digits, `91XXXXXX${digits.slice(-4)}`], [digits.slice(2), `XXXXXX${digits.slice(-4)}`]);
  console.log("numbers:", numbers.map(n => `${n.waba} …${n.digits.slice(-4)}`).join(", "));

  const campaign = await graph("campaign-paused", "POST", `${account}/campaigns`, {
    name: "AdBrain #209 ad set check (PAUSED, empty, deleted after)", objective: "OUTCOME_ENGAGEMENT", status: "PAUSED",
    special_ad_categories: "[]", is_adset_budget_sharing_enabled: "false",
  });
  const campaignId = String(campaign.id ?? "");
  if (!campaignId) throw new Error("Meta did not create the temporary campaign.");
  try {
    const plan = destinationPlan("whatsapp");
    const targeting = JSON.stringify({ geo_locations: { cities: [{ key: "1021145" }, { key: "2676092" }, { key: "1035473" }], location_types: ["home", "recent"] }, age_min: 25, age_max: 55, targeting_automation: { advantage_audience: 0 } });
    for (const { digits } of numbers) for (const [format, value] of [["plus", `+${digits}`], ["digits", digits]] as const) {
      await graph(`adset-${digits.slice(-4)}-${format}`, "POST", `${account}/adsets`, {
        name: "AdBrain #209 validate", campaign_id: campaignId, status: "PAUSED", daily_budget: "28000", billing_event: "IMPRESSIONS",
        optimization_goal: plan.optimizationGoal, bid_strategy: "LOWEST_COST_WITHOUT_CAP", destination_type: plan.destinationType,
        promoted_object: JSON.stringify({ page_id: pageId, whatsapp_phone_number: value }), targeting, execution_options: VALIDATE,
      });
    }
  } finally {
    await graph("campaign-delete", "DELETE", campaignId);
  }
  const file = join(process.cwd(), "tests/core/fixtures/meta/whatsapp-adset-validate.json");
  writeFileSync(file, `${JSON.stringify({ recordedAt: new Date().toISOString(), tape: tape.map(entry => ({ ...entry, path: entry.path.replace(campaignId, "TEMP_CAMPAIGN") , form: entry.form && JSON.parse(JSON.stringify(entry.form).replaceAll(campaignId, "TEMP_CAMPAIGN")) })) }, null, 2)}\n`);
  console.log(`whatsapp-adset-validate: ${tape.length} exchanges`);
}

main().catch((error) => { console.error(error); process.exit(1); });
