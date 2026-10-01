import { beforeEach, describe, expect, it, vi } from "vitest";
import { AD_ANGLES } from "@/lib/templates/ads";
import { NoLLMKeysError } from "@/lib/llm";

const mocks = vi.hoisted(() => ({
  generateVariants: vi.fn(),
  generateOneVariant: vi.fn(),
  insert: vi.fn(),
  render: vi.fn(),
  instructions: vi.fn(),
  references: vi.fn(),
  recentCopy: vi.fn(),
  schemaError: null as unknown,
  saveError: false,
  used: 0 as number | null,
  admitted: new Map<string, { business: string; hash: string }>(),
  states: new Map<string, string>(),
  persist: vi.fn(),
  progress: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: async (name: string, args: { p_generation_id: string; p_business_id: string; p_request_hash?: string; p_complete?: boolean; p_uncertain?: boolean }) => {
      if (name === "creative_generation_progress") {
        mocks.progress(args);
        const status = args.p_uncertain ? "unresolved" : args.p_complete ? "complete" : "processing";
        mocks.states.set(args.p_generation_id, status);
        return { data: { status }, error: null };
      }
      if (mocks.used === null) return { data: null, error: { message: "Unavailable" } };
      const existing = mocks.admitted.get(args.p_generation_id);
      const action = existing ? existing.business !== args.p_business_id ? "missing" :
        existing.hash !== args.p_request_hash ? "conflict" : "recover" : "start";
      if (!existing) mocks.admitted.set(args.p_generation_id, { business: args.p_business_id, hash: args.p_request_hash ?? "" });
      return { data: { action, status: mocks.states.get(args.p_generation_id) ?? "processing" }, error: null };
    },
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "owner" } } }) },
    from: (table: string) => ({
      select: () => ({
        eq: (_key: string, value: string) => ({
          maybeSingle: async () => ({
            data: { id: table === "businesses" ? value : "business", name: "Example" },
          }),
        }),
        limit: async () => ({ error: mocks.schemaError }),
      }),
      insert: (row: unknown) => {
        mocks.insert(table, row);
        return {
          select: () => ({
            single: async () => ({
              data: mocks.saveError ? null : { id: "creative", ...(row as object) },
              error: mocks.saveError ? { message: "Unavailable" } : null,
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
  persistLLMUsage: mocks.persist,
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
  mocks.admitted.clear();
  mocks.states.clear();
  mocks.saveError = false;
  mocks.persist.mockResolvedValue(true);
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

  it("does not launch a second paid generation for a repeated identity", async () => {
    const { POST } = await import("@/app/api/creatives/generate/route");
    const payload = { businessId: "business", brief: "Installation", format: "story", generationId: "11111111-1111-4111-8111-111111111111" };
    expect((await POST(request(payload))).status).toBe(200);
    expect((await POST(request(payload))).status).toBe(202);
    expect(mocks.generateVariants).toHaveBeenCalledTimes(1);
  });

  it("admits just one producer when two handlers race with the same identity", async () => {
    const { POST } = await import("@/app/api/creatives/generate/route");
    const payload = { businessId: "business", brief: "Installation", format: "story", generationId: "11111111-1111-4111-8111-111111111111" };
    const responses = await Promise.all([POST(request(payload)), POST(request(payload))]);
    expect(responses.map(response => response.status).sort()).toEqual([200, 202]);
    expect(mocks.generateVariants).toHaveBeenCalledTimes(1);
  });

  it("rejects a reused generation identity with a changed brief, count or format", async () => {
    const { POST } = await import("@/app/api/creatives/generate/route");
    const base = { businessId: "business", brief: "Installation", format: "story", generationId: "11111111-1111-4111-8111-111111111111" };
    expect((await POST(request(base))).status).toBe(200);
    for (const change of [{ brief: "Different" }, { count: 2 }, { format: "square" }])
      expect((await POST(request({ ...base, ...change }))).status).toBe(409);
    expect(mocks.generateVariants).toHaveBeenCalledTimes(1);
  });

  it("hides a claimed generation ID from a different owned business", async () => {
    const { POST } = await import("@/app/api/creatives/generate/route");
    const payload = { businessId: "business", brief: "Installation", format: "story", generationId: "11111111-1111-4111-8111-111111111111" };
    expect((await POST(request(payload))).status).toBe(200);
    expect((await POST(request({ ...payload, businessId: "other-business" }))).status).toBe(404);
    expect(mocks.generateVariants).toHaveBeenCalledTimes(1);
  });

  it("retains an unresolved hold after paid work cannot be saved", async () => {
    mocks.saveError = true;
    const { POST } = await import("@/app/api/creatives/generate/route");
    const payload = { businessId: "business", brief: "Installation", format: "story", generationId: "11111111-1111-4111-8111-111111111111" };
    expect((await POST(request(payload))).status).toBe(502);
    expect(mocks.progress.mock.calls.some(([args]) => args.p_uncertain)).toBe(true);
    const replay = await POST(request(payload));
    expect(replay.status).toBe(202);
    await expect(replay.json()).resolves.toMatchObject({ status: "unresolved" });
    expect(mocks.generateVariants).toHaveBeenCalledTimes(1);
  });

  it("does not release a paid intent when its usage ledger write fails", async () => {
    mocks.persist.mockResolvedValue(false);
    const { POST } = await import("@/app/api/creatives/generate/route");
    expect((await POST(request())).status).toBe(200);
    expect(mocks.progress.mock.calls.some(([args]) => args.p_uncertain)).toBe(true);
  });

  it("holds an unknown provider failure even when no creative was saved", async () => {
    mocks.generateVariants.mockImplementationOnce(async (params: { onFailure: (angle: typeof AD_ANGLES[number], error: Error) => Promise<void> }) => {
      await params.onFailure(AD_ANGLES[0], new Error("Provider timeout"));
    });
    const { POST } = await import("@/app/api/creatives/generate/route");
    const payload = { businessId: "business", brief: "Installation", format: "story", generationId: "11111111-1111-4111-8111-111111111111" };
    expect((await POST(request(payload))).status).toBe(502);
    expect(mocks.progress.mock.calls.some(([args]) => args.p_uncertain && !args.p_failed)).toBe(true);
    const replay = await POST(request(payload));
    expect(replay.status).toBe(202);
    await expect(replay.json()).resolves.toMatchObject({ status: "unresolved" });
    expect(mocks.generateVariants).toHaveBeenCalledTimes(1);
  });

  it("does not mark a failed angle as whole-request failure before its sibling saves", async () => {
    mocks.generateVariants.mockImplementationOnce(async (params: { onFailure: (angle: typeof AD_ANGLES[number], error: Error) => Promise<void>; onVariant: (value: typeof variant) => Promise<void> }) => {
      await params.onFailure(AD_ANGLES[0], new Error("Provider timeout"));
      await params.onVariant(variant);
    });
    const { POST } = await import("@/app/api/creatives/generate/route");
    const response = await POST(request());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ creatives: [expect.objectContaining({ id: "creative" })] });
    expect(mocks.progress.mock.calls.every(([args]) => !args.p_failed)).toBe(true);
  });

  it("only releases a zero-result hold after a definitive whole-request no-provider failure", async () => {
    mocks.generateVariants.mockRejectedValueOnce(new NoLLMKeysError());
    const { POST } = await import("@/app/api/creatives/generate/route");
    const response = await POST(request());
    expect(response.status).toBe(400);
    expect(mocks.progress).toHaveBeenCalledWith(expect.objectContaining({ p_complete: true, p_failed: true, p_uncertain: false }));
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("releases a no-provider batch only after every angle has failed before paid work", async () => {
    mocks.generateVariants.mockImplementationOnce(async (params: { onFailure: (angle: typeof AD_ANGLES[number], error: Error) => Promise<void> }) => {
      for (const angle of AD_ANGLES.slice(0, 3)) await params.onFailure(angle, new NoLLMKeysError());
    });
    const { POST } = await import("@/app/api/creatives/generate/route");
    const response = await POST(request());
    expect(response.status).toBe(400);
    expect(mocks.progress.mock.calls.slice(0, 3).every(([args]) => !args.p_complete && !args.p_failed)).toBe(true);
    expect(mocks.progress).toHaveBeenLastCalledWith(expect.objectContaining({ p_complete: true, p_failed: true, p_uncertain: false }));
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("keeps the hold when a no-provider angle has a saved sibling", async () => {
    mocks.generateVariants.mockImplementationOnce(async (params: { onFailure: (angle: typeof AD_ANGLES[number], error: Error) => Promise<void>; onVariant: (value: typeof variant) => Promise<void> }) => {
      await params.onFailure(AD_ANGLES[0], new NoLLMKeysError());
      await params.onVariant(variant);
    });
    const { POST } = await import("@/app/api/creatives/generate/route");
    expect((await POST(request())).status).toBe(200);
    expect(mocks.progress.mock.calls.every(([args]) => !args.p_failed)).toBe(true);
    expect(mocks.progress).toHaveBeenLastCalledWith(expect.objectContaining({ p_uncertain: true, p_complete: false }));
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
    expect(mocks.admitted.size).toBe(0);
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
