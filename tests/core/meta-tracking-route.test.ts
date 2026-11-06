import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import recorded from "./fixtures/meta/pixels.json";
import provisional from "./fixtures/meta/pixel-stats.provisional.json";
import revoked from "./fixtures/meta/token-revoked.json";
import { connected, businessId } from "../fixtures/meta-connect-w3";
import { MetaClient } from "@/lib/meta/client";
import { ConnectionAccessError } from "@/lib/meta/connection-access-error";
import type { ConnectionDTO } from "@/lib/meta/connect-contracts";
import { resetTrackingStatusCache } from "@/lib/meta/pixels";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  requireOwnedBusiness: vi.fn(),
  withMetaConnection: vi.fn(),
  getConnectionStatus: vi.fn(),
  rateLimitResponse: vi.fn(),
  recordProductEvent: vi.fn(),
  locale: "en",
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: mocks.getUser } }),
}));
vi.mock("@/lib/meta/connection-access", async () => ({
  ConnectionAccessError: (await import("@/lib/meta/connection-access-error")).ConnectionAccessError,
  requireOwnedBusiness: mocks.requireOwnedBusiness,
  withMetaConnection: mocks.withMetaConnection,
  getConnectionStatus: mocks.getConnectionStatus,
}));
vi.mock("@/lib/security/rate-limit", () => ({ rateLimitResponse: mocks.rateLimitResponse }));
vi.mock("@/lib/observability/logger", async (original) => ({
  ...await original<typeof import("@/lib/observability/logger")>(),
  recordProductEvent: mocks.recordProductEvent,
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: mocks.locale }) }) }));

type Exchange = { name: string; path: string; status: number; body: unknown };
const tape = recorded.tape as Exchange[];
const [list, stats] = tape.filter((exchange) => exchange.name === "tracking");
const refused = tape.find((exchange) => exchange.name === "stats-refused")!;
const teamUser = {
  id: "22222222-2222-4222-8222-222222222222",
  email: "team@adbrain.vanshul.com",
  email_confirmed_at: "2026-10-01T00:00:00Z",
};
const credentials = { ...recorded.creds, accessToken: "test-token" };
const otherBusiness = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function connectionFor(id: string): ConnectionDTO {
  return {
    ...connected,
    businessId: id,
    selected: { ...connected.selected!, adAccountId: credentials.adAccountId, pageId: credentials.pageId },
  };
}

function replay(answers: Record<string, { status: number; body: unknown }>) {
  const calls: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    expect(init?.method ?? "GET").toBe("GET");
    const url = new URL(String(input));
    url.searchParams.delete("access_token");
    const path = url.pathname.replace(/^\/v\d+\.\d+\//, "") + url.search;
    calls.push(path);
    const answer = answers[path];
    if (!answer) throw new Error(`Unrecorded Graph call: ${path}`);
    return Response.json(answer.body, { status: answer.status });
  });
  return calls;
}

async function get(query = `businessId=${businessId}`) {
  const { GET } = await import("@/app/api/meta/tracking/route");
  return GET(new Request(`http://localhost/api/meta/tracking?${query}`));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(Date, "now").mockReturnValue(Date.parse(recorded.recordedAt));
  mocks.locale = "en";
  mocks.getUser.mockResolvedValue({ data: { user: teamUser }, error: null });
  mocks.requireOwnedBusiness.mockImplementation(async (id: string) => ({ businessId: id, userId: teamUser.id }));
  mocks.withMetaConnection.mockImplementation(async (
    actor: { businessId: string },
    _options: unknown,
    run: (meta: MetaClient, connection: ConnectionDTO) => unknown,
  ) => run(new MetaClient(credentials), connectionFor(actor.businessId)));
  mocks.getConnectionStatus.mockImplementation(async (actor: { businessId: string }) => connectionFor(actor.businessId));
  mocks.rateLimitResponse.mockResolvedValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();
  resetTrackingStatusCache();
});

describe("core: the owned account's website tracking read (#2714)", () => {
  it("reports Meta's recorded no-pixel reply without inventing a selected pixel", async () => {
    const calls = replay({ [list.path]: { status: 200, body: recorded.noPixels } });
    const response = await get();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toMatchObject({
      ok: true,
      data: {
        businessId, connectionGeneration: 3,
        binding: { adAccountId: credentials.adAccountId, pageId: credentials.pageId },
        status: { state: "none", pixelId: null, pixels: [], counts: null, totalEvents: null },
      },
    });
    expect(body.data).not.toHaveProperty("selectedPixelId");
    expect(calls).toEqual([list.path]);
    expect(mocks.withMetaConnection).toHaveBeenCalledWith(
      expect.objectContaining({ businessId }),
      { purpose: "read_insights", expectedGeneration: 3, binding: { adAccountId: credentials.adAccountId, pageId: credentials.pageId }, event: false },
      expect.any(Function),
    );
    expect(mocks.recordProductEvent).toHaveBeenCalledWith(expect.objectContaining({ name: "meta.tracking", outcome: "success" }));
  });

  it("distinguishes a recorded real zero from unreadable tracking", async () => {
    const calls = replay({ [list.path]: list, [stats.path]: stats });
    const response = await get();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.data.status).toMatchObject({
      state: "quiet", unreadable: null, pixelId: "9000000000000004",
      counts: { Lead: 0, Purchase: 0 }, totalEvents: 0,
    });
    expect(body.data).not.toHaveProperty("selectedPixelId");
    expect(calls).toEqual([list.path, stats.path]);
    expect(JSON.stringify(body)).not.toContain(credentials.accessToken);
  });

  it("accepts provisional positive counts while treating last seen as any event", async () => {
    replay({ [list.path]: list, [stats.path]: { status: 200, body: provisional.leadOnly } });
    const response = await get();
    expect(response.status).toBe(200);
    expect((await response.json()).data.status).toMatchObject({
      state: "ready", counts: { Lead: 2, Purchase: 0 }, totalEvents: 60,
      lastSeenAt: "2026-11-01T14:00:00+0000",
    });
  });

  it("retains an incomplete statistics read as unreadable", async () => {
    replay({ [list.path]: list, [stats.path]: { status: 200, body: { data: provisional.pageViewsOnly.data, paging: { next: "more" } } } });
    const response = await get();
    expect(response.status).toBe(200);
    expect((await response.json()).data.status).toMatchObject({ state: "unreadable", unreadable: "stats_incomplete" });
  });

  it.each([
    ["a refused statistics read", { [list.path]: list, [stats.path]: refused }, "stats_failed"],
    ["an expired connection", { [list.path]: revoked }, "reconnect"],
  ])("reports %s as unreadable, not none or zero", async (_name, answers, reason) => {
    replay(answers);
    const response = await get();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.data.status).toMatchObject({ state: "unreadable", unreadable: reason, counts: null, totalEvents: null });
    expect(mocks.recordProductEvent).toHaveBeenCalledWith(expect.objectContaining({ name: "meta.tracking", outcome: "partial" }));
    expect(JSON.stringify(body)).not.toContain("OAuthException");
    expect(JSON.stringify(body)).not.toContain("Malformed access token");
  });

  it.each([
    ["a malformed pixel list", { [list.path]: { status: 200, body: { data: [{ id: "not-an-id" }] } } }],
    ["an incomplete pixel list", { [list.path]: { status: 200, body: { data: [{ id: "9000000000000004" }], paging: { next: "more" } } }, [stats.path]: stats }],
    ["malformed event counts", { [list.path]: list, [stats.path]: { status: 200, body: { data: [{ data: [{ value: "Lead", count: "invalid" }] }] } } }],
    ["an event without a name", { [list.path]: list, [stats.path]: { status: 200, body: { data: [{ data: [{ count: 2 }] }] } } }],
    ["an event bucket without rows", { [list.path]: list, [stats.path]: { status: 200, body: { data: [{}] } } }],
  ])("does not mistake %s for no pixel or a real zero", async (_name, answers) => {
    replay(answers);
    const response = await get();
    expect(response.status).toBe(200);
    expect((await response.json()).data.status).toMatchObject({
      state: "unreadable", counts: null, totalEvents: null,
    });
  });

  it("uses the business-scoped cache and refreshes it only when requested", async () => {
    const calls = replay({ [list.path]: list, [stats.path]: stats });
    expect((await get()).status).toBe(200);
    expect((await get()).status).toBe(200);
    expect(calls).toEqual([list.path, stats.path]);
    expect((await get(`businessId=${businessId}&fresh=1`)).status).toBe(200);
    expect(calls).toEqual([list.path, stats.path, list.path, stats.path]);
  });

  it("does not share a cached account read with a different business", async () => {
    const calls = replay({ [list.path]: list, [stats.path]: stats });
    expect((await get()).status).toBe(200);
    expect((await get(`businessId=${otherBusiness}`)).status).toBe(200);
    expect(calls).toEqual([list.path, stats.path, list.path, stats.path]);
  });

  it.each([
    ["a different generation", { generation: 4 }],
    ["a different ad account", { selected: { ...connectionFor(businessId).selected!, adAccountId: "act_9000000000000099" } }],
    ["a different Page", { selected: { ...connectionFor(businessId).selected!, pageId: "9000000000000099" } }],
  ])("rejects a result if the connection changes to %s during the read", async (_name, changed) => {
    replay({ [list.path]: list, [stats.path]: stats });
    mocks.getConnectionStatus
      .mockResolvedValueOnce(connectionFor(businessId))
      .mockResolvedValueOnce({ ...connectionFor(businessId), ...changed });
    const response = await get();
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: "CONFLICT", retryable: true } });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});

describe("tracking read boundaries", () => {
  it.each([
    "businessId=bad",
    `businessId=${businessId}&businessId=${otherBusiness}`,
    `businessId=${businessId}&fresh=anything`,
    `businessId=${businessId}&pixelId=123`,
  ])("rejects invalid or ambiguous query %s before Meta", async (query) => {
    expect((await get(query)).status).toBe(400);
    expect(mocks.withMetaConnection).not.toHaveBeenCalled();
  });

  it("requires a signed-in internal account before reading Meta", async () => {
    mocks.getUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    expect((await get()).status).toBe(401);
    mocks.getUser.mockResolvedValueOnce({ data: { user: { ...teamUser, email: "owner@example.com" } }, error: null });
    expect((await get()).status).toBe(403);
    expect(mocks.withMetaConnection).not.toHaveBeenCalled();
  });

  it("reports an auth outage as unavailable, not signed out", async () => {
    mocks.getUser.mockResolvedValueOnce({ data: { user: null }, error: new Error("private auth detail") });
    const response = await get();
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private auth detail");
    expect(mocks.requireOwnedBusiness).not.toHaveBeenCalled();
  });

  it("refuses a different business without reading Meta", async () => {
    mocks.requireOwnedBusiness.mockRejectedValue(new ConnectionAccessError("FORBIDDEN", "not yours"));
    const response = await get(`businessId=${otherBusiness}`);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect(mocks.withMetaConnection).not.toHaveBeenCalled();
  });

  it("fails closed if the authenticated identity changes between checks", async () => {
    mocks.requireOwnedBusiness.mockResolvedValue({ businessId, userId: "33333333-3333-4333-8333-333333333333" });
    expect((await get()).status).toBe(403);
    expect(mocks.withMetaConnection).not.toHaveBeenCalled();
  });

  it("reports an already revoked OAuth connection as needing reconnection before Meta", async () => {
    mocks.getConnectionStatus.mockResolvedValue({ ...connectionFor(businessId), authorization: "reauth_required" });
    const response = await get();
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: "REAUTH_REQUIRED", retryable: false } });
    expect(mocks.withMetaConnection).not.toHaveBeenCalled();
  });

  it("returns an explicit failure for a business lookup or Meta connection failure", async () => {
    mocks.requireOwnedBusiness.mockRejectedValueOnce(new Error("private database detail"));
    const first = await get();
    expect(first.status).toBe(503);
    expect(await first.text()).not.toContain("private database detail");
    expect(mocks.withMetaConnection).not.toHaveBeenCalled();

    mocks.withMetaConnection.mockRejectedValueOnce(new Error("private provider detail"));
    const second = await get();
    expect(second.status).toBe(503);
    const body = await second.text();
    expect(body).toContain('"code":"UNAVAILABLE"');
    expect(body).not.toContain("private provider detail");
    expect(second.headers.get("cache-control")).toBe("no-store");
  });

  it.each([
    ["UNAUTHENTICATED", 401],
    ["FORBIDDEN", 403],
    ["NOT_FOUND", 404],
    ["CONFLICT", 409],
    ["UNAVAILABLE", 503],
  ] as const)("preserves a %s connection access failure as HTTP %i", async (code, status) => {
    mocks.withMetaConnection.mockRejectedValueOnce(new ConnectionAccessError(code, "private provider detail"));
    const response = await get();
    expect(response.status).toBe(status);
    const body = await response.text();
    expect(body).toContain(`"code":"${code}"`);
    expect(body).not.toContain("private provider detail");
  });

  it("returns rate-limit failures as typed, no-store errors without contacting Meta", async () => {
    mocks.rateLimitResponse.mockResolvedValue(Response.json({ error: "limited" }, { status: 429, headers: { "Retry-After": "30" } }));
    const response = await get();
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("30");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ ok: false, error: { code: "RATE_LIMITED", retryable: true } });
    expect(mocks.withMetaConnection).not.toHaveBeenCalled();
  });
});
