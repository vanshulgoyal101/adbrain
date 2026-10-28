import { afterEach, describe, expect, it, vi } from "vitest";
import { MetaClient } from "@/lib/meta/client";
import { resolveDraftTargeting } from "@/lib/campaign/draft-targeting";
import { draftInputSchema, type DraftInput } from "@/lib/campaign/connect-contracts";
import { runPreflight } from "@/lib/campaign/preflight";
import smoke from "./fixtures/smoke-business.json";
import geoTape from "./fixtures/meta/geo-smoke.json";

// #1809 (#1745): the production smoke's saved business data must pass the same checks Prepare runs. A rule that
// tightens what an input may mean (#1575: no bare namesake abroad) turned the production guard red because only the
// smoke's data broke it. Here that fails the PR instead: change the smoke's data (snapshot + production row) together.
// geo-smoke.json: Meta's recorded place search for these names (scripts/record-meta-geo-smoke.ts).
type Exchange = { method: string; path: string; status: number; body: unknown };
const tape = (geoTape as { tape: Exchange[] }).tape;

function replay() {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = new URL(String(input));
    for (const secret of ["access_token", "appsecret_proof"]) url.searchParams.delete(secret);
    const exchange = tape.find((entry) => entry.path === url.pathname.replace(/^\/v\d+\.\d+\//, "") + url.search);
    if (!exchange) throw new Error(`Unrecorded Graph call: ${url.pathname}${url.search}; re-run scripts/record-meta-geo-smoke.ts`);
    return Response.json(exchange.body, { status: exchange.status });
  });
}
afterEach(() => vi.restoreAllMocks());

const businessId = "ea6ea561-0000-4000-8000-000000000809";
const creativeId = "e3d165a9-bbf8-47f7-8c61-e69dbb8e0809";
// The smoke's Prepare (scripts/smoke-core.mjs): one approved ad, ₹350 a day, the lead-form path, areas from Brand.
const draft: DraftInput = {
  businessId, name: "QA preflight smoke", goal: "Smoke", mode: "manual", creativeIds: [creativeId],
  dailyBudgetRupees: smoke.dailyBudgetRupees, leadFormId: "1234567890", destination: smoke.destination as DraftInput["destination"], abTest: false,
  targeting: { location: { mode: "ai", cityScope: "radius", radiusKm: 25 }, age: { mode: "manual", min: 30, max: 60 }, audience: { interestNames: [], rationale: "Smoke." } },
};
// Prepare's data-dependent refusals: the ones a change to rules or to the smoke's saved data can trigger.
const DATA_BLOCKERS = ["REVIEW_AREAS_UNRESOLVED", "REVIEW_BUDGET", "REVIEW_RADIUS", "REVIEW_CITY_RADIUS"];

async function prepare(locations: string[]) {
  replay();
  const meta = new MetaClient({ adAccountId: "act_ACCOUNT", pageId: "PAGE", accessToken: "t" });
  const geo = await resolveDraftTargeting(draft, locations, meta.resolveGeoTargeting.bind(meta), smoke.country);
  const review = runPreflight({
    draft, draftId: "90d1d2bb-466c-4889-9af2-edb533e80809", draftVersion: 1,
    connection: { generation: 1, canCreatePaused: true, selected: { metaBusinessId: null, adAccountId: "act_1", accountName: "Solaride 101", pageId: "p", pageName: "Cedar Ridge", currency: "INR", timezoneName: "Asia/Kolkata" } },
    creatives: [{ id: creativeId, businessId, approved: true, imageUrl: "https://example.com/a.png", headline: "Austin chiropractic, $49 first exam" }],
    form: { id: "1234567890", name: "Smoke form", status: "ACTIVE" } as never, website: "https://example.com",
    geo: { resolvedAreaLabel: geo.resolvedAreaLabel, unresolvedNames: geo.unresolvedNames, explicitlyNationwide: geo.explicitlyNationwide },
    hash: () => "a".repeat(64),
  });
  return { geo, blockers: review.blockers.map((blocker) => blocker.reason) };
}

describe("core: the production smoke's saved data passes Prepare (#1809)", () => {
  it("is a valid draft: budget, objective and areas within Prepare's schema", () => {
    expect(draftInputSchema.safeParse(draft).success).toBe(true);
    expect(smoke.dailyBudgetRupees).toBeGreaterThan(0);
    expect(smoke.destination).toBe("instant_form");
  });

  it("every saved area resolves in Meta under today's rules, so Prepare raises no data blocker", async () => {
    const { geo, blockers } = await prepare(smoke.locations);
    expect(geo.unresolvedNames).toEqual([]);
    expect(geo.resolvedAreaLabel).toBeTruthy();
    expect(blockers.filter((reason) => reason && DATA_BLOCKERS.includes(reason))).toEqual([]);
  });

  it("goes red on the data #1745 had to fix (bare names abroad), so this guard catches it", async () => {
    const { geo, blockers } = await prepare(smoke.before1745.locations);
    expect(geo.unresolvedNames).toEqual(expect.arrayContaining(["Round Rock", "Cedar Park"]));
    expect(blockers).toContain("REVIEW_AREAS_UNRESOLVED");
  });
});
