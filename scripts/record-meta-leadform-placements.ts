/**
 * #680 lever 2: asks Meta to validate (never create) an instant-form lead ad set without Audience
 * Network and a lead ad whose creative carries the 4:5 feed and 9:16 Stories/Reels images, so the
 * lead-form arm differs from the WhatsApp arm only in its destination. Records the answers for
 * test:core. Any POST without execution_options=["validate_only"] and status PAUSED is refused here.
 * Controls: Audience Network alone (Meta must read publisher_platforms) and a placement creative with
 * no form id (Meta must read the form).
 *
 *   npx tsx --env-file=<.env.local> scripts/record-meta-leadform-placements.ts <leadCampaignId> <leadAdSetId> <targetingSourceAdSetId> <formId> <feedHash> <storyHash>
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { placementCreativeSpec, withoutAudienceNetwork } from "@/lib/meta/client";

const GRAPH = "https://graph.facebook.com/v21.0/";
const VALIDATE = JSON.stringify(["validate_only"]);
const [campaignId, adSetId, sourceAdSetId, formId, feedHash, storyHash] = process.argv.slice(2);
if (!storyHash) throw new Error("Pass the lead campaign, lead ad set, targeting source ad set, form id, feed and story hashes.");
const token = process.env.META_SYSTEM_USER_TOKEN!;
const account = `act_${process.env.META_AD_ACCOUNT_ID!.replace(/^act_/, "")}`;
const pageId = process.env.META_PAGE_ID!;

// The live English run's ad copy (public).
const ad = {
  headline: "Free Solar Site Survey in Tricity",
  message: "Rooftop solar for your home in Chandigarh, Mohali & Panchkula. FREE site survey and PM Surya Ghar subsidy help from our local Mohali team.",
  description: "Solaride checks your roof before any work starts.",
};

type Exchange = { name: string; path: string; form: Record<string, string>; status: number; body: unknown };
const tape: Exchange[] = [];

async function get<T>(path: string): Promise<T> {
  const response = await fetch(`${GRAPH}${path}${path.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(token)}`);
  const body = await response.json();
  if (body.error) throw new Error(JSON.stringify(body.error));
  return body as T;
}

async function validate(name: string, edge: "adsets" | "ads", form: Record<string, string>) {
  if (form.execution_options !== VALIDATE || form.status !== "PAUSED") throw new Error("Recorder refuses anything but a PAUSED validate_only request.");
  const path = `${account}/${edge}`;
  const response = await fetch(`${GRAPH}${path}`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ ...form, locale: "en_US", access_token: token }) });
  const body = await response.json();
  tape.push({ name, path, form, status: response.status, body });
  console.log(name, response.status, JSON.stringify(body).slice(0, 500));
}

async function main() {
  const pageToken = (await get<{ access_token: string }>(`${pageId}?fields=access_token`)).access_token;
  const page = await (await fetch(`${GRAPH}${pageId}?fields=instagram_business_account,page_backed_instagram_accounts&access_token=${pageToken}`)).json();
  const instagramUserId: string = page.instagram_business_account?.id ?? page.page_backed_instagram_accounts.data[0].id;
  const source = await get<{ targeting: Record<string, unknown> }>(`${sourceAdSetId}?fields=targeting`);
  const targeting = withoutAudienceNetwork(source.targeting);
  // The lead campaign carries the budget (CBO), so the ad set sends none; placements are what is checked.
  const adSet = (t: Record<string, unknown>) => ({
    name: "AdBrain #680 validate", campaign_id: campaignId, status: "PAUSED",
    billing_event: "IMPRESSIONS", optimization_goal: "LEAD_GENERATION", destination_type: "ON_AD",
    promoted_object: JSON.stringify({ page_id: pageId }), targeting: JSON.stringify(t), execution_options: VALIDATE,
  });
  await validate("control-adset-audience-network-only", "adsets", adSet({ ...targeting, publisher_platforms: ["audience_network"] }));
  await validate("adset-leadform-without-audience-network", "adsets", adSet(targeting));

  const inputs = { pageId, instagramUserId, feedHash, storyHash, headline: ad.headline, message: ad.message, description: ad.description, link: "https://solaride.in", destination: "instant_form" as const, leadFormId: formId };
  const spec = placementCreativeSpec(inputs);
  const noForm = placementCreativeSpec({ ...inputs, leadFormId: undefined });
  const adForm = (creative: unknown) => ({ name: "AdBrain #680 validate", adset_id: adSetId, status: "PAUSED", execution_options: VALIDATE, creative: JSON.stringify(creative) });
  await validate("control-story-leadform-without-form", "ads", adForm(noForm));
  await validate("story-leadform", "ads", adForm(spec));
  writeFileSync(join(process.cwd(), "tests/core/fixtures/meta/leadform-placements-validate.json"), `${JSON.stringify({ recordedAt: new Date().toISOString(), inputs: { ...inputs, targetingSource: "live English run ad set (Tricity, #741 exclusions)" }, tape }, null, 2)}\n`);
}

main().catch((error) => { console.error(error); process.exit(1); });
