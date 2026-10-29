import { beforeEach, describe, expect, it, vi } from "vitest";

// #2036: the results card renders and records events only for the owner, only while it is offered.
const h = vi.hoisted(() => ({
  recorded: [] as Array<{ name: string; businessId?: string }>,
  offered: true,
  owned: vi.fn(),
  footer: [] as boolean[],
  limited: null as Response | null,
}));
vi.mock("@/lib/observability/logger", async (actual) => ({
  ...(await actual<object>()),
  recordProductEvent: (event: (typeof h.recorded)[number]) => h.recorded.push(event),
}));
vi.mock("@/services/business-access", async () => ({
  requireOwnedBusiness: h.owned,
  ConnectionAccessError: (await import("@/lib/meta/connection-access-error")).ConnectionAccessError,
}));
vi.mock("@/lib/security/rate-limit", () => ({ rateLimitResponse: async () => h.limited }));
vi.mock("@/lib/results-card/store", () => ({
  resultsCardFacts: async () => ({ offered: h.offered, enquiries: 6, area: "Sector 70" }),
  resultsCardInput: async (_facts: unknown, _id: string, footer: boolean) => { h.footer.push(footer); return {}; },
}));
vi.mock("@/lib/results-card/render", () => ({ renderResultsCard: async () => new Uint8Array([0xff, 0xd8, 0xff]) }));

const businessId = "11111111-1111-4111-8111-111111111111";
const route = () => import("@/app/api/results-card/route");
const get = async (query: string) => (await route()).GET(new Request(`https://app.test/api/results-card?${query}`));
const post = async (body: unknown) => (await route()).POST(new Request("https://app.test/api/results-card", { method: "POST", body: JSON.stringify(body) }));

beforeEach(async () => {
  h.recorded = []; h.offered = true; h.footer = []; h.limited = null;
  const { ConnectionAccessError } = await import("@/services/business-access");
  h.owned.mockReset().mockImplementation(async (id: string) => {
    if (id !== businessId) throw new ConnectionAccessError("NOT_FOUND", "Business not found");
    return { businessId: id, userId: "owner" };
  });
});

describe("GET /api/results-card (#2036)", () => {
  it("returns the owner's card as a private JPEG, with the footer unless switched off", async () => {
    const response = await get(`businessId=${businessId}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(new Uint8Array(await response.arrayBuffer()).slice(0, 2)).toEqual(new Uint8Array([0xff, 0xd8]));
    await get(`businessId=${businessId}&footer=0`);
    expect(h.footer).toEqual([true, false]);
  });

  it("refuses another business, a bad id, a week under the floor and a rate-limited owner", async () => {
    expect((await get("businessId=22222222-2222-4222-8222-222222222222")).status).toBe(404);
    expect((await get("businessId=nope")).status).toBe(400);
    h.limited = new Response(null, { status: 429 });
    expect((await get(`businessId=${businessId}`)).status).toBe(429);
    h.limited = null; h.offered = false;
    expect((await get(`businessId=${businessId}`)).status).toBe(409);
  });
});

describe("POST /api/results-card (#2036)", () => {
  it.each([["shown", "results_card.shown"], ["shared", "results_card.shared"], ["dismissed", "results_card.dismissed"]])("records %s", async (event, name) => {
    expect((await post({ businessId, event })).status).toBe(200);
    expect(h.recorded).toEqual([expect.objectContaining({ name, businessId })]);
  });

  it("records nothing for another business, an unknown event or a card that isn't offered", async () => {
    expect((await post({ businessId: "22222222-2222-4222-8222-222222222222", event: "shared" })).status).toBe(404);
    expect((await post({ businessId, event: "liked" })).status).toBe(400);
    h.offered = false;
    expect((await post({ businessId, event: "shared" })).status).toBe(409);
    expect(h.recorded).toEqual([]);
  });
});
