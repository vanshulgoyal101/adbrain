import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/preferences/route";

const mocks = vi.hoisted(() => ({ getUser: vi.fn(), business: vi.fn(), rpc: vi.fn(), state: vi.fn(), rate: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: mocks.getUser },
  from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: mocks.business }) }) }) }),
  rpc: mocks.rpc,
}) }));
vi.mock("@/lib/preferences/store", () => ({ readPreferenceState: mocks.state }));
vi.mock("@/lib/security/rate-limit", () => ({ rateLimitResponse: mocks.rate }));

const businessId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const state = { enabled: true, epoch: 3, notes: [{ category: "language", value: "Usually Hinglish" }] };
const request = (body: unknown) => new Request("http://localhost/api/preferences", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: { id: "11111111-1111-4111-8111-111111111111" } } });
  mocks.business.mockResolvedValue({ data: { id: businessId } });
  mocks.state.mockResolvedValue(state);
  mocks.rate.mockResolvedValue(null);
  mocks.rpc.mockResolvedValue({ data: 4, error: null });
});

describe("declared preference API", () => {
  it("rejects absent authentication and a business outside the owner scope", async () => {
    mocks.getUser.mockResolvedValueOnce({ data: { user: null } });
    expect((await GET(new Request(`http://localhost/api/preferences?businessId=${businessId}`))).status).toBe(401);
    mocks.business.mockResolvedValueOnce({ data: null });
    expect((await GET(new Request(`http://localhost/api/preferences?businessId=${businessId}`))).status).toBe(404);
    expect(mocks.state).not.toHaveBeenCalled();
  });

  it("returns the owner-visible saved state without caching", async () => {
    const response = await GET(new Request(`http://localhost/api/preferences?businessId=${businessId}`));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual(state);
  });

  it("passes an epoch-fenced explicit edit and reports a stale write honestly", async () => {
    const body = { businessId, operation: "save", expectedEpoch: 3, category: "language", value: "Usually English" };
    expect((await POST(request(body))).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("change_declared_preferences", {
      p_business_id: businessId, p_operation: "save", p_expected_epoch: 3,
      p_category: "language", p_value: "Usually English",
    });
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "40001", message: "stale" } });
    const response = await POST(request(body));
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/reload/i);
    expect(mocks.state).toHaveBeenCalledTimes(1);
  });

  it("rejects an unbounded or missing preference without invoking the RPC", async () => {
    expect((await POST(request({ businessId, operation: "save", expectedEpoch: 0, category: "tone", value: "x".repeat(161) }))).status).toBe(400);
    expect((await POST(request({ businessId, operation: "forget", expectedEpoch: 0 }))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});