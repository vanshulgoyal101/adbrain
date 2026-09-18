import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/creatives/assistant/route";
import { complete } from "@/lib/llm";

const mocks = vi.hoisted(() => ({ getUser: vi.fn(), business: vi.fn(), rate: vi.fn(), usage: vi.fn(), persist: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: mocks.getUser },
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.business }) }) }),
}) }));
vi.mock("@/lib/supabase/queries", () => ({ getActiveInstructionsText: async () => "Only saved offers" }));
vi.mock("@/lib/security/rate-limit", () => ({ rateLimitResponse: mocks.rate }));
vi.mock("@/lib/llm", () => ({ complete: vi.fn(), parseJSON: JSON.parse, NoLLMKeysError: class extends Error {} }));
vi.mock("@/lib/llm/persist", () => ({ configuredMonthlyTokenLimit: () => 1000, monthlyTokenUsage: mocks.usage, persistLLMUsage: mocks.persist }));
const reply = (value: unknown) => ({ text: JSON.stringify(value), provider: "test", model: "test", usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 } });

function request(body: unknown) {
  return new Request("http://localhost/api/creatives/assistant", { method: "POST", body: JSON.stringify(body) });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: { id: "owner" } } });
  mocks.business.mockResolvedValue({ data: { name: "Acme", locations: ["Austin, Texas"] } });
  mocks.rate.mockResolvedValue(null);
  mocks.usage.mockResolvedValue(0);
});

describe("creative assistant boundary", () => {
  it.each([null, [], { businessId: 42, goal: "ad" }, { businessId: "biz", goal: "x".repeat(2001) }, { businessId: "biz", goal: "ad", answers: [{ question: "Offer?", answer: {} }] }])("rejects malformed input before model access: %j", async (body) => {
    expect((await POST(request(body))).status).toBe(400);
    expect(complete).not.toHaveBeenCalled();
    expect(mocks.business).not.toHaveBeenCalled();
  });

  it("requires authentication and owner-visible business", async () => {
    mocks.getUser.mockResolvedValueOnce({ data: { user: null } });
    expect((await POST(request({ businessId: "biz", goal: "ad" }))).status).toBe(401);
    mocks.business.mockResolvedValueOnce({ data: null });
    expect((await POST(request({ businessId: "biz", goal: "ad" }))).status).toBe(404);
    expect(complete).not.toHaveBeenCalled();
  });

  it("returns bounded validated questions with semantic history intact", async () => {
    vi.mocked(complete).mockResolvedValue(reply({ ready: false, question: { id: "scene", field: "visual", question: "Which scene?", options: ["Team", "Product"] } }));
    const response = await POST(request({ businessId: "biz", goal: "ad", answers: [{ question: "Audience?", answer: "Homeowners", field: "audience", questionId: "audience", options: ["Homeowners", "Installers"] }] }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ ready: false, question: { field: "visual" }, promptVersion: "interview-v2" });
    expect(vi.mocked(complete).mock.calls[0][0][1].content).toContain('"field":"audience"');
    expect(mocks.persist).toHaveBeenCalledWith([expect.objectContaining({ route: "creatives.assistant", promptVersion: "interview-v2", status: "success", usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 } })]);
  });

  it("never silently generates from malformed model output", async () => {
    vi.mocked(complete).mockResolvedValue(reply({ ready: false }));
    const response = await POST(request({ businessId: "biz", goal: "ad" }));
    expect(response.status).toBe(502);
    expect(await response.json()).not.toHaveProperty("brief");
    expect(complete).toHaveBeenCalledTimes(2);
    expect(mocks.persist).toHaveBeenCalledTimes(2);
  });

  it.each([[null, 503], [1000, 429]])("blocks interviews when usage is %s", async (used, status) => {
    mocks.usage.mockResolvedValue(used);
    expect((await POST(request({ businessId: "biz", goal: "ad" }))).status).toBe(status);
    expect(complete).not.toHaveBeenCalled();
  });
});