/**
 * #209: asks Meta to validate (never create) the WhatsApp campaign, ad set and ad that
 * Prepare would send, and records the answers for test:core. Any POST without
 * execution_options=["validate_only"] is refused before it leaves the process.
 *
 *   npx tsx --env-file=<.env.local> scripts/record-meta-whatsapp-fixtures.ts <adSetBudgetCampaignId> <whatsappAdSetId> <imageHash>
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { destinationCTA, destinationPlan, whatsappWelcomeMessage } from "@/lib/meta/client";
import { whatsappGreeting } from "@/lib/campaign/whatsapp-greeting";

const GRAPH = "https://graph.facebook.com/v21.0/";
const VALIDATE = JSON.stringify(["validate_only"]);
const [campaignId, adSetId, imageHash] = process.argv.slice(2);
if (!campaignId || !adSetId || !imageHash) throw new Error("Pass a PAUSED campaign with ad-set budgets, an existing WhatsApp ad set id and an image hash.");
const token = process.env.META_SYSTEM_USER_TOKEN!;
const account = `act_${process.env.META_AD_ACCOUNT_ID!.replace(/^act_/, "")}`;
const pageId = process.env.META_PAGE_ID!;
// The approved ad (8a5e19e9) and Solaride's Brand, read from production before recording.
const approved = JSON.parse(readFileSync(process.env.APPROVED_JSON!, "utf8"))[0] as { headline: string; primary_text: string; description: string };
const brand = { name: "Solaride", offers: ["Free site survey", "PM Surya Ghar subsidy help", "Diwali offer: 10% off rooftop solar installation"] };
const phone = process.env.WHATSAPP_NUMBER!;
if (!/^\+91\d{10}$/.test(phone)) throw new Error("Set WHATSAPP_NUMBER as +91XXXXXXXXXX.");
const digits = phone.slice(1);

type Exchange = { name: string; path: string; form: Record<string, string>; status: number; body: unknown };
const tape: Exchange[] = [];
const redact = (value: string) => value.replaceAll(digits, "91XXXXXX0874");

async function validate(name: string, path: string, form: Record<string, string>) {
  if (form.execution_options !== VALIDATE) throw new Error("Recorder refuses any POST that is not validate_only.");
  if (form.status && form.status !== "PAUSED") throw new Error("Recorder refuses any status other than PAUSED.");
  const response = await fetch(`${GRAPH}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...form, access_token: token }),
  });
  const body = await response.json();
  tape.push({ name, path, form: JSON.parse(redact(JSON.stringify(form))), status: response.status, body: JSON.parse(redact(JSON.stringify(body))) });
  console.log(name, response.status, redact(JSON.stringify(body)).slice(0, 400));
}

const plan = destinationPlan("whatsapp");
const greeting = whatsappGreeting(brand, [approved.headline, approved.primary_text]);
const targeting = JSON.stringify({ geo_locations: { cities: [{ key: "1021145" }, { key: "2676092" }, { key: "1035473" }], location_types: ["home", "recent"] }, age_min: 25, age_max: 55, targeting_automation: { advantage_audience: 0 } });

async function main() {
await validate("campaign", `${account}/campaigns`, {
  name: "AdBrain #209 validate", objective: "OUTCOME_ENGAGEMENT", status: "PAUSED", special_ad_categories: "[]", is_adset_budget_sharing_enabled: "false", execution_options: VALIDATE,
});
for (const [label, number] of [["plus", phone], ["digits", digits]] as const) {
  await validate(`adset-${label}`, `${account}/adsets`, {
    name: "AdBrain #209 validate", campaign_id: campaignId, status: "PAUSED", daily_budget: "28000", billing_event: "IMPRESSIONS",
    optimization_goal: plan.optimizationGoal, bid_strategy: "LOWEST_COST_WITHOUT_CAP", destination_type: plan.destinationType,
    promoted_object: JSON.stringify({ page_id: pageId, whatsapp_phone_number: number }), targeting, execution_options: VALIDATE,
  });
}
const linkData = (link: string, cta: ReturnType<typeof destinationCTA>) => ({
  image_hash: imageHash, message: approved.primary_text, name: approved.headline, description: approved.description,
  link, call_to_action: cta, page_welcome_message: whatsappWelcomeMessage(greeting),
});
for (const [label, link, cta] of [
  ["ad-wa-me", `https://wa.me/${digits}`, destinationCTA("whatsapp", { phone })],
  ["ad-api-send", "https://api.whatsapp.com/send", { type: "WHATSAPP_MESSAGE", value: { app_destination: "WHATSAPP", link: "https://api.whatsapp.com/send" } }],
] as const) {
  await validate(label, `${account}/ads`, {
    name: "AdBrain #209 validate", adset_id: adSetId, status: "PAUSED", execution_options: VALIDATE,
    creative: JSON.stringify({ object_story_spec: { page_id: pageId, link_data: linkData(link, cta) } }),
  });
}
writeFileSync(join(process.cwd(), "tests/core/fixtures/meta/whatsapp-validate.json"), `${JSON.stringify({ recordedAt: new Date().toISOString(), greeting, tape }, null, 2)}\n`);
console.log(`whatsapp-validate: ${tape.length} exchanges`);
}

main().catch((error) => { console.error(error); process.exit(1); });
