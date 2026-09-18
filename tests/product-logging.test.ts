import { afterEach, describe, expect, it, vi } from "vitest";
import { observeAction, observeRoute, recordProductEvent } from "@/lib/observability/logger";
import { observeIdentity } from "@/lib/observability/context";

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "11111111-1111-4111-8111-111111111111" } }, error: null }) } }) }));

const userId = "11111111-1111-4111-8111-111111111111";
const businessId = "22222222-2222-4222-8222-222222222222";
const persistence = vi.hoisted(() => ({ callbacks: [] as Array<() => Promise<void>>, persist: vi.fn() }));
vi.mock("next/server", () => ({ after: (callback: () => Promise<void>) => persistence.callbacks.push(callback) }));
vi.mock("@/lib/observability/store", () => ({ persistProductEvents: persistence.persist }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("request product logging", () => {
  it("flushes after failed requests and contains persistence errors", async () => {
    vi.stubEnv("PRODUCT_LOGGING_DATABASE_ENABLED", "true");
    persistence.callbacks.length = 0;
    persistence.persist.mockRejectedValueOnce(new Error("private database details"));
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    const handler = observeRoute("/api/campaigns", "POST", async () => { throw new Error("original failure"); });
    await expect(handler()).rejects.toThrow("original failure");
    expect(persistence.callbacks).toHaveLength(1);
    await expect(persistence.callbacks[0]()).resolves.toBeUndefined();
    expect(warning.mock.calls[0][0]).toContain("PERSIST_FAILED");
    expect(warning.mock.calls[0][0]).not.toContain("private database details");
  });

  it("records rejected server actions without logging their error text", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const result = await observeAction("creative.approve", async () => ({ ok: false, error: "private content" }));
    expect(result.ok).toBe(false);
    expect(JSON.parse(log.mock.calls[0][0])).toMatchObject({ userId, kind: "action", outcome: "rejected" });
    expect(log.mock.calls[0][0]).not.toContain("private content");
  });

  it("correlates safe workflow and request events with verified identity", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const route = observeRoute("/api/creatives/generate", "POST", async () => {
      observeIdentity(userId, businessId);
      recordProductEvent({ kind: "workflow", name: "creative.batch", outcome: "partial", attributes: { count: 2, failedCount: 1 } });
      return Response.json({ prompt: "private content" }, { status: 200 });
    });
    const response = await route();
    const events = log.mock.calls.map(([line]) => JSON.parse(line));
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ userId, businessId, outcome: "partial" });
    expect(events[1]).toMatchObject({ requestId: events[0].requestId, userId, businessId, durationMs: expect.any(Number) });
    expect(response.headers.get("X-Request-Id")).toBe(events[0].requestId);
    expect(JSON.stringify(events)).not.toContain("private content");
  });

  it("keeps concurrent accounts isolated", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const handler = observeRoute("/api/campaigns", "GET", async (id: string | null) => {
      observeIdentity(id);
      await Promise.resolve();
      return Response.json({});
    });
    await Promise.all([handler(userId), handler(null)]);
    const events = log.mock.calls.map(([line]) => JSON.parse(line));
    expect(events.map(event => event.userId)).toEqual([userId, null]);
    expect(new Set(events.map(event => event.requestId)).size).toBe(2);
  });

  it("records exceptions without leaking their contents or changing the thrown value", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const error = new Error("secret provider token");
    const handler = observeRoute("/api/creatives/generate", "POST", async () => { throw error; });
    await expect(handler()).rejects.toBe(error);
    expect(log.mock.calls[0][0]).not.toContain("secret");
    expect(JSON.parse(log.mock.calls[0][0])).toMatchObject({ outcome: "failed", attributes: { errorCode: "UNHANDLED_EXCEPTION" } });
  });

  it("supports a complete logging kill switch", async () => {
    vi.stubEnv("PRODUCT_LOGGING_ENABLED", "false");
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    await observeRoute("/api/test", "GET", async () => new Response(null, { status: 401 }))();
    expect(log).not.toHaveBeenCalled();
  });
});