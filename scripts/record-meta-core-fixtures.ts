/**
 * Records real Graph responses for the test:core campaign fixtures from ONE
 * PAUSED test campaign, then pauses and archives it. Never sets ACTIVE.
 *
 *   npx tsx --env-file=.env.local scripts/record-meta-core-fixtures.ts <imageUrl>
 *
 * Uses META_SYSTEM_USER_TOKEN / META_AD_ACCOUNT_ID / META_PAGE_ID. Tokens are
 * stripped from the fixtures; image bytes are replaced with a placeholder.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { metaClientFromEnv } from "@/lib/meta/client";

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

async function main() {
  const imageUrl = process.argv[2];
  if (!imageUrl) throw new Error("Pass a public creative image URL.");
  const meta = metaClientFromEnv();
  if (!meta) throw new Error("Meta env credentials are missing.");
  mkdirSync(OUT, { recursive: true });

  const forms = await meta.listLeadForms();
  const geo = await meta.resolveGeoTargeting(["Austin, Texas"], { cityScope: "city_only" });
  const audience = await meta.resolveAudienceInterests(["Chiropractic"]);
  save("prepare");
  if (!forms.length) throw new Error("No active lead form on the Page.");

  const name = `AdBrain core fixture ${new Date().toISOString().slice(0, 16)} (PAUSED test)`;
  const created = await meta.createLeadCampaign({
    name, dailyBudgetRupees: 200, leadFormId: forms[0].id, link: "https://adbrain.vanshul.com",
    creatives: [{
      imageUrl,
      headline: "Diwali Renewal, Starting With Your Spine",
      message: "A $49 new-patient exam with a digital posture scan. Same-day and Saturday appointments.",
      cta: "Book Now",
    }],
    ageMin: 25, ageMax: 55, gender: "all", interests: audience.interests,
    location: geo.targeting, destination: "instant_form",
  });
  save("create");
  console.log(JSON.stringify(created));

  const expected = { dailyBudgetRupees: 200, status: "paused", adSetIds: created.adSetIds, adIds: created.adIds };
  await meta.readCampaignDelivery(created.campaignId, expected);
  save("delivery");

  const page = await meta.listCampaignsPage();
  const listed = page.campaigns.find(campaign => campaign.id === created.campaignId);
  if (!listed) throw new Error("Created campaign missing from the first sync page.");
  console.log(JSON.stringify(await meta.readBoundCampaign(listed)));
  save("sync");

  await meta.updateCampaignStatus(created.campaignId, "PAUSED");
  save("pause");

  const token = process.env.META_SYSTEM_USER_TOKEN!;
  const archived = await fetch(`${GRAPH}${created.campaignId}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ status: "ARCHIVED", access_token: token }),
  }).then(response => response.json());
  const after = await fetch(`${GRAPH}${created.campaignId}?fields=id,status,effective_status&access_token=${encodeURIComponent(token)}`)
    .then(response => response.json());
  save("archive");
  console.log(JSON.stringify({ archived, after }));
}

main().catch((error) => {
  if (tape.length) save("failed");
  console.error(error instanceof Error ? error.message : "Recording failed.");
  process.exitCode = 1;
});
