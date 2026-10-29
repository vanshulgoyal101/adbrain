import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// #1717 (Reviewer, Medium): paid pictures weren't in the monthly cap, so one account could drain the shared image key
// for every customer. A business over AI_MONTHLY_COST_LIMIT_USD gets free pictures; another business on the same key
// still gets paid ones. Image code is real; the network and the month-to-date read are replaced.
const store = vi.hoisted(() => ({ spend: new Map<string, number | null>() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: async (name: string, args: { p_business_id: string }) => {
      if (name !== "monthly_ai_cost_usd") return { data: null, error: { message: "unexpected" } };
      const spend = store.spend.get(args.p_business_id);
      return spend === null || spend === undefined ? { data: null, error: { message: "unavailable" } } : { data: spend, error: null };
    },
  }),
}));

const CUSTOMER = { id: "7d2a5b1f-6b54-4d66-8c2a-4a8b4a1d3b21", email: "owner@example.com", email_confirmed_at: "2026-10-01T00:00:00Z" };
const TEAM = { id: "6c1f4f0e-5a43-4c55-9b1f-3f7a3f0c2a10", email: "qa@adbrain.vanshul.com", email_confirmed_at: "2026-10-01T00:00:00Z" };
let png: Buffer;
let calls: string[] = [];

beforeEach(async () => {
  vi.resetModules();
  store.spend.clear();
  png ??= await sharp({ create: { width: 1024, height: 1536, channels: 3, background: "#d9e3dc" } }).png().toBuffer();
  for (const [name, value] of Object.entries({
    NEXT_PUBLIC_SUPABASE_URL: "https://core-test.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
    OPENROUTER_API_KEYS: "core-openrouter",
    IMAGE_PROVIDER: "openrouter",
    IMAGE_PROVIDER_FALLBACK: "none",
    AI_MONTHLY_COST_LIMIT_USD: "3",
  })) vi.stubEnv(name, value);
  vi.doMock("@/lib/security/ssrf", async (original) => ({
    ...(await original<typeof import("@/lib/security/ssrf")>()),
    fetchPublicUrl: async (url: string) => {
      calls.push(new URL(url).hostname);
      return new Response(new Uint8Array(png), { headers: { "content-type": "image/png" } });
    },
  }));
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    calls.push(`${url.hostname}${url.pathname}`);
    if (url.pathname.includes("/images/models/")) return Response.json({ endpoints: [{ supported_parameters: { input_references: { max: 3 } } }] });
    if (url.pathname.endsWith("/api/v1/images")) return Response.json({ id: "gen-1", data: [{ b64_json: png.toString("base64"), media_type: "image/png" }], usage: { cost: 0.04 } });
    throw new Error(`Unexpected request to ${url.hostname}${url.pathname}`);
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.doUnmock("@/lib/security/ssrf");
});

/** One request: its own event context, as a route has. */
async function request<T>(user: typeof CUSTOMER, work: () => Promise<T>): Promise<T> {
  const { eventContext, newEventContext, observeVerifiedUser } = await import("@/lib/observability/context");
  return eventContext.run(newEventContext(), () => {
    observeVerifiedUser(user);
    return work();
  });
}

const image = { prompt: "A modular kitchen in Mohali", width: 1024, height: 1536 };
const paid = () => calls.filter((call) => call === "openrouter.ai/api/v1/images").length;

describe("core: a business over its monthly AI cost cap makes no paid picture (#1717)", () => {
  it("the capped business gets a free picture (with the 'taking longer' signal); another business still gets a paid one", async () => {
    store.spend.set("over", 3.2);
    store.spend.set("under", 0.4);
    const { generateImage } = await import("@/lib/imageGen");
    const { applyMonthlyCostCap } = await import("@/lib/llm/cost-cap");
    const onFallback = vi.fn();
    const capped = await request(CUSTOMER, async () => {
      expect(await applyMonthlyCostCap("over", CUSTOMER)).toBe(true);
      return generateImage({ ...image, onFallback });
    });
    expect(capped.provider).toBe("pollinations");
    expect(paid()).toBe(0);
    expect(onFallback).toHaveBeenCalledTimes(1);

    const other = await request(CUSTOMER, async () => {
      expect(await applyMonthlyCostCap("under", CUSTOMER)).toBe(false);
      return generateImage(image);
    });
    expect(other.provider).toBe("openrouter-image");
    expect(paid()).toBe(1);
  });

  it("a capped business's product-photo ad fails honestly instead of becoming a generic product", async () => {
    store.spend.set("over", 5);
    const { generateImage } = await import("@/lib/imageGen");
    const { applyMonthlyCostCap } = await import("@/lib/llm/cost-cap");
    const { CreativeImageError } = await import("@/lib/creative/generate");
    const { creativeFailureMessage } = await import("@/lib/creative/failure-message");
    const error = await request(CUSTOMER, async () => {
      await applyMonthlyCostCap("over", CUSTOMER);
      return generateImage({ ...image, referenceImages: ["https://core-test.supabase.co/brand/product.png"] }).catch((caught: unknown) => caught);
    });
    expect(error).toMatchObject({ name: "ReferencePhotoPausedError", reason: "allowance" });
    expect(paid()).toBe(0);
    expect(creativeFailureMessage(new CreativeImageError(error, []))).toBe(
      "Your product photo needs our paid pictures, and this month's AI allowance is used. Ads without the product photo still work.");
  });

  it("no cap when the env is unset (no read), for team accounts, or under the limit; an unreadable spend caps", async () => {
    const { applyMonthlyCostCap } = await import("@/lib/llm/cost-cap");
    store.spend.set("unread", null);
    store.spend.set("over", 9);
    expect(await request(TEAM, () => applyMonthlyCostCap("over", TEAM))).toBe(false);
    expect(await request(CUSTOMER, () => applyMonthlyCostCap("unread", CUSTOMER))).toBe(true);
    vi.stubEnv("AI_MONTHLY_COST_LIMIT_USD", "");
    vi.resetModules();
    const unset = await import("@/lib/llm/cost-cap");
    expect(await request(CUSTOMER, () => unset.applyMonthlyCostCap("over", CUSTOMER))).toBe(false);
  });

  it("counts the month from 1st 00:00 IST", async () => {
    const { monthStartIst } = await import("@/lib/llm/cost-cap");
    expect(monthStartIst(new Date("2026-11-30T19:00:00Z"))).toBe("2026-11-30T18:30:00.000Z"); // 1 Dec 00:30 IST
    expect(monthStartIst(new Date("2026-11-30T18:00:00Z"))).toBe("2026-10-31T18:30:00.000Z"); // 30 Nov 23:30 IST
  });
});
