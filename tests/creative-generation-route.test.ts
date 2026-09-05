import { beforeEach, describe, expect, it, vi } from "vitest";
import { AD_ANGLES } from "@/lib/templates/ads";

const mocks = vi.hoisted(() => ({
  generateVariants: vi.fn(),
  insert: vi.fn(),
  render: vi.fn(),
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
}));
vi.mock("@/lib/creative/references", () => ({
  creativeReferences: async () => ["https://example.com/product.png"],
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
  getActiveInstructionsText: async () => "No discounts",
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
  concept: { rationale: "Show the work" },
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
        image: { model: "paid-image", estimatedCostUsd: null },
      },
    });
    expect(mocks.generateVariants.mock.calls[0][0]).toMatchObject({
      format: "story",
      referenceImages: ["https://example.com/product.png"],
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
