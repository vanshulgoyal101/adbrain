/**
 * #2824 (#2595 phase 3, app installs): records Meta's real answers for the app-install contract, for test:core
 * (tests/core/app-promotion.test.ts): the ad account's registered apps (`advertisable_applications`, a GET) and
 * `validate_only` checks of an OUTCOME_APP_PROMOTION campaign and ad set with `promoted_object { application_id,
 * object_store_url }`. Nothing is created: every POST must carry `validate_only`, and the ad set is validated
 * against an existing paused campaign of the account, so nothing can deliver or spend.
 *
 *   ADBRAIN_ALLOW_META_WRITES=1 npx tsx --env-file=<.env.local> scripts/record-meta-app-promotion.ts
 */
import "./lib/meta-write-gate";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { metaScrubber } from "./lib/scrub-meta";

const GRAPH = "https://graph.facebook.com/v26.0/";
const token = process.env.META_SYSTEM_USER_TOKEN!;
const account = `act_${process.env.META_AD_ACCOUNT_ID!.replace(/^act_/, "")}`;
const pageId = process.env.META_PAGE_ID!;
const VALIDATE = JSON.stringify(["validate_only"]);
// A store page the registered app does not own: Meta must refuse it, and the rule must say so before any call.
const FOREIGN_STORE_URL = "https://play.google.com/store/apps/details?id=com.example.notregistered";

type Exchange = { name: string; method: "GET" | "POST"; path: string; form: Record<string, string> | null; status: number; body: unknown };
const tape: Exchange[] = [];

async function get(name: string, path: string) {
  const res = await fetch(`${GRAPH}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const body = await res.json();
  tape.push({ name, method: "GET", path, form: null, status: res.status, body });
  console.log(name, res.status, JSON.stringify(body).slice(0, 300));
  return { status: res.status, body: body as Record<string, unknown> };
}

async function validate(name: string, path: string, form: Record<string, string>) {
  const res = await fetch(`${GRAPH}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...form, execution_options: VALIDATE, access_token: token }),
  });
  const body = await res.json();
  tape.push({ name, method: "POST", path, form: { ...form, execution_options: VALIDATE }, status: res.status, body });
  console.log(name, res.status, JSON.stringify(body).slice(0, 400));
}

async function main() {
  const apps = await get("apps", `${account}/advertisable_applications?fields=id,name,object_store_urls&limit=25`);
  const app = (apps.body.data as { id: string; object_store_urls?: Record<string, string> }[] | undefined)?.[0];
  if (!app) {
    console.log("No registered app on this account: recorded the empty read. Label waiting-owner for a test app.");
  } else {
    const parents = await get("parents", `${account}/campaigns?fields=id,objective,effective_status&effective_status=%5B%22PAUSED%22%5D&limit=1`);
    const parent = (parents.body.data as { id: string }[] | undefined)?.[0];
    tape.pop();
    await validate("campaign", `${account}/campaigns`, {
      name: "AdBrain app install check (validate only)", objective: "OUTCOME_APP_PROMOTION", status: "PAUSED",
      special_ad_categories: "[]", is_adset_budget_sharing_enabled: "false",
    });
    if (parent) {
      const adSet = (storeUrl: string) => ({
        name: "AdBrain app install check (validate only)", campaign_id: parent.id, status: "PAUSED", daily_budget: "10000",
        billing_event: "IMPRESSIONS", optimization_goal: "APP_INSTALLS", bid_strategy: "LOWEST_COST_WITHOUT_CAP",
        destination_type: "APP", promoted_object: JSON.stringify({ application_id: app.id, object_store_url: storeUrl }),
        targeting: JSON.stringify({ geo_locations: { countries: ["IN"] }, age_min: 18, age_max: 65 }),
      });
      await validate("adset-foreign-store", `${account}/adsets`, adSet(FOREIGN_STORE_URL));
      await validate("adset-own-store", `${account}/adsets`, adSet(Object.values(app.object_store_urls ?? {})[0] ?? FOREIGN_STORE_URL));
    }
  }

  const scrubber = metaScrubber();
  const recorded = {
    note: "#2824: read-only reads and validate_only checks from the test ad account; nothing was created. `apps` is the real advertisable_applications answer; the ad set checks run against an existing paused campaign, so Meta may also object to its objective.",
    recordedAt: new Date().toISOString(),
    creds: { adAccountId: account, pageId },
    foreignStoreUrl: FOREIGN_STORE_URL,
    tape,
  };
  writeFileSync(join(process.cwd(), "tests/core/fixtures/meta/app-promotion.json"), `${JSON.stringify(JSON.parse(scrubber.scrub(JSON.stringify(recorded))), null, 2)}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
