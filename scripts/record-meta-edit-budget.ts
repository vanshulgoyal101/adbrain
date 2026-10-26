/**
 * #774: records Meta's real responses to editing a launched ad set's budget on ONE new PAUSED test
 * campaign, then archives it. Never sets ACTIVE; nothing delivers or spends (CTO approval on #765).
 *   - daily:   raise ₹200 → ₹250 (validate_only, then for real), lower to ₹150
 *   - capped:  a capped run (₹600 lifetime, 3 days); raise to ₹900 and run 2 days longer, then lower to ₹700
 *   - refused: Meta's answer to a daily budget below its minimum (validate_only)
 * Meta allows one budget update per ad set per 30 s (#613, recorded once as edit-budget-rate-limited).
 *
 *   npx tsx --env-file=<path to .env.local> scripts/record-meta-edit-budget.ts <imageUrl>
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
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, key === "access_token" ? "REDACTED" : scrub(item)]));
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
    form = Object.fromEntries([...init.body].filter(([key]) => key !== "access_token").map(([key, value]) => [key, key === "bytes" ? "<image bytes>" : value]));
  }
  tape.push({ method: init?.method ?? "GET", path: parsed.pathname.replace("/v21.0/", "") + parsed.search, ...(form ? { form } : {}), status: response.status, body: scrub(body) });
  return response;
};

function save(name: string) {
  writeFileSync(join(OUT, `${name}.json`), `${JSON.stringify(tape, null, 2)}\n`);
  console.log(`${name}: ${tape.length} exchanges`);
  tape = [];
}

async function archive(campaignId: string) {
  const token = process.env.META_SYSTEM_USER_TOKEN!;
  const response = await realFetch(`${GRAPH}${campaignId}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ status: "ARCHIVED", access_token: token }),
  });
  const confirmed = await realFetch(`${GRAPH}${campaignId}?fields=status&access_token=${encodeURIComponent(token)}`).then(item => item.json()) as { status?: string };
  console.log(`archive ${campaignId}: ${response.status} → ${confirmed.status}`);
}

// Meta allows one budget update per ad set per 30 s (#613), validate_only included.
const pause = () => new Promise(resolve => setTimeout(resolve, 31_000));

async function main() {
  const imageUrl = process.argv[2];
  if (!imageUrl) throw new Error("Pass a public creative image URL.");
  const meta = metaClientFromEnv();
  if (!meta) throw new Error("Meta env credentials are missing.");
  mkdirSync(OUT, { recursive: true });

  const forms = await meta.listLeadForms();
  if (!forms.length) throw new Error("No active lead form on the Page.");
  const area = await meta.resolveGeoTargeting(["Chandigarh"], { cityScope: "city_only" });
  let campaignId: string | null = null;
  try {
    const launch = await meta.createLeadCampaign({
      name: `AdBrain edit-budget fixture ${new Date().toISOString().slice(0, 16)} (PAUSED test)`,
      dailyBudgetRupees: 200, leadFormId: forms[0].id, link: "https://adbrain.vanshul.com",
      creatives: [{ imageUrl, headline: "Lower electricity bills", message: "Rooftop solar for Tricity homes.", cta: "Learn More" }],
      ageMin: 25, ageMax: 55, gender: "all", interests: [], location: area.targeting, destination: "instant_form",
    });
    campaignId = launch.campaignId;
    const adSetId = launch.adSetIds[0];
    console.log(JSON.stringify({ campaignId, adSetId, adIds: launch.adIds }));

    tape = [];
    await meta.editAdSetBudget(campaignId, adSetId, { dailyBudgetPaise: 25_000 }, { validateOnly: true });
    await pause();
    const raised = await meta.editAdSetBudget(campaignId, adSetId, { dailyBudgetPaise: 25_000 });
    await pause();
    const lowered = await meta.editAdSetBudget(campaignId, adSetId, { dailyBudgetPaise: 15_000 });
    save("edit-budget-daily");
    console.log(JSON.stringify({ raised, lowered }));

    tape = [];
    await pause();
    await meta.editAdSetBudget(campaignId, adSetId, { dailyBudgetPaise: 100 }, { validateOnly: true }).then(
      () => console.log("refused: Meta accepted ₹1 a day"),
      error => console.log(`refused: ${error instanceof Error ? error.message : error}`),
    );
    save("edit-budget-refused");

    const capped = await meta.createCappedAdSet(campaignId, {
      sourceAdSetId: adSetId, sourceAdIds: launch.adIds, lifetimeBudgetPaise: 60_000, endTime: new Date(Date.now() + 3 * 86_400_000),
    });
    console.log(JSON.stringify({ capped }));
    tape = [];
    const longer = new Date(Date.parse(capped.endTime) + 2 * 86_400_000).toISOString();
    await meta.editAdSetBudget(campaignId, capped.adSetId, { lifetimeBudgetPaise: 90_000, endTime: longer }, { validateOnly: true });
    await pause();
    const capRaised = await meta.editAdSetBudget(campaignId, capped.adSetId, { lifetimeBudgetPaise: 90_000, endTime: longer });
    await pause();
    const capLowered = await meta.editAdSetBudget(campaignId, capped.adSetId, { lifetimeBudgetPaise: 70_000 });
    save("edit-budget-capped");
    console.log(JSON.stringify({ capRaised, capLowered }));
  } catch (error) {
    if (tape.length) save("edit-budget-failed");
    throw error;
  } finally {
    tape = [];
    if (campaignId) await archive(campaignId).catch(error => console.error(`archive failed for ${campaignId}: ${error}`));
  }
}

main().catch((error) => {
  if (tape.length) save("edit-budget-failed");
  console.error(error instanceof Error ? error.message : "Recording failed.");
  process.exitCode = 1;
});
