import { beforeEach, describe, expect, it, vi } from "vitest";
import { AD_ANGLES } from "@/lib/templates/ads";

const mocks = vi.hoisted(() => ({
  generateVariants: vi.fn(),
  generateOneVariant: vi.fn(),
  insert: vi.fn(),
  render: vi.fn(),
  instructions: vi.fn(),
  references: vi.fn(),
  recentCopy: vi.fn(),
  schemaError: null as unknown,
  used: 0 as number | null,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "owner" } } }) },
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { id: "business", name: "Example" },
          }),
        }),
        limit: async () => ({ error: mocks.schemaError }),
      }),
      insert: (row: unknown) => {
        mocks.insert(table, row);
        return {
          select: () => ({
            single: async () => ({
              data: { id: "creative", ...(row as object) },
              error: null,
            }),
          }),
        };
      },
    }),
  }),
}));
vi.mock("@/lib/creative/generate", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/creative/generate")>()),
  generateVariants: mocks.generateVariants,
  generateOneVariant: mocks.generateOneVariant,
}));
vi.mock("@/lib/creative/references", () => ({
  creativeReferences: mocks.references,
  recentCreativeCopy: mocks.recentCopy,
}));
vi.mock("@/lib/creative/persist", () => ({
  persistCreativeImage: async () => "https://cdn.example/photo.png",
  renderAndPersistDesign: mocks.render,
}));
vi.mock("@/lib/llm/persist", () => ({
  configuredMonthlyTokenLimit: () => 1000,
  monthlyTokenUsage: async () => mocks.used,
  persistLLMUsage: async () => {},
}));
vi.mock("@/lib/supabase/queries", () => ({
  getActiveInstructionsText: mocks.instructions,
}));
vi.mock("@/lib/security/rate-limit", () => ({
  rateLimitResponse: async () => null,
}));
vi.mock("@/lib/audit", () => ({ logEvent: async () => {} }));

const variant = {
  angleId: "value",
  angleName: "Value",
  headline: "Thoughtful installation",
  primaryText: "Book a consultation.",
  cta: "Book Now",
  imageUrl: "data:image/png;base64,test",
  imagePrompt: "Model-directed installation scene",
  concept: { rationale: "Show the work", description: "Discuss your installation." },
  llmUsage: [],
  imageUsage: {
    provider: "openrouter-image",
    model: "paid-image",
    width: 1024,
    height: 1536,
  },
  design: { format: "story" },
};
const request = (
  body: unknown = {
    businessId: "business",
    brief: "Installation",
    format: "story",
  },
) =>
  new Request("http://localhost/api/creatives/generate", {
    method: "POST",
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  mocks.schemaError = null;
  mocks.used = 0;
  mocks.render.mockResolvedValue("https://cdn.example/finished.png");
  mocks.instructions.mockResolvedValue("No discounts");
  mocks.references.mockResolvedValue(["https://example.com/product.png"]);
  mocks.recentCopy.mockResolvedValue([{ headline: "Previous ad", primary_text: "Previous opening" }]);
  mocks.generateVariants.mockImplementation(async (params) => {
    try {
      await params.onVariant(variant);
    } catch (error) {
      await params.onFailure(AD_ANGLES[0], error);
    }
    await params.onFailure(AD_ANGLES[1], new Error("Image unavailable"));
    return [variant];
  });
});

describe("creative generation route", () => {
  it("stops before paid generation when saved instructions cannot be loaded", async () => {
    mocks.instructions.mockRejectedValueOnce(new Error("private database detail"));
    const { POST } = await import("@/app/api/creatives/generate/route");
    const response = await POST(request());
    expect(response.status).toBe(502);
    expect(mocks.generateVariants).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(await response.text()).not.toContain("private database detail");
  });

  it("stops before paid regeneration when saved instructions cannot be loaded", async () => {
    mocks.instructions.mockRejectedValueOnce(new Error("private database detail"));
    const { POST } = await import("@/app/api/creatives/[id]/regenerate/route");
    const response = await POST(request(), { params: Promise.resolve({ id: "creative" }) });
    expect(response.status).toBe(502);
    expect(mocks.generateOneVariant).not.toHaveBeenCalled();
    expect(mocks.render).not.toHaveBeenCalled();
    expect(await response.text()).not.toContain("private database detail");
  });

  it("stops before paid generation when recent copy cannot be loaded", async () => {
    mocks.recentCopy.mockRejectedValueOnce(new Error("History unavailable"));
    const { POST } = await import("@/app/api/creatives/generate/route");
    expect((await POST(request())).status).toBe(502);
    expect(mocks.generateVariants).not.toHaveBeenCalled();
  });

  it("loads independent context together and composites the in-memory source", async () => {
    let resolveInstructions!: (value: string) => void;
    mocks.instructions.mockReturnValue(new Promise<string>(resolve => { resolveInstructions = resolve; }));
    const { POST } = await import("@/app/api/creatives/generate/route");
    const response = POST(request());
    await vi.waitFor(() => expect(mocks.references).toHaveBeenCalled());
    expect(mocks.generateVariants).not.toHaveBeenCalled();
    resolveInstructions("No discounts");
    expect((await response).status).toBe(200);
    expect(mocks.render).toHaveBeenCalledWith(expect.anything(), "business", expect.any(String), variant.angleId, variant.design, "https://cdn.example/photo.png", variant.imageUrl);
  });

  it("does not expose upstream error bodies from regeneration", async () => {
    mocks.generateOneVariant.mockRejectedValueOnce(new Error("token=private-test-secret and private prompt"));
    const { POST } = await import("@/app/api/creatives/[id]/regenerate/route");
    const response = await POST(request(), { params: Promise.resolve({ id: "creative" }) });
    expect(response.status).toBe(502);
    expect(mocks.generateOneVariant).toHaveBeenCalledOnce();
    expect(mocks.generateOneVariant.mock.calls[0][8]).toContainEqual({ headline: "Previous ad", primary_text: "Previous opening" });
    expect(await response.text()).not.toMatch(/private-test-secret|private prompt/);
  });

  it("does not expose upstream error bodies from total failures", async () => {
    mocks.generateVariants.mockRejectedValue(new Error("Provider failed with token=private-test-secret and private prompt"));
    const { POST } = await import("@/app/api/creatives/generate/route");
    const response = await POST(request());
    expect(response.status).toBe(502);
    expect(await response.text()).not.toMatch(/private-test-secret|private prompt/);
  });

  it("does not expose upstream error bodies from partial failures", async () => {
    mocks.generateVariants.mockImplementation(async (params) => {
      await params.onVariant(variant);
      await params.onFailure(AD_ANGLES[1], new Error("token=private-test-secret and private prompt"));
    });
    const { POST } = await import("@/app/api/creatives/generate/route");
    const response = await POST(request());
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain("failures");
    expect(body).not.toMatch(/private-test-secret|private prompt/);
  });
  it("uses the client generation id as the persisted variant group", async () => {
    const { POST } = await import("@/app/api/creatives/generate/route");
    const response = await POST(request({
      businessId: "business",
      brief: "Installation",
      format: "story",
      generationId: "11111111-1111-4111-8111-111111111111",
    }));
    expect(response.status).toBe(200);
    expect(mocks.insert.mock.calls[0][1]).toMatchObject({
      variant_group: "11111111-1111-4111-8111-111111111111",
    });
  });

  it("saves completed variants and their receipt while reporting failed siblings", async () => {
    const { POST } = await import("@/app/api/creatives/generate/route");
    const response = await POST(request());
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.creatives).toHaveLength(1);
    expect(data.failures).toHaveLength(1);
    expect(mocks.insert.mock.calls[0][1]).toMatchObject({
      image_url: "https://cdn.example/finished.png",
      generation: {
        format: "story",
        concept: { description: "Discuss your installation." },
        image: { model: "paid-image", estimatedCostUsd: null },
      },
    });
    expect(mocks.generateVariants.mock.calls[0][0]).toMatchObject({
      format: "story",
      referenceImages: ["https://example.com/product.png"],
      recentCopy: [{ headline: "Previous ad", primary_text: "Previous opening" }],
    });
  });

  it("does not insert a raw photo when composition fails", async () => {
    mocks.render.mockRejectedValue(new Error("Composition failed"));
    const { POST } = await import("@/app/api/creatives/generate/route");
    expect((await POST(request())).status).toBe(502);
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("checks migration availability before paid calls", async () => {
    mocks.schemaError = { code: "42703" };
    const { POST } = await import("@/app/api/creatives/generate/route");
    expect((await POST(request())).status).toBe(503);
    expect(mocks.generateVariants).not.toHaveBeenCalled();
  });

  it("fails closed when quota cannot be verified", async () => {
    mocks.used = null;
    const { POST } = await import("@/app/api/creatives/generate/route");
    expect((await POST(request())).status).toBe(503);
    expect(mocks.generateVariants).not.toHaveBeenCalled();
  });

  it.each([
    { businessId: 12 },
    { businessId: "business", brief: {}, count: 3 },
    { businessId: "business", brief: "x", count: 100 },
  ])("rejects malformed requests before spending", async (body) => {
    const { POST } = await import("@/app/api/creatives/generate/route");
    expect((await POST(request(body))).status).toBe(400);
    expect(mocks.generateVariants).not.toHaveBeenCalled();
  });
});
