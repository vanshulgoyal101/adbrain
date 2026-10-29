import { beforeEach, describe, expect, it, vi } from "vitest";

// #1650: the owner's answer is one product event per business, codes only; 'Not now' is its own event.
const h = vi.hoisted(() => ({
  recorded: [] as Array<{ kind: string; name: string; businessId?: string; attributes?: Record<string, unknown> }>,
  events: [] as Array<{ name: string; created_at: string }>,
  launchedAt: "2026-10-01T09:00:00Z" as string | null,
  exempt: false,
  owned: vi.fn(),
}));
vi.mock("@/lib/observability/logger", async (actual) => ({
  ...(await actual<object>()),
  recordProductEvent: (event: (typeof h.recorded)[number]) => h.recorded.push(event),
}));
vi.mock("@/lib/meta/connection-access", () => ({
  requireOwnedBusiness: h.owned,
  ConnectionAccessError: class extends Error { constructor(public code: string, message: string) { super(message); } },
}));
vi.mock("@/lib/feedback/pilot-day7-store", () => ({
  pilotDay7Facts: async () => ({ exempt: h.exempt, firstLaunchAt: h.launchedAt, events: h.events }),
}));

const businessId = "11111111-1111-4111-8111-111111111111";
const post = async (body: unknown) => {
  const { POST } = await import("@/app/api/feedback/pilot-day7/route");
  const response = await POST(new Request("https://app.test/api/feedback/pilot-day7", { method: "POST", body: JSON.stringify(body) }));
  return { status: response.status, body: await response.json() };
};

beforeEach(() => {
  h.recorded = []; h.events = []; h.launchedAt = new Date(Date.now() - 8 * 86_400_000).toISOString(); h.exempt = false;
  h.owned.mockReset().mockImplementation(async (id: string) => ({ businessId: id, userId: "owner" }));
});

describe("POST /api/feedback/pilot-day7 (#1650)", () => {
  it("records one answer with its reason and the days since the first Go live", async () => {
    expect(await post({ businessId, answer: "maybe", reason: "too_expensive" })).toMatchObject({ status: 200, body: { ok: true } });
    expect(h.recorded).toEqual([expect.objectContaining({ kind: "action", name: "pilot_day7", businessId,
      attributes: expect.objectContaining({ answer: "maybe", reason: "too_expensive", days: 8 }) })]);
  });

  it("records 'Not now' as a dismissal", async () => {
    expect((await post({ businessId, dismiss: true })).status).toBe(200);
    expect(h.recorded).toEqual([expect.objectContaining({ name: "pilot_day7.dismissed", businessId })]);
  });

  it.each([
    ["an answer that isn't offered", { businessId, answer: "sure", reason: "saves_time" }],
    ["a reason from the other list", { businessId, answer: "yes", reason: "too_expensive" }],
    ["free text", { businessId, answer: "no", reason: "other", note: "my number is 98765" }],
    ["no business", { answer: "yes", reason: "saves_time" }],
  ])("rejects %s", async (_label, body) => {
    expect((await post(body)).status).toBe(400);
    expect(h.recorded).toEqual([]);
  });

  it("takes one answer per business, and nothing from an exempt business or before day 7", async () => {
    h.events = [{ name: "pilot_day7", created_at: new Date().toISOString() }];
    expect((await post({ businessId, answer: "yes", reason: "saves_time" })).status).toBe(409);
    h.events = [];
    h.exempt = true;
    expect((await post({ businessId, answer: "yes", reason: "saves_time" })).status).toBe(409);
    h.exempt = false;
    h.launchedAt = new Date(Date.now() - 2 * 86_400_000).toISOString();
    expect((await post({ businessId, answer: "yes", reason: "saves_time" })).status).toBe(409);
    expect(h.recorded).toEqual([]);
  });

  it("refuses another owner's business", async () => {
    const { ConnectionAccessError } = await import("@/lib/meta/connection-access");
    h.owned.mockRejectedValue(new ConnectionAccessError("FORBIDDEN", "no"));
    expect((await post({ businessId, answer: "yes", reason: "saves_time" })).status).toBe(403);
    expect(h.recorded).toEqual([]);
  });
});
