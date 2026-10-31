/**
 * #773: records Meta's real responses to editing a launched ad set's audience, both paths, on TWO new
 * PAUSED test campaigns, then archives them. Never sets ACTIVE; nothing delivers or spends.
 *   - rebuild: an ad set with interests (Meta refuses an in-place targeting update, 100/1359202)
 *   - patch:   an ad set without interests
 *   - whatsapp: a click-to-WhatsApp ad set (Meta refuses any in-place targeting update there too, #912)
 *   - language: an ad set without interests, patched to English (All) + Hindi only (`locales`)
 *   - whatsapp-language: the same language change on a click-to-WhatsApp ad set (rebuilt)
 *   - area-exclusions: an ad set stripped of its exclusions (as built before #741), given its area's exclusions back
 *   - running (#765, CEO-approved on #765): the patch change on an ACTIVE ad set under a campaign that stays PAUSED
 *     (Meta reports the ad set CAMPAIGN_PAUSED, so nothing delivers), minimum budget, a one-day campaign cap and
 *     end time as second guards; the tree is DELETED afterwards and the GET proving it is printed.
 *   - switch (#765 b): the same guards on a click-to-WhatsApp tree: ad set A ACTIVE → PAUSED copy B (copy tape) →
 *     switch A → B (switch tape) → copy C of B → cancel C (cancel tape). One scrubber per run, so ids join up.
 *
 *   npx tsx --env-file=<path to .env.local> scripts/record-meta-edit-audience.ts <imageUrl> [rebuild|patch|whatsapp|language|whatsapp-language|area-exclusions|running|switch] [campaignId]
 * With a campaignId, the PAUSED test campaign already exists (e.g. launched by older code, #912) and is
 * edited and archived instead of launched.
 *
 * Uses META_SYSTEM_USER_TOKEN / META_AD_ACCOUNT_ID / META_PAGE_ID. Tokens are stripped and every Meta id, hash
 * and phone number is replaced with a stable fake by metaScrubber() (#1040); tests rebind the fake account and Page.
 */
import "./lib/meta-write-gate";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { metaClientFromEnv } from "./lib/meta-env";
import { metaScrubber } from "./lib/scrub-meta";

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

// Meta's smallest daily budget for this account's lead-form campaigns (2446307 otherwise).
const MIN_DAILY_RUPEES = 100;
const MIN_CAMPAIGN_CAP_RUPEES = 5_000;

// The business's real WhatsApp number never lands in a fixture.
const PLACEHOLDER_PHONE = "+910000000000";
let phone: string | null = null;

let shared: ReturnType<typeof metaScrubber> | null = null;
/** One scrubber per run: the account and the Page get the first fakes, and an id keeps its fake across tapes. */
function scrubber() {
  if (shared) return shared;
  shared = metaScrubber();
  for (const id of [process.env.META_AD_ACCOUNT_ID, process.env.META_PAGE_ID]) if (id) shared.fakeId(id.replace(/^act_/, ""));
  return shared;
}

function save(name: string) {
  let text = JSON.stringify(tape, null, 2);
  if (phone) text = text.split(phone).join(PLACEHOLDER_PHONE).split(phone.slice(1)).join(PLACEHOLDER_PHONE.slice(1));
  text = scrubber().scrub(text);
  writeFileSync(join(OUT, `${name}.json`), `${text}\n`);
  console.log(`${name}: ${tape.length} exchanges`);
  tape = [];
}

async function archive(campaignId: string, status: "ARCHIVED" | "DELETED" = "ARCHIVED") {
  const token = process.env.META_SYSTEM_USER_TOKEN!;
  await realFetch(`${GRAPH}${campaignId}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ status, access_token: token }),
  }).then(response => response.json());
  if (status === "DELETED") {
    const proof = await (await realFetch(`${GRAPH}${campaignId}?fields=id,name,status,effective_status&access_token=${token}`)).json();
    const children = await (await realFetch(`${GRAPH}${campaignId}/adsets?fields=id,status,effective_status&access_token=${token}`)).json();
    console.log(`GET after delete: ${JSON.stringify(scrub(proof))} adsets: ${JSON.stringify(scrub(children))}`);
  }
}

/** Untaped Graph read or write with the system token (guards and status flips around the recording). */
async function raw(path: string, form?: Record<string, string>) {
  const token = process.env.META_SYSTEM_USER_TOKEN!;
  const response = form
    ? await realFetch(`${GRAPH}${path}`, { method: "POST", body: new URLSearchParams({ ...form, access_token: token }) })
    : await realFetch(`${GRAPH}${path}${path.includes("?") ? "&" : "?"}access_token=${token}`);
  const body = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(`${form ? "POST" : "GET"} ${path.split("?")[0]}: ${JSON.stringify(scrub(body))}`);
  return body;
}

/** The campaign must still be PAUSED, so the ACTIVE ad set can't deliver. */
async function assertCampaignPaused(campaignId: string) {
  const campaign = await raw(`${campaignId}?fields=status,effective_status`);
  if (campaign.status !== "PAUSED" || campaign.effective_status !== "PAUSED") throw new Error(`Test campaign is not PAUSED: ${JSON.stringify(campaign)}`);
}

/** The ad set and ad ids of an existing PAUSED test campaign. */
async function existingCampaign(campaignId: string) {
  const token = process.env.META_SYSTEM_USER_TOKEN!;
  const read = async (edge: string) => (await (await realFetch(`${GRAPH}${campaignId}/${edge}?fields=id,status&access_token=${token}`)).json()) as { data?: Array<{ id: string; status: string }> };
  const [adSets, ads] = await Promise.all([read("adsets"), read("ads")]);
  if (!adSets.data?.length || !ads.data?.length || [...adSets.data, ...ads.data].some(item => item.status !== "PAUSED")) throw new Error("Use a PAUSED test campaign with an ad set and ads.");
  return { campaignId, adSetIds: adSets.data.map(item => item.id), adIds: ads.data.map(item => item.id) };
}

async function main() {
  const imageUrl = process.argv[2];
  if (!imageUrl) throw new Error("Pass a public creative image URL.");
  const meta = metaClientFromEnv();
  if (!meta) throw new Error("Meta env credentials are missing.");
  mkdirSync(OUT, { recursive: true });

  const forms = await meta.listLeadForms();
  if (!forms.length) throw new Error("No active lead form on the Page.");
  const before = await meta.resolveGeoTargeting(["Chandigarh"], { cityScope: "city_only" });
  const after = await meta.resolveGeoTargeting(["Mohali"], { cityScope: "city_only" });
  const audience = await meta.resolveAudienceInterests(["Solar energy"]);
  // A new area always comes with its #741 out-of-area exclusions, as the edit service sends it.
  const changes = { location: after.targeting, excludedLocation: (await meta.serviceAreaExclusionsFor(after.targeting)) ?? {}, age: { min: 30, max: 60 } };
  const numbers = await meta.whatsappNumbers();
  const whatsappNumber = numbers.page ?? numbers.business[0] ?? null;
  phone = whatsappNumber;
  tape = [];

  const created: string[] = [];
  try {
    const only = process.argv[3];
    for (const [path, interests] of [["rebuild", audience.interests], ["patch", []], ["whatsapp", []], ["language", []], ["whatsapp-language", []], ["area-exclusions", []], ["running", []], ["switch", []]] as const) {
      if (only ? only !== path : path === "running" || path === "switch") continue;
      const running = path === "running" || path === "switch";
      const whatsapp = path.startsWith("whatsapp") || path === "switch";
      if (whatsapp && !whatsappNumber) throw new Error("No WhatsApp number on the Page or the business.");
      const existing = process.argv[4];
      const launch = existing ? await existingCampaign(existing) : await meta.createLeadCampaign({
        name: path === "switch" ? "AdBrain test — #765 switch recording, do not run" : running ? "AdBrain test — #765 recording, do not run" : `AdBrain edit-audience fixture ${path} ${new Date().toISOString().slice(0, 16)} (PAUSED test)`,
        dailyBudgetRupees: running ? MIN_DAILY_RUPEES : 200, leadFormId: forms[0].id, link: "https://adbrain.vanshul.com",
        creatives: [{ imageUrl, headline: "Lower electricity bills", message: "Rooftop solar for Tricity homes.", cta: "Learn More" }],
        ageMin: 25, ageMax: 55, gender: "all", interests: [...interests], location: before.targeting,
        ...whatsapp ? { destination: "whatsapp" as const, whatsappNumber: whatsappNumber!, boundWhatsAppNumbers: [whatsappNumber!], link: `https://wa.me/${whatsappNumber!.slice(1)}` } : { destination: "instant_form" as const },
      });
      created.push(launch.campaignId);
      // Meta's campaign → ad sets edge can list nothing for a few seconds after a launch.
      if (!existing) await new Promise(resolve => setTimeout(resolve, 15_000));
      if (path === "area-exclusions") {
        // Not taped: make the tree look like one launched before #741, then wait out Meta's 30 s limit.
        const token = process.env.META_SYSTEM_USER_TOKEN!;
        const read = await (await realFetch(`${GRAPH}${launch.adSetIds[0]}?fields=targeting&access_token=${token}`)).json() as { targeting: Record<string, unknown> };
        const old = { ...read.targeting };
        delete old.excluded_geo_locations;
        const stripped = await (await realFetch(`${GRAPH}${launch.adSetIds[0]}`, { method: "POST", body: new URLSearchParams({ targeting: JSON.stringify(old), access_token: token }) })).json();
        if ((stripped as { success?: boolean }).success !== true) throw new Error(`Could not strip the exclusions: ${JSON.stringify(stripped)}`);
        await new Promise(resolve => setTimeout(resolve, 31_000));
      }
      if (running) {
        // Second guards (CEO, #765): a one-day end time (at most one day's minimum budget) and Meta's smallest
        // campaign spending limit (₹5,000; a one-day cap is refused). Then only the ad set goes ACTIVE.
        await assertCampaignPaused(launch.campaignId);
        await meta.enforceCampaignSpendCap(launch.campaignId, MIN_CAMPAIGN_CAP_RUPEES * 100);
        await raw(launch.adSetIds[0], { end_time: new Date(Date.now() + 86_400_000).toISOString() });
        // Meta allows one write per ad set per 30 s on some accounts (613).
        await new Promise(resolve => setTimeout(resolve, 31_000));
        await raw(launch.adSetIds[0], { status: "ACTIVE" });
        await assertCampaignPaused(launch.campaignId);
        console.log(`ad set before: ${JSON.stringify(await raw(`${launch.adSetIds[0]}?fields=status,effective_status,end_time`))}`);
        await new Promise(resolve => setTimeout(resolve, 31_000));
      }
      if (path === "switch") {
        await recordSwitch(meta, launch.campaignId, launch.adSetIds[0], launch.adIds, changes);
        continue;
      }
      tape = [];
      // As the edit service does: the area's exclusions come from the ad set's own current area.
      const areaChanges = path === "area-exclusions" ? { excludedLocation: (await meta.serviceAreaExclusionsFor(before.targeting))! } : null;
      const input = { adSetId: launch.adSetIds[0], adIds: launch.adIds, changes: areaChanges ?? (path.endsWith("language") ? { languages: [1001, 46] } : changes) };
      if (running) await assertCampaignPaused(launch.campaignId);
      const validated = await meta.editAdSetTargeting(launch.campaignId, input, { validateOnly: true });
      // Meta allows one targeting update per ad set per 30 s (#613), validate_only included.
      await new Promise(resolve => setTimeout(resolve, 31_000));
      const edited = await meta.editAdSetTargeting(launch.campaignId, input);
      save(`edit-audience-${path}`);
      if (running) {
        await assertCampaignPaused(launch.campaignId);
        console.log(`ad set after: ${JSON.stringify(await raw(`${launch.adSetIds[0]}?fields=status,effective_status`))}`);
        console.log(`campaign insights: ${JSON.stringify(await raw(`${launch.campaignId}/insights?fields=spend,impressions`))}`);
      }
      console.log(JSON.stringify({ path, campaignId: launch.campaignId, source: input.adSetId, validated, edited }));
    }
  } catch (error) {
    if (tape.length) save("edit-audience-failed");
    throw error;
  } finally {
    const remove = process.argv[3] === "running" || process.argv[3] === "switch" ? "DELETED" : "ARCHIVED";
    for (const campaignId of created) await archive(campaignId, remove).catch(error => console.error(`${remove} failed for ${campaignId}: ${error}`));
    tape = [];
    console.log(`${remove.toLowerCase()} ${created.length} test campaign(s)`);
  }
}

/** #765 (b): copy → switch → copy → cancel on a tree whose campaign stays PAUSED (asserted around every step). */
async function recordSwitch(meta: NonNullable<ReturnType<typeof metaClientFromEnv>>, campaignId: string, adSetId: string, adIds: string[], changes: Parameters<NonNullable<ReturnType<typeof metaClientFromEnv>>["editAdSetTargeting"]>[1]["changes"]) {
  tape = [];
  await assertCampaignPaused(campaignId);
  await meta.editAdSetTargeting(campaignId, { adSetId, adIds, changes }, { validateOnly: true, copyOnly: true });
  const copy = await meta.editAdSetTargeting(campaignId, { adSetId, adIds, changes }, { copyOnly: true });
  save("edit-audience-copy");
  console.log(`copy: ${JSON.stringify(copy)} source: ${JSON.stringify(await raw(`${adSetId}?fields=status,effective_status`))}`);
  await assertCampaignPaused(campaignId);
  await new Promise(resolve => setTimeout(resolve, 31_000));

  tape = [];
  const switched = await meta.switchAdSet(campaignId, { fromAdSetId: adSetId, toAdSetId: copy.adSetId, toAdIds: copy.adIds, running: true });
  save("edit-audience-switch");
  await assertCampaignPaused(campaignId);
  console.log(`switch: ${JSON.stringify(switched)} old: ${JSON.stringify(await raw(`${adSetId}?fields=status,effective_status`))} new: ${JSON.stringify(await raw(`${copy.adSetId}?fields=status,effective_status`))}`);
  await new Promise(resolve => setTimeout(resolve, 31_000));

  tape = [];
  const second = await meta.editAdSetTargeting(campaignId, { adSetId: copy.adSetId, adIds: copy.adIds, changes: { age: { min: 35, max: 60 } } }, { copyOnly: true });
  await meta.deleteAdSetCopy(campaignId, second.adSetId);
  const gone = await realFetch(`${GRAPH}${second.adSetId}?fields=id,status&access_token=${process.env.META_SYSTEM_USER_TOKEN}`).then(response => response.json());
  save("edit-audience-cancel");
  await assertCampaignPaused(campaignId);
  console.log(`cancel: GET deleted copy → ${JSON.stringify(scrub(gone))}; running ad set: ${JSON.stringify(await raw(`${copy.adSetId}?fields=status,effective_status`))}`);
  console.log(`campaign insights: ${JSON.stringify(await raw(`${campaignId}/insights?fields=spend,impressions`))}`);
}

main().catch((error) => {
  if (tape.length) save("edit-audience-failed");
  console.error(error instanceof Error ? error.message : "Recording failed.");
  process.exitCode = 1;
});
