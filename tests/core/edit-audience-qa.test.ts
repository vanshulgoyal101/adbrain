import { afterEach, describe, expect, it, vi } from "vitest";
import rebuildTape from "./fixtures/meta/edit-audience-rebuild.json";
import { MetaClient } from "@/lib/meta/client";

// QA (PR #828 review): two ways an audience edit can undo a launch guarantee, on the recorded rebuild tape.
// 1. Money: a capped run (lifetime budget = the owner's approved daily × days, #157) rebuilt mid-run must
//    not get the FULL lifetime budget again. The old ad set already spent part of it, so copying it lets
//    Meta spend the approved total a second time. Source body edited: lifetime ₹900, ₹300 spent
//    (budget_remaining 60000 paise), end time in the future.
// 2. #741 (P0): an owner exclusion must not wipe the out-of-area exclusions already on the ad set.
type Exchange = { method: string; path: string; status: number; body: unknown };
type Sent = { method: string; path: string; form: Record<string, string> };
const creds = { adAccountId: "act_9000000000000001", pageId: "900000000000002", accessToken: "test-token" };
const AREA = [{ key: "1723" }, { key: "1731" }]; // two of #802's 33 excluded states

function tapeWith(edit: (source: Record<string, unknown>) => void): Exchange[] {
  const tape = structuredClone(rebuildTape) as Exchange[];
  for (const exchange of tape) {
    if (exchange.method === "GET" && /^\d+\?fields=id%2Ccampaign_id%2Cstatus%2Cbilling_event/.test(exchange.path)) edit(exchange.body as Record<string, unknown>);
  }
  return tape;
}
function replay(tape: Exchange[]) {
  const pending = [...tape];
  const sent: Sent[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    url.searchParams.delete("access_token");
    const method = init?.method ?? "GET";
    const path = url.pathname.replace("/v21.0/", "") + url.search;
    const form = init?.body instanceof URLSearchParams ? Object.fromEntries([...init.body].filter(([key]) => key !== "access_token")) : {};
    sent.push({ method, path, form });
    const index = pending.findIndex(exchange => exchange.method === method && exchange.path === path);
    if (index < 0) throw new Error(`Unrecorded Graph call: ${method} ${path}`);
    return Response.json(pending.splice(index, 1)[0].body, { status: 200 });
  });
  return sent;
}
const ids = () => {
  const first = (rebuildTape as Exchange[]).find(exchange => /\/adsets\?/.test(exchange.path))!;
  return { campaignId: first.path.split("/")[0], adSetId: (first.body as { data: { id: string }[] }).data[0].id };
};
afterEach(() => vi.restoreAllMocks());

describe("audience edit keeps the launch guarantees (QA, PR #828)", () => {
  it("a capped run's rebuilt ad set gets at most what the old one has left, never the full lifetime budget again", async () => {
    const sent = replay(tapeWith((source) => {
      delete source.daily_budget;
      Object.assign(source, { lifetime_budget: "90000", budget_remaining: "60000", end_time: new Date(Date.now() + 2 * 86_400_000).toISOString() });
    }));
    const { campaignId, adSetId } = ids();
    await new MetaClient(creds).editAdSetTargeting(campaignId, { adSetId, adIds: ["120253709601690526"], changes: { age: { min: 30, max: 60 } } }, { validateOnly: true })
      .catch(() => undefined);
    const create = sent.find(call => call.method === "POST" && call.path.endsWith("/adsets"));
    if (create) expect(Number(create.form.lifetime_budget)).toBeLessThanOrEqual(60000);
  });

  it("an owner exclusion is added to the out-of-area exclusions already on the ad set, not instead of them", async () => {
    const sent = replay(tapeWith((source) => {
      (source.targeting as Record<string, unknown>).excluded_geo_locations = { regions: AREA };
    }));
    const { campaignId, adSetId } = ids();
    await new MetaClient(creds).editAdSetTargeting(campaignId, {
      adSetId, adIds: ["120253709601690526"], changes: { excludedLocation: { cities: [{ key: "1033379" }] } as never },
    }, { validateOnly: true });
    const create = sent.find(call => call.method === "POST" && call.path.endsWith("/adsets"))!;
    const regions = (JSON.parse(create.form.targeting).excluded_geo_locations?.regions ?? []) as { key: string }[];
    expect(regions.map(region => region.key)).toEqual(expect.arrayContaining(AREA.map(region => region.key)));
  });
  it("moving the area into a state the old area excluded doesn't keep excluding it (stale #741 exclusions)", async () => {
    // Tricity's exclusions include Rajasthan (1743); the owner moves the area to Rajasthan.
    const RAJASTHAN = "1743";
    const sent = replay(tapeWith((source) => {
      (source.targeting as Record<string, unknown>).excluded_geo_locations = { regions: [...AREA, { key: RAJASTHAN }] };
    }));
    const { campaignId, adSetId } = ids();
    await new MetaClient(creds).editAdSetTargeting(campaignId, {
      adSetId, adIds: ["120253709601690526"], changes: { location: { regions: [{ key: RAJASTHAN }] } as never },
    }, { validateOnly: true }).catch(() => undefined);
    const create = sent.find(call => call.method === "POST" && call.path.endsWith("/adsets"));
    if (create) {
      const targeting = JSON.parse(create.form.targeting);
      const excluded = ((targeting.excluded_geo_locations?.regions ?? []) as { key: string }[]).map(region => region.key);
      expect(excluded).not.toContain(RAJASTHAN);
    }
  });
});
