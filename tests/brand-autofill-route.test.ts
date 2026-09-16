import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/brand/autofill/route";

const { getUser, rateLimitResponse, completeJSON, fetchPublicUrlText } = vi.hoisted(() => ({
  getUser: vi.fn(), rateLimitResponse: vi.fn(), completeJSON: vi.fn(), fetchPublicUrlText: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser } }) }));
vi.mock("@/lib/security/rate-limit", () => ({ rateLimitResponse }));
vi.mock("@/lib/llm", () => ({ completeJSON, NoLLMKeysError: class extends Error {} }));
vi.mock("@/lib/security/ssrf", async (original) => ({
  ...await original<typeof import("@/lib/security/ssrf")>(), fetchPublicUrlText,
}));

const request = (body: unknown) => new Request("https://adbrain.example/api/brand/autofill", {
  method: "POST", body: JSON.stringify(body),
});

beforeEach(() => {
  vi.resetAllMocks();
  getUser.mockResolvedValue({ data: { user: { id: "owner" } } });
  rateLimitResponse.mockResolvedValue(null);
  fetchPublicUrlText.mockResolvedValue("<html><body>Example local service</body></html>");
  completeJSON.mockResolvedValue({ description: "Example local service" });
});

describe("brand autofill boundary", () => {
  it.each([null, [], { url: 1 }, { url: {} }, { url: "" }, { url: "a".repeat(2049) }, { url: "http://localhost./" }])(
    "rejects invalid input before fetching or invoking AI: %j", async (body) => {
      expect((await POST(request(body))).status).toBe(400);
      expect(fetchPublicUrlText).not.toHaveBeenCalled();
      expect(completeJSON).not.toHaveBeenCalled();
    },
  );

  it("requires authentication before fetching", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    expect((await POST(request({ url: "example.com" }))).status).toBe(401);
    expect(fetchPublicUrlText).not.toHaveBeenCalled();
  });

  it("honors rate limiting before fetching", async () => {
    rateLimitResponse.mockResolvedValue(new Response(null, { status: 429 }));
    expect((await POST(request({ url: "example.com" }))).status).toBe(429);
    expect(fetchPublicUrlText).not.toHaveBeenCalled();
  });

  it("extracts a public website using the budget pool", async () => {
    const response = await POST(request({ url: "example.com" }));
    expect(response.status).toBe(200);
    expect(completeJSON).toHaveBeenCalledWith(expect.any(Array), expect.objectContaining({ routing: "budget" }));
  });

  it("does not expose provider diagnostics to the browser", async () => {
    completeJSON.mockRejectedValue(new Error("private upstream details"));
    const response = await POST(request({ url: "example.com" }));
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain("private upstream details");
  });
});