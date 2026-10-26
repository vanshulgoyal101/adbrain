/**
 * #773: records Meta's real responses to editing a launched ad set's audience, both paths, on TWO new
 * PAUSED test campaigns, then archives them. Never sets ACTIVE; nothing delivers or spends.
 *   - rebuild: an ad set with interests (Meta refuses an in-place targeting update, 100/1359202)
 *   - patch:   an ad set without interests
 *
 *   npx tsx --env-file=<path to .env.local> scripts/record-meta-edit-audience.ts <imageUrl>
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

function save(name: string) {
  writeFileSync(join(OUT, `${name}.json`), `${JSON.stringify(tape, null, 2)}\n`);
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
  const changes = { location: after.targeting, age: { min: 30, max: 60 } };
  tape = [];

  const created: string[] = [];
  try {
    const only = process.argv[3];
    for (const [path, interests] of [["rebuild", audience.interests], ["patch", []]] as const) {
      if (only && only !== path) continue;
      const launch = await meta.createLeadCampaign({
        name: `AdBrain edit-audience fixture ${path} ${new Date().toISOString().slice(0, 16)} (PAUSED test)`,
        dailyBudgetRupees: 200, leadFormId: forms[0].id, link: "https://adbrain.vanshul.com",
        creatives: [{ imageUrl, headline: "Lower electricity bills", message: "Rooftop solar for Tricity homes.", cta: "Learn More" }],
        ageMin: 25, ageMax: 55, gender: "all", interests: [...interests], location: before.targeting, destination: "instant_form",
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
