import { afterEach, describe, expect, it, vi } from "vitest";
import rebuildTape from "./fixtures/meta/edit-audience-rebuild.json";
import patchTape from "./fixtures/meta/edit-audience-patch.json";
import rateLimitedTape from "./fixtures/meta/edit-audience-patch-rate-limited.json";
import whatsappTape from "./fixtures/meta/edit-audience-whatsapp.json";
import legacyWhatsAppTape from "./fixtures/meta/edit-audience-whatsapp-legacy.json";
import languageTape from "./fixtures/meta/edit-audience-language.json";
import whatsappLanguageTape from "./fixtures/meta/edit-audience-whatsapp-language.json";
import scrubbedRunningTape from "./fixtures/meta/edit-audience-running.json";
import scrubbedCopyTape from "./fixtures/meta/edit-audience-copy.json";
import scrubbedSwitchTape from "./fixtures/meta/edit-audience-switch.json";
import scrubbedCancelTape from "./fixtures/meta/edit-audience-cancel.json";
import { CampaignDeliveryError, MetaClient, MetaError } from "@/lib/meta/client";
import { TargetingExclusionsMissingError } from "@/lib/meta/service-area";

// #773: Graph responses recorded by scripts/record-meta-edit-audience.ts on PAUSED Solaride test
// campaigns (archived afterwards): editing a launched ad set's audience, Chandigarh → Mohali, ages 30-60.
// - rebuild: the ad set has interests, which Meta won't patch in place (100/1359202)
// - patch:   the ad set has none
// - whatsapp: a click-to-WhatsApp ad set without interests, which Meta won't patch either (#912)
// - language / whatsapp-language: English (All) + Hindi only, patched and rebuilt; Meta stores 1001 as [6, 24]
// - rate-limited: Meta allows one targeting update per ad set per 30 s (#613), validate_only included
//   (its ad set read's field list was extended with budget_remaining after recording; bodies unchanged)

type Exchange = { method: string; path: string; form?: Record<string, string>; status: number; body: unknown };
type Sent = { method: string; path: string; form: Record<string, string> };

const creds = { adAccountId: "act_9000000000000001", pageId: "900000000000002", accessToken: "test-token" };
// metaScrubber() fakes (#1040) for the account and Page, rebound to these creds.
const rebind = (tape: unknown) => JSON.parse(JSON.stringify(tape).replaceAll("9000000000000001", creds.adAccountId.slice(4)).replaceAll("900000000000002", creds.pageId)) as unknown[];
const runningTape = rebind(scrubbedRunningTape);
// #765 (b): one recording (CEO-approved on #765, campaign PAUSED throughout, tree deleted after): an ACTIVE WhatsApp
// ad set A gets a PAUSED copy B; A switches to B; B gets a copy C, which is cancelled. Ids join up across the tapes.
const copyTape = rebind(scrubbedCopyTape), switchTape = rebind(scrubbedSwitchTape), cancelTape = rebind(scrubbedCancelTape);
const RECORDED = { campaign: "900000000000000003", a: "900000000000000005", aAd: "900000000000000008", b: "900000000000000007", bAd: "900000000000000009", c: "900000000000000010" };
const mohali = { cities: [{ key: "1029599", name: "Mohali", radius: 25, distance_unit: "kilometer" }] };
// A new area always arrives with its #741 out-of-area exclusions (the edit service computes them).
const changes = { location: mohali as never, excludedLocation: { regions: [{ key: "1723" }] } as never, age: { min: 30, max: 60 } };

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

  // #912 (Dev 4): Meta refuses any in-place targeting update on a click-to-WhatsApp ad set (100/1359202),
  // even without interests, so it is rebuilt. Recorded on a PAUSED WhatsApp test campaign, archived.
  it("rebuilds a WhatsApp ad set without interests instead of patching it", async () => {
    const tape = replay(whatsappTape);
    const { campaignId, adSetId, adId, copiedAdId, newAdSetId } = ids(whatsappTape);
    const meta = new MetaClient(creds);
    const input = { adSetId, adIds: [adId], changes };
    expect((await meta.editAdSetTargeting(campaignId, input, { validateOnly: true })).mode).toBe("rebuild");
    expect(await meta.editAdSetTargeting(campaignId, input)).toEqual({ mode: "rebuild", validated: false, adSetId: newAdSetId, adIds: [copiedAdId], retiredAdSetId: adSetId });
    const posts = tape.sent.filter(call => call.method === "POST");
    expect(posts.some(call => call.path === adSetId && "targeting" in call.form)).toBe(false);
    expect(JSON.parse(posts[1].form.promoted_object ?? "{}")).toMatchObject({ page_id: creds.pageId });
    expect(posts[1].form).toMatchObject({ status: "PAUSED", destination_type: "WHATSAPP" });
    // #906/#913: the rebuilt WhatsApp ad set leaves Audience Network out; Meta accepted it (re-recorded after #913).
    expect(JSON.parse(posts[1].form.targeting).publisher_platforms).toEqual(["facebook", "instagram", "messenger"]);
    expect(posts.at(-1)).toEqual({ method: "POST", path: adSetId, form: { status: "ARCHIVED" } });
    expect(tape.sent.some(call => call.form.status === "ACTIVE")).toBe(false);
    expect(tape.pending).toEqual([]);
  });

  // #913 follow-up (QA): a WhatsApp ad set launched before #913 (automatic placements) whose ad's 9:16 creative
  // still names audience_network is rebuilt without Audience Network, and Meta accepts the old ad copied onto it.
  // Recorded by scripts/record-meta-edit-whatsapp-legacy.ts on a PAUSED test campaign, archived.
  it("rebuilds a pre-#913 WhatsApp ad set without Audience Network, keeping its old ad", async () => {
    const tape = replay(legacyWhatsAppTape);
    const { campaignId, adSetId, adId, copiedAdId, newAdSetId } = ids(legacyWhatsAppTape);
    const meta = new MetaClient(creds);
    const input = { adSetId, adIds: [adId], changes: { age: { min: 30, max: 60 } } };
    expect((await meta.editAdSetTargeting(campaignId, input, { validateOnly: true })).mode).toBe("rebuild");
    expect(await meta.editAdSetTargeting(campaignId, input)).toEqual({ mode: "rebuild", validated: false, adSetId: newAdSetId, adIds: [copiedAdId], retiredAdSetId: adSetId });
    const recorded = legacyWhatsAppTape as Array<{ method: string; path: string; form?: Record<string, string>; body: unknown }>;
    const source = recorded.find(exchange => exchange.method === "GET" && exchange.path.startsWith(`${adSetId}?`))!.body as { targeting: Record<string, unknown> };
    expect(source.targeting).not.toHaveProperty("publisher_platforms");
    const created = tape.sent.filter(call => call.method === "POST" && /^act_\d+\/adsets$/.test(call.path));
    expect(created).toHaveLength(2);
    for (const call of created) {
      const targeting = JSON.parse(call.form.targeting);
      expect(targeting.publisher_platforms).toEqual(["facebook", "instagram", "messenger"]);
      expect(JSON.stringify(targeting)).not.toContain("audience_network");
    }
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

  // #765: recorded on an ACTIVE ad set under a PAUSED test campaign. Meta patches it in place and it stays ACTIVE.
  it("patches a running ad set in place and keeps it running: no status write, read back ACTIVE", async () => {
    const tape = replay(runningTape);
    const { campaignId, adSetId } = ids(runningTape);
    const meta = new MetaClient(creds);
    const input = { adSetId, adIds: ["ad"], changes };
    expect((await meta.editAdSetTargeting(campaignId, input, { validateOnly: true })).validated).toBe(true);
    expect(await meta.editAdSetTargeting(campaignId, input)).toEqual({ mode: "patch", validated: false, adSetId, adIds: input.adIds, retiredAdSetId: null });
    const posts = tape.sent.filter(call => call.method === "POST");
    expect(posts.map(call => call.path)).toEqual([adSetId, adSetId]);
    expect(posts.some(call => "status" in call.form)).toBe(false);
    expect(((runningTape as Exchange[]).at(-1)!.body as { status: string }).status).toBe("ACTIVE");
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

  // Exclusions only grow: what the ad set already excludes stays; a state AdBrain's own #741 rule added
  // that the new area now needs is the one thing dropped, and the owner's own exclusions never are.
  describe("exclusions only grow", () => {
    const withExclusions = () => (patchTape as Exchange[]).slice(0, 4).map(exchange => /fields=id%2Ccampaign_id%2Cstatus/.test(exchange.path)
      ? { ...exchange, body: { ...(exchange.body as { targeting: object }), targeting: { ...(exchange.body as { targeting: object }).targeting,
        excluded_geo_locations: { regions: [{ key: "1723" }, { key: "1742" }, { key: "777" }], cities: [{ key: "555" }, { key: "1033379" }] } } } } : exchange);
    const sentExclusions = async (edit: object) => {
      const tape = replay(withExclusions());
      const { campaignId, adSetId } = ids(patchTape);
      await new MetaClient(creds).editAdSetTargeting(campaignId, { adSetId, adIds: ["a"], changes: edit as never }, { validateOnly: true });
      return JSON.parse(tape.sent.find(call => call.method === "POST")!.form.targeting).excluded_geo_locations;
    };

    it("adds the new exclusions to the existing ones by key without removing any", async () => {
      expect(await sentExclusions({ excludedLocation: { regions: [{ key: "1723" }, { key: "1724" }], cities: [{ key: "666" }] } })).toEqual({
        regions: [{ key: "1723" }, { key: "1742" }, { key: "777" }, { key: "1724" }], cities: [{ key: "555" }, { key: "1033379" }, { key: "666" }],
      });
    });

    it("when the area changes, drops only the #741 exclusions the new area no longer makes (never the owner's own)", async () => {
      expect(await sentExclusions({ location: mohali, excludedLocation: { regions: [{ key: "1723" }, { key: "1724" }] } })).toEqual({
        regions: [{ key: "1723" }, { key: "777" }, { key: "1724" }], cities: [{ key: "555" }],
      });
    });

    it("a new area with no exclusions (country-wide) clears #741's and keeps the owner's", async () => {
      expect(await sentExclusions({ location: { countries: ["IN"] }, excludedLocation: {} })).toEqual({ regions: [{ key: "777" }], cities: [{ key: "555" }] });
    });
  });

  // #741 (QA on #828): the old area's exclusions can't be kept for a new area, nor a place included and excluded at once.
  it("refuses a new area that comes without its own exclusions, or that the result would also exclude, before any write", async () => {
    const rajasthan = { regions: [{ key: "1743" }] };
    const tape = replay(patchTape);
    const { campaignId, adSetId } = ids(patchTape);
    const meta = new MetaClient(creds);
    await expect(meta.editAdSetTargeting(campaignId, { adSetId, adIds: ["a"], changes: { location: rajasthan as never } }, { validateOnly: true }))
      .rejects.toBeInstanceOf(TargetingExclusionsMissingError);
    await expect(meta.editAdSetTargeting(campaignId, { adSetId, adIds: ["a"], changes: { location: rajasthan as never, excludedLocation: rajasthan as never } }, { validateOnly: true }))
      .rejects.toBeInstanceOf(TargetingExclusionsMissingError);
    expect(tape.sent.filter(call => call.method !== "GET")).toEqual([]);
  });

  it("refuses a running ad set that needs a rebuild, an archived one, and empty or out-of-range changes, before any write", async () => {
    const status = (recorded: unknown[], value: string) => (recorded as Exchange[]).map(exchange => /fields=id%2Ccampaign_id%2Cstatus/.test(exchange.path)
      ? { ...exchange, body: { ...(exchange.body as object), status: value } } : exchange);
    const meta = new MetaClient(creds);
    // #765: a running ad set is only changed in place; rebuilding it would leave the old one delivering.
    const rebuilding = replay(status(rebuildTape, "ACTIVE"));
    const rebuildIds = ids(rebuildTape);
    await expect(meta.editAdSetTargeting(rebuildIds.campaignId, { adSetId: rebuildIds.adSetId, adIds: ["a"], changes })).rejects.toThrow("Pause the ad set before changing its audience.");
    expect(rebuilding.sent.filter(call => call.method !== "GET")).toEqual([]);
    vi.restoreAllMocks();

    const tape = replay(status(patchTape, "ARCHIVED"));
    const { campaignId, adSetId } = ids(patchTape);
    await expect(meta.editAdSetTargeting(campaignId, { adSetId, adIds: ["a"], changes })).rejects.toBeInstanceOf(CampaignDeliveryError);
    await expect(meta.editAdSetTargeting(campaignId, { adSetId, adIds: ["a"], changes: {} })).rejects.toThrow("Invalid audience change.");
    await expect(meta.editAdSetTargeting(campaignId, { adSetId, adIds: ["a"], changes: { age: { min: 40, max: 30 } } })).rejects.toThrow("Invalid audience change.");
    expect(tape.sent.filter(call => call.method !== "GET")).toEqual([]);
  });

  describe("language (#773)", () => {
    const languages = { languages: [1001, 46] };

    it("patches the ad set's locales and accepts Meta storing English (All) as US + UK", async () => {
      const tape = replay(languageTape);
      const { campaignId, adSetId, adId } = ids(languageTape);
      const meta = new MetaClient(creds);
      const input = { adSetId, adIds: [adId], changes: languages };
      expect(await meta.editAdSetTargeting(campaignId, input, { validateOnly: true })).toMatchObject({ mode: "patch", validated: true });
      expect(await meta.editAdSetTargeting(campaignId, input)).toEqual({ mode: "patch", validated: false, adSetId, adIds: [adId], retiredAdSetId: null });
      const posts = tape.sent.filter(call => call.method === "POST");
      expect(posts.map(call => call.form.execution_options)).toEqual(['["validate_only"]', undefined]);
      const sent = JSON.parse(posts[1].form.targeting);
      expect(sent.locales).toEqual([1001, 46]);
      // Only the language changed: the area, exclusions and ages are sent back as Meta had them.
      const source = (languageTape as Exchange[]).find(exchange => exchange.method === "GET" && exchange.path.startsWith(`${adSetId}?fields=id%2Ccampaign_id`))!.body as { targeting: Record<string, unknown> };
      expect({ ...sent, locales: undefined }).toEqual({ ...source.targeting, locales: undefined });
      const readBack = (languageTape as Exchange[]).at(-1)!.body as { targeting: { locales: number[] } };
      expect(readBack.targeting.locales).toEqual([6, 24, 46]);
      expect(tape.pending).toEqual([]);
    });

    it("rebuilds a WhatsApp ad set with the new locales", async () => {
      const tape = replay(whatsappLanguageTape);
      const { campaignId, adSetId, adId, copiedAdId, newAdSetId } = ids(whatsappLanguageTape);
      const meta = new MetaClient(creds);
      const input = { adSetId, adIds: [adId], changes: languages };
      expect((await meta.editAdSetTargeting(campaignId, input, { validateOnly: true })).mode).toBe("rebuild");
      expect(await meta.editAdSetTargeting(campaignId, input)).toEqual({ mode: "rebuild", validated: false, adSetId: newAdSetId, adIds: [copiedAdId], retiredAdSetId: adSetId });
      const created = tape.sent.filter(call => call.method === "POST" && /^act_\d+\/adsets$/.test(call.path));
      expect(created.map(call => JSON.parse(call.form.targeting).locales)).toEqual([[1001, 46], [1001, 46]]);
      expect(created[1].form).toMatchObject({ status: "PAUSED", destination_type: "WHATSAPP" });
      expect(tape.sent.some(call => call.form.status === "ACTIVE")).toBe(false);
      expect(tape.pending).toEqual([]);
    });

    it("refuses a patch Meta read back without the new languages", async () => {
      const tampered = structuredClone(languageTape) as Exchange[];
      (tampered.at(-1)!.body as { targeting: { locales: number[] } }).targeting.locales = [6, 24];
      replay(tampered);
      const { campaignId, adSetId, adId } = ids(languageTape);
      await expect(new MetaClient(creds).editAdSetTargeting(campaignId, { adSetId, adIds: [adId], changes: languages }))
        .rejects.toThrow("Meta did not confirm the new audience.");
    });

    it("refuses an unlisted or repeated language before calling Meta", async () => {
      const tape = replay([]);
      const meta = new MetaClient(creds);
      await expect(meta.editAdSetTargeting("1", { adSetId: "2", adIds: ["3"], changes: { languages: [9999] } })).rejects.toThrow("Invalid audience change.");
      await expect(meta.editAdSetTargeting("1", { adSetId: "2", adIds: ["3"], changes: { languages: [46, 46] } })).rejects.toThrow("Invalid audience change.");
      expect(tape.sent).toEqual([]);
    });
  });
});

describe("core: Meta's recorded answers for a running ad set's copy, switch and cancel (#765 b)", () => {
  it("copies an ACTIVE WhatsApp ad set into a PAUSED one with PAUSED ads and leaves the running one unwritten", async () => {
    const tape = replay(copyTape);
    const meta = new MetaClient(creds);
    const input = { adSetId: RECORDED.a, adIds: [RECORDED.aAd], changes };
    expect(await meta.editAdSetTargeting(RECORDED.campaign, input, { validateOnly: true, copyOnly: true })).toMatchObject({ mode: "rebuild", validated: true });
    expect(await meta.editAdSetTargeting(RECORDED.campaign, input, { copyOnly: true })).toEqual({ mode: "rebuild", validated: false, adSetId: RECORDED.b, adIds: [RECORDED.bAd], retiredAdSetId: null });
    expect(tape.sent.filter(call => call.method !== "GET" && call.path.startsWith(RECORDED.a))).toEqual([]);
    expect(tape.pending).toEqual([]);
    await expect(meta.editAdSetTargeting(RECORDED.campaign, input)).rejects.toThrow();
  });

  it("switches A to B in Meta's real order: validate B, pause A, B's ads and B ACTIVE, read back, archive A", async () => {
    const tape = replay(switchTape);
    expect(await new MetaClient(creds).switchAdSet(RECORDED.campaign, { fromAdSetId: RECORDED.a, toAdSetId: RECORDED.b, toAdIds: [RECORDED.bAd], running: true }))
      .toEqual({ fromAdSetId: RECORDED.a, adSetId: RECORDED.b, adIds: [RECORDED.bAd] });
    expect(tape.sent.filter(call => call.method === "POST").map(call => `${call.path}:${call.form.status}${call.form.execution_options ? ":validate" : ""}`)).toEqual([
      `${RECORDED.b}:ACTIVE:validate`, `${RECORDED.a}:PAUSED`, `${RECORDED.bAd}:ACTIVE`, `${RECORDED.b}:ACTIVE`, `${RECORDED.a}:ARCHIVED`,
    ]);
    expect(tape.pending).toEqual([]);
  });

  it("cancels a waiting copy C of the running B: only C is deleted", async () => {
    const tape = replay(cancelTape);
    const meta = new MetaClient(creds);
    const copy = await meta.editAdSetTargeting(RECORDED.campaign, { adSetId: RECORDED.b, adIds: [RECORDED.bAd], changes: { age: { min: 35, max: 60 } } }, { copyOnly: true });
    expect(copy).toMatchObject({ adSetId: RECORDED.c, retiredAdSetId: null });
    await meta.deleteAdSetCopy(RECORDED.campaign, RECORDED.c);
    expect(tape.sent.filter(call => call.method !== "GET").map(call => `${call.method} ${call.path}`)).toEqual([
      `POST act_${creds.adAccountId.slice(4)}/adsets`, `POST ${RECORDED.bAd}/copies`, `DELETE ${RECORDED.c}`,
    ]);
    expect(tape.pending).toEqual([]);
  });
});
