/**
 * #913 follow-up (QA): records Meta's answer to rebuilding a WhatsApp ad set launched BEFORE #913, so the
 * merged path is proven: an old ad set (automatic placements, no publisher_platforms) whose ad's 9:16
 * placement creative still names audience_network in its feed rule, rebuilt by today's code into a new
 * ad set that leaves Audience Network out, with the old ad copied onto it.
 * ONE new PAUSED WhatsApp test campaign; the old-style ad set, creative and ad are made directly on it.
 * Never sets ACTIVE; nothing delivers or spends. Archived after.
 *
 *   npx tsx --env-file=<path to .env.local> scripts/record-meta-edit-whatsapp-legacy.ts <imageUrl>
 *
 * Uses META_SYSTEM_USER_TOKEN / META_AD_ACCOUNT_ID / META_PAGE_ID. Tokens and the WhatsApp number are scrubbed.
 */
import "./lib/meta-write-gate";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { metaClientFromEnv } from "./lib/meta-env";

type Exchange = { method: string; path: string; form?: Record<string, string>; status: number; body: unknown };

const GRAPH = "https://graph.facebook.com/v26.0/";
const OUT = join(process.cwd(), "tests/core/fixtures/meta");
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
  const response = await realFetch(input, init);
  const body = await response.clone().json().catch(() => null);
  const parsed = new URL(url);
  parsed.searchParams.delete("access_token");
  let form: Record<string, string> | undefined;
  if (init?.body instanceof URLSearchParams) {
    form = Object.fromEntries([...init.body].filter(([key]) => key !== "access_token")
      .map(([key, value]) => [key, key === "bytes" ? "<image bytes>" : value]));
  }
  tape.push({
    method: init?.method ?? "GET",
    path: parsed.pathname.replace("/v26.0/", "") + parsed.search,
    ...(form ? { form } : {}),
    status: response.status,
    body: scrub(body),
  });
  return response;
};

// The business's real WhatsApp number never lands in a fixture.
const PLACEHOLDER_PHONE = "+910000000000";
let phone: string | null = null;

function save(name: string) {
  let text = JSON.stringify(tape, null, 2);
  if (phone) text = text.split(phone).join(PLACEHOLDER_PHONE).split(phone.slice(1)).join(PLACEHOLDER_PHONE.slice(1));
  writeFileSync(join(OUT, `${name}.json`), `${text}\n`);
  console.log(`${name}: ${tape.length} exchanges`);
  tape = [];
}

async function archive(campaignId: string) {
  const token = process.env.META_SYSTEM_USER_TOKEN!;
  await fetch(`${GRAPH}${campaignId}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ status: "ARCHIVED", access_token: token }),
  }).then(response => response.json());
}

// Meta allows one targeting update per ad set per 30 s (#613), validate_only included.
const pause = () => new Promise(resolve => setTimeout(resolve, 31_000));
const token = () => process.env.META_SYSTEM_USER_TOKEN!;
const account = () => `act_${process.env.META_AD_ACCOUNT_ID!.replace(/^act_/, "")}`;
async function raw<T>(path: string, form?: Record<string, string>): Promise<T> {
  const response = form
    ? await realFetch(`${GRAPH}${path}`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ ...form, access_token: token() }) })
    : await realFetch(`${GRAPH}${path}${path.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(token())}`);
  const body = await response.json() as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(`${path}: ${JSON.stringify(body.error ?? body).slice(0, 400)}`);
  return body;
}

async function main() {
  const imageUrl = process.argv[2];
  if (!imageUrl) throw new Error("Pass a public creative image URL.");
  const meta = metaClientFromEnv();
  if (!meta) throw new Error("Meta env credentials are missing.");
  mkdirSync(OUT, { recursive: true });
  const numbers = await meta.whatsappNumbers();
  phone = numbers.page ?? numbers.business[0] ?? null;
  if (!phone) throw new Error("No WhatsApp number on the Page or the business.");
  const area = await meta.resolveGeoTargeting(["Chandigarh"], { cityScope: "city_only" });
  const storyImage = new Uint8Array(await sharp({ create: { width: 1080, height: 1920, channels: 3, background: "#0f766e" } }).png().toBuffer());
  let campaignId: string | null = null;
  try {
    const launch = await meta.createLeadCampaign({
      name: `AdBrain WhatsApp legacy rebuild fixture ${new Date().toISOString().slice(0, 16)} (PAUSED test)`,
      dailyBudgetRupees: 200, destination: "whatsapp", whatsappNumber: phone, boundWhatsAppNumbers: [phone], link: `https://wa.me/${phone.slice(1)}`,
      creatives: [{ imageUrl, storyImage, headline: "Lower electricity bills", message: "Rooftop solar for Tricity homes.", cta: "Send WhatsApp message" }],
      ageMin: 25, ageMax: 55, gender: "all", interests: [], location: area.targeting,
    });
    campaignId = launch.campaignId;
    console.log(JSON.stringify({ campaignId, adSetIds: launch.adSetIds, adIds: launch.adIds }));

    // The creative as #333 built it before #913: the feed rule also names Audience Network.
    const ad = await raw<{ creative: { id: string } }>(`${launch.adIds[0]}?fields=creative{id}`);
    const creative = await raw<{ name?: string; object_story_spec: unknown; asset_feed_spec?: { asset_customization_rules: Array<{ customization_spec: Record<string, unknown>; image_label: { name: string } }> } }>(
      `${ad.creative.id}?fields=name,object_story_spec,asset_feed_spec`);
    if (!creative.asset_feed_spec) throw new Error("The launch fell back to a single image; no placement creative to age.");
    for (const rule of creative.asset_feed_spec.asset_customization_rules) {
      if (rule.image_label.name !== "adbrain_feed") continue;
      rule.customization_spec.publisher_platforms = [...(rule.customization_spec.publisher_platforms as string[]), "audience_network"];
      rule.customization_spec.audience_network_positions = ["classic", "instream_video", "rewarded_video"];
    }
    const legacyCreative = await raw<{ id: string }>(`${account()}/adcreatives`, {
      name: `${creative.name ?? "AdBrain creative"} (pre-#913)`, object_story_spec: JSON.stringify(creative.object_story_spec), asset_feed_spec: JSON.stringify(creative.asset_feed_spec),
    });

    // The ad set as launched before #913: automatic placements (no publisher_platforms).
    const source = await raw<{ billing_event: string; optimization_goal: string; bid_strategy?: string; destination_type: string; promoted_object: unknown; targeting: Record<string, unknown>; daily_budget: string }>(
      `${launch.adSetIds[0]}?fields=billing_event,optimization_goal,bid_strategy,destination_type,promoted_object,targeting,daily_budget`);
    const { publisher_platforms: _platforms, ...automatic } = source.targeting;
    void _platforms;
    const legacyAdSet = await raw<{ id: string }>(`${account()}/adsets`, {
      name: "AdBrain pre-#913 ad set (PAUSED test)", campaign_id: campaignId, status: "PAUSED", daily_budget: source.daily_budget,
      billing_event: source.billing_event, optimization_goal: source.optimization_goal, bid_strategy: source.bid_strategy ?? "LOWEST_COST_WITHOUT_CAP",
      destination_type: source.destination_type, promoted_object: JSON.stringify(source.promoted_object), targeting: JSON.stringify(automatic),
    });
    const legacyAd = await raw<{ id: string }>(`${account()}/ads`, {
      name: "AdBrain pre-#913 ad (PAUSED test)", adset_id: legacyAdSet.id, status: "PAUSED", creative: JSON.stringify({ creative_id: legacyCreative.id }),
    });
    console.log(JSON.stringify({ legacyCreative: legacyCreative.id, legacyAdSet: legacyAdSet.id, legacyAd: legacyAd.id }));

    tape = [];
    const input = { adSetId: legacyAdSet.id, adIds: [legacyAd.id], changes: { age: { min: 30, max: 60 } } };
    const validated = await meta.editAdSetTargeting(campaignId, input, { validateOnly: true });
    await pause();
    const edited = await meta.editAdSetTargeting(campaignId, input);
    save("edit-audience-whatsapp-legacy");
    const rebuilt = await raw<{ targeting: { publisher_platforms?: string[] } }>(`${edited.adSetId}?fields=targeting`);
    console.log(JSON.stringify({ validated, edited, rebuiltPlatforms: rebuilt.targeting.publisher_platforms }));
  } catch (error) {
    if (tape.length) save("edit-audience-whatsapp-legacy-failed");
    throw error;
  } finally {
    tape = [];
    if (campaignId) {
      await archive(campaignId).catch(() => undefined);
      console.log(`archive ${campaignId}: ${JSON.stringify(await raw(`${campaignId}?fields=status`).catch(error => String(error)))}`);
    }
  }
}

main().catch((error) => {
  if (tape.length) save("edit-audience-whatsapp-legacy-failed");
  console.error(error instanceof Error ? error.message : "Recording failed.");
  process.exitCode = 1;
});
