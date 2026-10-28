/**
 * #333: asks Meta to validate (never create) a WhatsApp ad whose creative carries a 4:5 feed image
 * and a 9:16 Stories/Reels image via asset_feed_spec placement rules, and records the answers for
 * test:core. Any POST without execution_options=["validate_only"] is refused before it leaves the process.
 * A control sends a malformed page_welcome_message: Meta fails it, so the valid greeting is really read.
 * The real sequence is recorded too: create the creative (an unused creative costs nothing; nothing
 * runs without an ad), then validate an ad that uses it, with and without the Page's Instagram id.
 * Without it Meta refuses the ad ("Instagram Account Is Missing", subcode 1772103).
 *
 *   WHATSAPP_NUMBER=+91XXXXXXXXXX npx tsx --env-file=<.env.local> scripts/record-meta-story-fixtures.ts <whatsappAdSetId> <feedHash> <storyHash>
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { whatsappGreeting } from "@/lib/campaign/whatsapp-greeting";
import { placementCreativeSpec } from "@/lib/meta/client";

const GRAPH = "https://graph.facebook.com/v26.0/";
const VALIDATE = JSON.stringify(["validate_only"]);
const [adSetId, feedHash, storyHash] = process.argv.slice(2);
if (!adSetId || !feedHash || !storyHash) throw new Error("Pass a WhatsApp ad set id and the feed and story image hashes.");
const token = process.env.META_SYSTEM_USER_TOKEN!;
const account = `act_${process.env.META_AD_ACCOUNT_ID!.replace(/^act_/, "")}`;
const pageId = process.env.META_PAGE_ID!;
const phone = process.env.WHATSAPP_NUMBER!;
if (!/^\+91\d{10}$/.test(phone)) throw new Error("Set WHATSAPP_NUMBER as +91XXXXXXXXXX.");
const digits = phone.slice(1);
const redact = (value: string) => value.replaceAll(digits, "91XXXXXX0874");

// The approved Solaride ad 8a5e19e9 (public copy).
const ad = {
  headline: "Wondering Whether Your Roof Is Ready?",
  message: "Unsure if your roof can take solar? Free site survey first, plus PM Surya Ghar subsidy help from our team.\nMessage Solaride on WhatsApp to book your free site survey.",
  description: "Solaride checks your roof before any work starts.",
};
const greeting = whatsappGreeting({ name: "Solaride", offers: ["Free site survey", "PM Surya Ghar subsidy help"] }, [ad.headline, ad.message]);

type Exchange = { name: string; path: string; form: Record<string, string>; status: number; body: unknown };
const tape: Exchange[] = [];

async function validate(name: string, form: Record<string, string>) {
  if (form.execution_options !== VALIDATE || form.status !== "PAUSED") throw new Error("Recorder refuses anything but a PAUSED validate_only ad.");
  const path = `${account}/ads`;
  const response = await fetch(`${GRAPH}${path}`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ ...form, locale: "en_US", access_token: token }) });
  const body = await response.json();
  tape.push({ name, path, form: JSON.parse(redact(JSON.stringify(form)).replace(/"creative_id":"\d+"/, "\"creative_id\":\"CREATIVE_ID\"")), status: response.status, body: JSON.parse(redact(JSON.stringify(body))) });
  console.log(name, response.status, redact(JSON.stringify(body)).slice(0, 600));
}

async function createCreative(name: string, form: Record<string, string>) {
  const path = `${account}/adcreatives`;
  const response = await fetch(`${GRAPH}${path}`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ ...form, locale: "en_US", access_token: token }) });
  const body = await response.json() as { id?: string };
  tape.push({ name, path, form: JSON.parse(redact(JSON.stringify(form))), status: response.status, body: { id: body.id ? "CREATIVE_ID" : undefined, ...(body.id ? {} : body) } });
  console.log(name, response.status, JSON.stringify(body).slice(0, 300));
  if (!body.id) throw new Error("Creative was not created.");
  return body.id;
}

async function main() {
  const pageToken = (await (await fetch(`${GRAPH}${pageId}?fields=access_token&access_token=${token}`)).json()).access_token as string;
  const page = await (await fetch(`${GRAPH}${pageId}?fields=instagram_business_account,page_backed_instagram_accounts&access_token=${pageToken}`)).json();
  const instagramUserId: string = page.instagram_business_account?.id ?? page.page_backed_instagram_accounts.data[0].id;
  const inputs = {
    pageId,
    instagramUserId,
    feedHash,
    storyHash,
    headline: ad.headline,
    message: ad.message,
    description: ad.description,
    link: `https://wa.me/${digits}`,
    whatsappNumber: phone,
    whatsappGreeting: greeting,
    destination: "whatsapp" as const,
  };
  const spec = placementCreativeSpec(inputs);
  const bogus = { ...spec, asset_feed_spec: { ...spec.asset_feed_spec, additional_data: { page_welcome_message: "{not json" } } };
  await validate("control-malformed-welcome", { name: "AdBrain #333 validate", adset_id: adSetId, status: "PAUSED", execution_options: VALIDATE, creative: JSON.stringify(bogus) });
  await validate("story-whatsapp", { name: "AdBrain #333 validate", adset_id: adSetId, status: "PAUSED", execution_options: VALIDATE, creative: JSON.stringify(spec) });
  const name = "AdBrain #333 recorder (unused)";
  const withInstagram = await createCreative("creative-with-instagram", { name, object_story_spec: JSON.stringify(spec.object_story_spec), asset_feed_spec: JSON.stringify(spec.asset_feed_spec) });
  await validate("ad-with-instagram", { name: "AdBrain #333 validate", adset_id: adSetId, status: "PAUSED", execution_options: VALIDATE, creative: JSON.stringify({ creative_id: withInstagram }) });
  const withoutInstagram = await createCreative("control-creative-without-instagram", { name, object_story_spec: JSON.stringify({ page_id: pageId }), asset_feed_spec: JSON.stringify(spec.asset_feed_spec) });
  await validate("control-ad-without-instagram", { name: "AdBrain #333 validate", adset_id: adSetId, status: "PAUSED", execution_options: VALIDATE, creative: JSON.stringify({ creative_id: withoutInstagram }) });
  writeFileSync(join(process.cwd(), "tests/core/fixtures/meta/story-validate.json"), `${JSON.stringify({ recordedAt: new Date().toISOString(), inputs: JSON.parse(redact(JSON.stringify(inputs))), tape }, null, 2)}\n`);
}

main().catch((error) => { console.error(error); process.exit(1); });
