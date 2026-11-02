import { afterEach, describe, expect, it, vi } from "vitest";
import recorded from "./fixtures/meta/pixels.json";
import provisional from "./fixtures/meta/pixel-stats.provisional.json";
import revoked from "./fixtures/meta/token-revoked.json";
import { MetaClient } from "@/lib/meta/client";
import type { ConnectionDTO } from "@/lib/meta/connect-contracts";
import { cachedTrackingStatus, resetTrackingStatusCache } from "@/lib/meta/pixels";

// #2712 (#2595 phase 2): can this ad account's website report Lead/Purchase? Real answers from the test ad account
// (scripts/record-meta-pixels.ts, scrubbed): no pixel (read just before #2717 created one), one pixel whose 7-day
// stats are empty (only test events, which Meta leaves out of stats), and Meta's refusal for a pixel this token can't
// read. Pixels with real events are PROVISIONAL (documented shape) until the test pixel has real events.
type Exchange = { name: string; method: string; path: string; status: number; body: unknown };
const tape = recorded.tape as Exchange[];
const creds = { ...recorded.creds, accessToken: "core-token" };
const now = new Date(recorded.recordedAt);
const [listCall, statsCall] = tape.filter((exchange) => exchange.name === "tracking");
const refused = tape.find((exchange) => exchange.name === "stats-refused")!;
const pixelId = (listCall.body as { data: { id: string }[] }).data[0].id;
const listPath = listCall.path;
const statsPath = statsCall.path;

/** Answers Graph GETs by path (`answers[path]`, then `answers[pathname]` for paging), recording what was asked. */
function graph(answers: Record<string, { status: number; body: unknown }>) {
  const calls: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    expect(init?.method ?? "GET").toBe("GET");
    const url = new URL(String(input));
    url.searchParams.delete("access_token"); // re-serialises the query the way the recorder did
    const path = url.pathname.replace(/^\/v\d+\.\d+\//, "") + url.search;
    calls.push(path);
    const answer = answers[path];
    if (!answer) throw new Error(`Unrecorded Graph call: ${decodeURIComponent(path)}`);
    return Response.json(answer.body, { status: answer.status });
  });
  return calls;
}

const ok = (body: unknown) => ({ status: 200, body });
const listWith = (pixels: Record<string, unknown>[]) => ok({ data: pixels });

afterEach(() => {
  vi.restoreAllMocks();
  resetTrackingStatusCache();
});

describe("core: the website tracking check reads Meta's real pixel answers (#2712)", () => {
  it("an ad account with no pixel is 'none', and no stats are read", async () => {
    const calls = graph({ [listPath]: ok(recorded.noPixels) });
    const status = await new MetaClient(creds).trackingStatus({ now });
    expect(status).toEqual({ state: "none", unreadable: null, pixelId: null, pixels: [], window: null, lastSeenAt: null, counts: null, totalEvents: null });
    expect(calls).toEqual([listPath]);
  });

  it("a pixel with no events in 7 days is 'quiet', with the window it checked", async () => {
    const calls = graph({ [listPath]: listCall, [statsPath]: statsCall });
    const status = await new MetaClient(creds).trackingStatus({ now, need: "Lead" });
    expect(status).toEqual({
      state: "quiet", unreadable: null, pixelId,
      pixels: [{ id: pixelId, name: "AdBrain test pixel (#2595)", lastFiredAt: null, unavailable: false }],
      window: { since: "2026-10-26T16:00:00+0000", until: "2026-11-02T16:00:00+0000" },
      lastSeenAt: null, counts: { Lead: 0, Purchase: 0 }, totalEvents: 0,
    });
    expect(calls).toEqual([listPath, statsPath]);
  });

  it("a stats read Meta refuses is 'unreadable' (couldn't check), never 'quiet' or another business's pixel", async () => {
    graph({ [listPath]: listCall, [statsPath]: refused });
    const status = await new MetaClient(creds).trackingStatus({ now });
    expect(status).toMatchObject({ state: "unreadable", unreadable: "stats_failed", pixelId, counts: null, window: null });
  });

  it("a chosen pixel the account doesn't list is 'unreadable', without reading its stats", async () => {
    const calls = graph({ [listPath]: listCall });
    const status = await new MetaClient(creds).trackingStatus({ now, pixelId: recorded.unreadablePixel });
    expect(status).toMatchObject({ state: "unreadable", unreadable: "not_listed", pixelId: recorded.unreadablePixel, pixels: [{ id: pixelId }] });
    expect(calls).toEqual([listPath]);
  });

  it("an expired connection says reconnect, not 'none'", async () => {
    graph({ [listPath]: revoked });
    const status = await new MetaClient(creds).trackingStatus({ now });
    expect(status).toMatchObject({ state: "unreadable", unreadable: "reconnect", pixels: [] });
  });

  it("a pixel Meta marks unavailable is 'unreadable', without reading its stats", async () => {
    const calls = graph({ [listPath]: listWith([{ id: pixelId, name: "Old", is_unavailable: true }]) });
    const status = await new MetaClient(creds).trackingStatus({ now });
    expect(status).toMatchObject({ state: "unreadable", unreadable: "unavailable", pixelId });
    expect(calls).toEqual([listPath]);
  });
});

describe("core: Lead and Purchase counts decide ready or event missing (#2712, PROVISIONAL stats shape)", () => {
  const fired = listWith([{ id: pixelId, name: "Site", last_fired_time: "2026-11-01T10:12:00+0000", is_unavailable: false }]);

  it("Lead seen: ready for signups, event missing for sales; last seen is the newest event", async () => {
    graph({ [listPath]: fired, [statsPath]: ok(provisional.leadOnly) });
    const meta = new MetaClient(creds);
    const leads = await meta.trackingStatus({ now, need: "Lead" });
    expect(leads).toMatchObject({ state: "ready", counts: { Lead: 2, Purchase: 0 }, totalEvents: 60, lastSeenAt: "2026-11-01T14:00:00+0000" });
    expect((await meta.trackingStatus({ now, need: "Purchase" })).state).toBe("event_missing");
    expect((await meta.trackingStatus({ now })).state).toBe("ready");
  });

  it("reads every page: a Purchase on page 2 makes sales ready", async () => {
    const calls = graph({ [listPath]: fired, [statsPath]: ok(provisional.pageViewsOnly), [`${statsPath}&after=PAGE2`]: ok(provisional.purchasePage2) });
    const status = await new MetaClient(creds).trackingStatus({ now, need: "Purchase" });
    expect(status).toMatchObject({ state: "ready", counts: { Lead: 0, Purchase: 1 }, totalEvents: 10 });
    expect(calls).toEqual([listPath, statsPath, `${statsPath}&after=PAGE2`]);
  });

  it("a page that can't be followed can't prove an event is missing: 'unreadable', not 'event_missing'", async () => {
    const noCursor = { ...provisional.pageViewsOnly, paging: { next: "https://graph.facebook.com/v26.0/next" } };
    graph({ [listPath]: fired, [statsPath]: ok(noCursor) });
    const status = await new MetaClient(creds).trackingStatus({ now, need: "Lead" });
    expect(status).toMatchObject({ state: "unreadable", unreadable: "stats_incomplete", counts: { Lead: 0, Purchase: 0 } });
  });

  it("with no pixel chosen, the one that fired most recently is checked", async () => {
    const calls = graph({
      [listPath]: listWith([{ id: "9000000000000099", name: "Old", is_unavailable: false }, { id: pixelId, name: "Site", last_fired_time: "2026-11-01T10:12:00+0000" }]),
      [statsPath]: ok(provisional.leadOnly),
    });
    expect((await new MetaClient(creds).trackingStatus({ now })).pixelId).toBe(pixelId);
    expect(calls).toEqual([listPath, statsPath]);
  });

  it("with no pixel chosen, an unavailable pixel never hides a working one, even if it fired later", async () => {
    graph({
      [listPath]: listWith([
        { id: "9000000000000098", name: "Abandoned", last_fired_time: "2026-11-02T09:00:00+0000", is_unavailable: true },
        { id: pixelId, name: "New", is_unavailable: false },
      ]),
      [statsPath]: statsCall,
    });
    expect(await new MetaClient(creds).trackingStatus({ now })).toMatchObject({ state: "quiet", pixelId });
  });
});

describe("tracking status cache (#2712)", () => {
  const connection = (businessId: string) => ({
    businessId, generation: 1,
    selected: { adAccountId: creds.adAccountId },
  }) as ConnectionDTO;

  it("keeps a status briefly per business, never shares it across businesses, and never keeps 'unreadable'", async () => {
    const calls = graph({ [listPath]: listCall, [statsPath]: statsCall });
    const meta = new MetaClient(creds);
    vi.useFakeTimers({ now, toFake: ["Date"] });
    try {
      await cachedTrackingStatus(meta, connection("00000000-0000-4000-8000-000000000001"));
      await cachedTrackingStatus(meta, connection("00000000-0000-4000-8000-000000000001"));
      expect(calls).toHaveLength(2);
      await cachedTrackingStatus(meta, connection("00000000-0000-4000-8000-000000000002"));
      expect(calls).toHaveLength(4);
      vi.setSystemTime(now.getTime() + 3 * 60_000);
      await cachedTrackingStatus(meta, connection("00000000-0000-4000-8000-000000000001"));
      expect(calls).toHaveLength(6);
    } finally {
      vi.useRealTimers();
    }
  });

  it("re-reads after an unreadable answer", async () => {
    const calls = graph({ [listPath]: revoked });
    const meta = new MetaClient(creds);
    const business = connection("00000000-0000-4000-8000-000000000003");
    expect((await cachedTrackingStatus(meta, business)).state).toBe("unreadable");
    await cachedTrackingStatus(meta, business);
    expect(calls).toHaveLength(2);
  });
});
