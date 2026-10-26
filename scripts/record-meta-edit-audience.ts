/**
 * #773: records Meta's real responses to editing a launched ad set's audience, both paths, on TWO new
 * PAUSED test campaigns, then archives them. Never sets ACTIVE; nothing delivers or spends.
 *   - rebuild: an ad set with interests (Meta refuses an in-place targeting update, 100/1359202)
 *   - patch:   an ad set without interests
 *   - whatsapp: a click-to-WhatsApp ad set (Meta refuses any in-place targeting update there too, #912)
 *
 *   npx tsx --env-file=<path to .env.local> scripts/record-meta-edit-audience.ts <imageUrl> [rebuild|patch|whatsapp] [campaignId]
 * With a campaignId, the PAUSED test campaign already exists (e.g. launched by older code, #912) and is
 * edited and archived instead of launched.
 *
 * Uses META_SYSTEM_USER_TOKEN / META_AD_ACCOUNT_ID / META_PAGE_ID. Tokens are stripped from the fixtures.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { metaClientFromEnv } from "./lib/meta-env";

type Exchange = { method: string; path: string; form?: Record<string, string>; status: number; body: unknown };

const GRAPH = "https://graph.facebook.com/v21.0/";
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
    path: parsed.pathname.replace("/v21.0/", "") + parsed.search,
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
    for (const [path, interests] of [["rebuild", audience.interests], ["patch", []], ["whatsapp", []]] as const) {
      if (only && only !== path) continue;
      const whatsapp = path === "whatsapp";
      if (whatsapp && !whatsappNumber) throw new Error("No WhatsApp number on the Page or the business.");
      const existing = process.argv[4];
      const launch = existing ? await existingCampaign(existing) : await meta.createLeadCampaign({
        name: `AdBrain edit-audience fixture ${path} ${new Date().toISOString().slice(0, 16)} (PAUSED test)`,
        dailyBudgetRupees: 200, leadFormId: forms[0].id, link: "https://adbrain.vanshul.com",
        creatives: [{ imageUrl, headline: "Lower electricity bills", message: "Rooftop solar for Tricity homes.", cta: "Learn More" }],
        ageMin: 25, ageMax: 55, gender: "all", interests: [...interests], location: before.targeting,
        ...whatsapp ? { destination: "whatsapp" as const, whatsappNumber: whatsappNumber!, boundWhatsAppNumbers: [whatsappNumber!], link: `https://wa.me/${whatsappNumber!.slice(1)}` } : { destination: "instant_form" as const },
      });
      created.push(launch.campaignId);
      tape = [];
      const input = { adSetId: launch.adSetIds[0], adIds: launch.adIds, changes };
      const validated = await meta.editAdSetTargeting(launch.campaignId, input, { validateOnly: true });
      // Meta allows one targeting update per ad set per 30 s (#613), validate_only included.
      await new Promise(resolve => setTimeout(resolve, 31_000));
      const edited = await meta.editAdSetTargeting(launch.campaignId, input);
      save(`edit-audience-${path}`);
      console.log(JSON.stringify({ path, campaignId: launch.campaignId, source: input.adSetId, validated, edited }));
    }
  } catch (error) {
    if (tape.length) save("edit-audience-failed");
    throw error;
  } finally {
    for (const campaignId of created) await archive(campaignId).catch(() => undefined);
    tape = [];
    console.log(`archived ${created.length} test campaign(s)`);
  }
}

main().catch((error) => {
  if (tape.length) save("edit-audience-failed");
  console.error(error instanceof Error ? error.message : "Recording failed.");
  process.exitCode = 1;
});
