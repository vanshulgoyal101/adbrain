import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const KEY_A = "sk-or-fixture-a";
const KEY_B = "sk-or-fixture-b";
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const request = (auth = "Bearer cron-secret") => new Request("http://localhost/api/cron/llm-credit", { headers: { authorization: auth } });

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("PRODUCT_LOGGING_DATABASE_ENABLED", "false");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://test.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
  vi.stubEnv("CRON_SECRET", "cron-secret");
  vi.stubEnv("OPENROUTER_API_KEYS", `${KEY_A},${KEY_B}`);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("OpenRouter credit alert (#449)", () => {
  it("requires the cron secret", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { GET } = await import("@/app/api/cron/llm-credit/route");
    expect((await GET(request("Bearer nope"))).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports the lowest capped key as low under $0.50, with the key only in a header", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json(200, { data: { limit: 9, limit_remaining: 0.4321 } }))
      .mockResolvedValueOnce(json(200, { data: { limit: null, limit_remaining: null } }));
    vi.stubGlobal("fetch", fetchMock);
    const { GET } = await import("@/app/api/cron/llm-credit/route");
    const res = await GET(request());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, minRemainingUsd: 0.43, thresholdUsd: 0.5, low: true });
    expect(body.keys).toEqual([
      { index: 0, limitUsd: 9, remainingUsd: 0.43 },
      { index: 1, limitUsd: null, remainingUsd: null },
    ]);
    expect(fetchMock.mock.calls[0][0]).toBe("https://openrouter.ai/api/v1/key");
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe(`Bearer ${KEY_A}`);
    expect(JSON.stringify(body)).not.toContain("sk-or");
  });

  it("is not low with enough credit, and 503 without leaking anything when OpenRouter refuses", async () => {
    vi.stubEnv("OPENROUTER_API_KEYS", KEY_A);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(json(200, { data: { limit: 9, limit_remaining: 1.9 } })));
    let { GET } = await import("@/app/api/cron/llm-credit/route");
    expect(await (await GET(request())).json()).toMatchObject({ ok: true, low: false, minRemainingUsd: 1.9 });

    vi.resetModules();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(json(401, { error: { message: `bad key ${KEY_A}` } })));
    ({ GET } = await import("@/app/api/cron/llm-credit/route"));
    const res = await GET(request());
    const body = await res.json();
    expect(res.status).toBe(503);
    expect(body).toMatchObject({ ok: false, low: false, keys: [{ index: 0, error: "HTTP_401" }] });
    expect(JSON.stringify(body)).not.toContain("sk-or");
  });
});
