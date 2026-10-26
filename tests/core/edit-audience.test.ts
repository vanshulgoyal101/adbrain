import { afterEach, describe, expect, it, vi } from "vitest";
import rebuildTape from "./fixtures/meta/edit-audience-rebuild.json";
import patchTape from "./fixtures/meta/edit-audience-patch.json";
import rateLimitedTape from "./fixtures/meta/edit-audience-patch-rate-limited.json";
import { CampaignDeliveryError, MetaClient, MetaError } from "@/lib/meta/client";
import { TargetingExclusionsMissingError } from "@/lib/meta/service-area";

// #773: Graph responses recorded by scripts/record-meta-edit-audience.ts on PAUSED Solaride test
// campaigns (archived afterwards): editing a launched ad set's audience, Chandigarh → Mohali, ages 30-60.
// - rebuild: the ad set has interests, which Meta won't patch in place (100/1359202)
// - patch:   the ad set has none
// - rate-limited: Meta allows one targeting update per ad set per 30 s (#613), validate_only included
//   (its ad set read's field list was extended with budget_remaining after recording; bodies unchanged)

type Exchange = { method: string; path: string; form?: Record<string, string>; status: number; body: unknown };
type Sent = { method: string; path: string; form: Record<string, string> };

const creds = { adAccountId: "act_2398686420592052", pageId: "885223068001054", accessToken: "test-token" };
const mohali = { cities: [{ key: "1029599", name: "Mohali", radius: 25, distance_unit: "kilometer" }] };
const changes = { location: mohali as never, age: { min: 30, max: 60 } };

function replay(tape: unknown[]) {
  const pending = [...tape] as Exchange[];
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
    const [exchange] = pending.splice(index, 1);
    return Response.json(exchange.body, { status: exchange.status });
  });
  return { pending, sent };
}

const ids = (tape: unknown[]) => {
  const exchanges = tape as Exchange[];
  const first = exchanges.find(exchange => /\/adsets\?/.test(exchange.path))!;
  const campaignId = first.path.split("/")[0];
  const adSetId = ((first.body as { data: { id: string }[] }).data)[0].id;
  const copy = exchanges.find(exchange => exchange.path.endsWith("/copies"));
  const created = exchanges.find(exchange => exchange.method === "POST" && /^act_\d+\/adsets$/.test(exchange.path) && (exchange.body as { id?: string }).id);
  return { campaignId, adSetId, adId: copy?.path.split("/")[0] ?? "ad", copiedAdId: (copy?.body as { copied_ad_id?: string } | undefined)?.copied_ad_id, newAdSetId: (created?.body as { id?: string } | undefined)?.id };
};

afterEach(() => vi.restoreAllMocks());

describe("core: edit a launched ad set's audience (#773)", () => {
  it("rebuilds an ad set with interests: validate first, then a new PAUSED ad set with the ads copied, and the old one archived", async () => {
    const tape = replay(rebuildTape);
    const { campaignId, adSetId, adId, copiedAdId, newAdSetId } = ids(rebuildTape);
    const meta = new MetaClient(creds);
    const input = { adSetId, adIds: [adId], changes };
    const validated = await meta.editAdSetTargeting(campaignId, input, { validateOnly: true });
    expect(validated).toEqual({ mode: "rebuild", validated: true, adSetId, adIds: input.adIds, retiredAdSetId: null });
    expect(tape.sent.filter(call => call.method === "POST").map(call => call.form.execution_options)).toEqual(['["validate_only"]']);

    const edited = await meta.editAdSetTargeting(campaignId, input);
    expect(edited).toEqual({ mode: "rebuild", validated: false, adSetId: newAdSetId, adIds: [copiedAdId], retiredAdSetId: adSetId });
    const posts = tape.sent.filter(call => call.method === "POST");
    const created = JSON.parse(posts[1].form.targeting);
    // Launch's Advantage+ rule: hard age_min ≤ 25 and age_max 65, the owner's range as age_range; interests kept.
    expect(created).toMatchObject({ age_min: 25, age_max: 65, age_range: [30, 60], targeting_automation: { advantage_audience: 1 } });
    expect(created.flexible_spec?.[0]?.interests?.length).toBeGreaterThan(0);
    expect(posts[1].form).toMatchObject({ status: "PAUSED", campaign_id: campaignId });
    expect(posts[1].form).not.toHaveProperty("execution_options");
    expect(posts.at(-1)).toEqual({ method: "POST", path: adSetId, form: { status: "ARCHIVED" } });
    expect(tape.sent.some(call => call.form.status === "ACTIVE")).toBe(false);
    expect(tape.pending).toEqual([]);
  });

  it("patches an ad set without interests in place: validate first, then the targeting, read back", async () => {
    const tape = replay(patchTape);
    const { campaignId, adSetId } = ids(patchTape);
    const meta = new MetaClient(creds);
    const input = { adSetId, adIds: ["ad"], changes };
    expect((await meta.editAdSetTargeting(campaignId, input, { validateOnly: true })).validated).toBe(true);
    expect(await meta.editAdSetTargeting(campaignId, input)).toEqual({ mode: "patch", validated: false, adSetId, adIds: input.adIds, retiredAdSetId: null });
    const posts = tape.sent.filter(call => call.method === "POST");
    expect(posts.map(call => call.path)).toEqual([adSetId, adSetId]);
    expect(posts.map(call => Boolean(call.form.execution_options))).toEqual([true, false]);
    expect(tape.sent.some(call => call.path.includes("/adsets") && call.method === "POST")).toBe(false);
    expect(tape.pending).toEqual([]);
  });

  it("Meta's 30-second limit on a second targeting update surfaces as code 613 with nothing else written", async () => {
    const tape = replay(rateLimitedTape);
    const { campaignId, adSetId } = ids(rateLimitedTape);
    const meta = new MetaClient(creds);
    const input = { adSetId, adIds: ["x"], changes };
    await meta.editAdSetTargeting(campaignId, input, { validateOnly: true });
    await expect(meta.editAdSetTargeting(campaignId, input)).rejects.toSatisfy((error: unknown) => error instanceof MetaError && error.code === 613);
    expect(tape.sent.filter(call => call.method === "POST")).toHaveLength(2);
  });

  // A capped run must not get its whole cap back: the rebuilt ad set carries only what is left of it.
  it("rebuilds a capped ad set with only its remaining budget and the same end time", async () => {
    const end = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const capped = (rebuildTape as Exchange[]).map(exchange => /fields=id%2Ccampaign_id%2Cstatus%2Cbilling_event/.test(exchange.path)
      ? { ...exchange, body: { ...(exchange.body as object), daily_budget: "0", lifetime_budget: "150000", budget_remaining: "62000", end_time: end } } : exchange);
    const tape = replay(capped);
    const { campaignId, adSetId, adId } = ids(rebuildTape);
    await new MetaClient(creds).editAdSetTargeting(campaignId, { adSetId, adIds: [adId], changes }, { validateOnly: true });
    const form = tape.sent.find(call => call.method === "POST")!.form;
    expect(form).toMatchObject({ lifetime_budget: "62000", end_time: end });
    expect(form).not.toHaveProperty("daily_budget");
  });

  // #741 (Reviewer and QA on #828): a new Indian service area without its out-of-area exclusions is refused.
  it("refuses a new Indian area on a pre-#741 ad set when no out-of-area exclusions come with it, before any write", async () => {
    // A campaign launched before #741: the recorded ad set read without its excluded_geo_locations.
    const old = (rebuildTape as Exchange[]).map(exchange => {
      const body = exchange.body as { targeting?: Record<string, unknown> };
      if (!/fields=id%2Ccampaign_id%2Cstatus%2Cbilling_event/.test(exchange.path) || !body.targeting) return exchange;
      const targeting = { ...body.targeting };
      delete targeting.excluded_geo_locations;
      return { ...exchange, body: { ...body, targeting } };
    });
    const tape = replay(old);
    const { campaignId, adSetId, adId } = ids(rebuildTape);
    const india = { cities: [{ key: "1029599", name: "Mohali", country: "IN", radius: 25, distance_unit: "kilometer" }] };
    await expect(new MetaClient(creds).editAdSetTargeting(campaignId, { adSetId, adIds: [adId], changes: { location: india as never } }, { validateOnly: true }))
      .rejects.toBeInstanceOf(TargetingExclusionsMissingError);
    expect(tape.sent.filter(call => call.method !== "GET")).toEqual([]);
  });

  it("refuses an ad set that isn't PAUSED, and empty or out-of-range changes, before any write", async () => {
    const running = (patchTape as Exchange[]).map(exchange => /fields=id%2Ccampaign_id%2Cstatus/.test(exchange.path)
      ? { ...exchange, body: { ...(exchange.body as object), status: "ACTIVE" } } : exchange);
    const tape = replay(running);
    const { campaignId, adSetId } = ids(patchTape);
    const meta = new MetaClient(creds);
    await expect(meta.editAdSetTargeting(campaignId, { adSetId, adIds: ["a"], changes })).rejects.toBeInstanceOf(CampaignDeliveryError);
    await expect(meta.editAdSetTargeting(campaignId, { adSetId, adIds: ["a"], changes: {} })).rejects.toThrow("Invalid audience change.");
    await expect(meta.editAdSetTargeting(campaignId, { adSetId, adIds: ["a"], changes: { age: { min: 40, max: 30 } } })).rejects.toThrow("Invalid audience change.");
    expect(tape.sent.filter(call => call.method !== "GET")).toEqual([]);
  });
});
