import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestUrl, settleInVirtualTime, useVirtualDeadlines } from "./replay";

// #1572 (QA): sales-prospect packs (#1317, #1315) and internal accounts are ₹0 on pictures. With the paid image key
// AND a paid fallback configured, a `+prospect` or internal account makes no OpenRouter call on any picture path:
// free success, Cloudflare failing, Pollinations down. #1559's prospect picture retry goes through the same
// `generateImage` for the same signed-in user. Control: a customer on the same network does reach OpenRouter, so the
// spy sees a paid call when one happens. Text is out of scope: internal text stays on the paid models (#466).

const PROSPECT = { id: "3f9c1f2e-8a51-4e1b-9d4a-2b7e5c0a1d11", email: "qa+prospect-bio2@adbrain.vanshul.com", email_confirmed_at: "2026-10-28T00:00:00Z" };
const INTERNAL = { id: "6c1f4f0e-5a43-4c55-9b1f-3f7a3f0c2a10", email: "qa@adbrain.vanshul.com", email_confirmed_at: "2026-10-01T00:00:00Z" };
const CUSTOMER = { id: "7d2a5b1f-6b54-4d66-8c2a-4a8b4a1d3b21", email: "owner@example.com", email_confirmed_at: "2026-10-01T00:00:00Z" };
type User = typeof PROSPECT;
let png: Buffer;
vi.mock("@/lib/imageGen/raster", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/imageGen/raster")>();
  const isPng = (bytes: Uint8Array) => bytes[0] === 0x89 && bytes[1] === 0x50;
  return { ...actual, validateRaster: async (bytes: Uint8Array) => (isPng(bytes)
    ? { bytes, contentType: "image/png", width: 1024, height: 1536 } : actual.validateRaster(bytes)) };
});

beforeEach(async () => {
  vi.resetModules();
  png ??= await sharp({ create: { width: 1024, height: 1536, channels: 3, background: "#d9e3dc" } }).png().toBuffer();
  for (const [name, value] of Object.entries({
    NEXT_PUBLIC_SUPABASE_URL: "https://core-test.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
    OPENROUTER_API_KEYS: "core-openrouter",
    // The most tempting set-up for a regression: paid primary AND paid fallback.
    IMAGE_PROVIDER: "openrouter",
    IMAGE_PROVIDER_FALLBACK: "openrouter",
    CLOUDFLARE_ACCOUNT_ID: "core-account",
    CLOUDFLARE_AI_TOKEN: "core-token",
  })) vi.stubEnv(name, value);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

/** Every request's host + path; OpenRouter answers with a picture so a paid call would succeed (and be caught). */
function network({ cloudflare = "ok", pollinations = "ok" }: { cloudflare?: "ok" | "down"; pollinations?: "ok" | "down" } = {}) {
  const calls: string[] = [];
  const picture = () => new Response(new Uint8Array(png), { headers: { "content-type": "image/png" } });
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(requestUrl(input));
    calls.push(url.hostname);
    if (url.hostname === "api.cloudflare.com") {
      return cloudflare === "ok" ? Response.json({ success: true, result: { image: png.toString("base64") } })
        : Response.json({ success: false, errors: [{ message: "Internal error" }] }, { status: 500 });
    }
    if (url.hostname === "image.pollinations.ai") return pollinations === "ok" ? picture() : new Response("Bad gateway", { status: 502 });
    if (url.hostname === "openrouter.ai") {
      if (url.pathname.endsWith("/endpoints")) return Response.json({ data: { endpoints: [{ pricing: { image: "0.04" } }] } });
      return Response.json({ data: [{ b64_json: png.toString("base64") }], id: "gen-paid" });
    }
    if (url.protocol === "data:") return picture();
    throw new Error(`Unexpected request to ${url.hostname}${url.pathname}`);
  }));
  return { calls };
}

async function asUser<T>(user: User, work: () => Promise<T>): Promise<T> {
  const { eventContext, newEventContext, observeVerifiedUser } = await import("@/lib/observability/context");
  return eventContext.run(newEventContext(), () => {
    observeVerifiedUser(user);
    return work();
  });
}

async function picture(user: User) {
  const { generateImage } = await import("@/lib/imageGen");
  return settleInVirtualTime(asUser(user, () => generateImage({ prompt: "A rooftop solar install in Zirakpur", width: 1024, height: 1536 })
    .then((image) => ({ ok: true as const, provider: image.provider, cost: image.estimatedCostUsd }), (error: unknown) => ({ ok: false as const, error }))));
}

describe("core: prospect and internal pictures never reach a paid provider (#1572, #1547)", () => {
  it("control: a customer on the same set-up does reach OpenRouter", async () => {
    const { calls } = network();
    useVirtualDeadlines();
    await picture(CUSTOMER);
    expect(calls).toContain("openrouter.ai");
  });

  it("the account set-up: a +prospect address is internal, a prospect, and not exempt from free pictures", async () => {
    const { isInternalUser, isProspectAccount, isExemptFromFreeProviders } = await import("@/lib/internal-accounts");
    expect(isInternalUser(PROSPECT)).toBe(true);
    expect(isProspectAccount(PROSPECT)).toBe(true);
    expect(isExemptFromFreeProviders(PROSPECT)).toBe(false);
  });

  const outages = [
    ["free path works", { cloudflare: "ok", pollinations: "ok" }, true],
    ["Cloudflare fails, Pollinations works", { cloudflare: "down", pollinations: "ok" }, true],
    ["both free providers down (no paid rescue)", { cloudflare: "down", pollinations: "down" }, false],
  ] as const;
  it.each([PROSPECT, INTERNAL].flatMap((user) => outages.map(([name, outage, succeeds]) => [user.email, name, outage, succeeds, user] as const)))(
    "%s, %s: no OpenRouter call", async (_email, _case, outage, succeeds, user) => {
      const { calls } = network(outage);
      useVirtualDeadlines();
      const result = await picture(user);
      expect(calls).not.toContain("openrouter.ai");
      expect(result.ok).toBe(succeeds);
      if (result.ok) {
        expect(["cloudflare", "pollinations"]).toContain(result.provider);
        expect(result.cost ?? 0).toBe(0);
      }
    });
});
