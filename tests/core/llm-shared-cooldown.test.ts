import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// #1568 (#681, Analyst #1461): a 429 parked the limited key only on the server instance that saw it, so every fresh
// serverless instance hit it again (Oct 24: LLM_HTTP_429 ×19 dropped Create ads). Now the park is shared through
// `llm_cooldowns`: two "instances" here are two module loads sharing one store. The 429 is Groq's own answer shape.
const store = vi.hoisted(() => ({ rows: new Map<string, string>(), down: false, parks: [] as Array<{ p_key: string; p_until: string }> }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    if (store.down) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
    return {
      from: (table: string) => ({
        select: () => ({
          gt: async (_column: string, after: string) => table !== "llm_cooldowns" ? { data: null, error: { message: "unexpected" } }
            : { data: [...store.rows].filter(([, until]) => until > after).map(([key, until]) => ({ key, until })), error: null },
        }),
      }),
      rpc: async (name: string, args: { p_key: string; p_until: string }) => {
        if (name !== "park_llm_key") return { data: null, error: { message: "unexpected" } };
        store.parks.push(args);
        const current = store.rows.get(args.p_key);
        if (!current || args.p_until > current) store.rows.set(args.p_key, args.p_until);
        return { data: null, error: null };
      },
    };
  },
}));

function setEnv() {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  process.env.GOOGLE_AI_API_KEYS = "";
  process.env.CEREBRAS_API_KEYS = "";
  process.env.GROQ_API_KEYS = "gk";
  process.env.OPENROUTER_API_KEYS = "ok";
  process.env.LLM_PROVIDER_ORDER = "google,groq,openrouter,cerebras";
}

function routeFetch(groq: () => Response) {
  const hosts: string[] = [];
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const host = url.includes("api.groq.com") ? "groq" : url.includes("openrouter.ai") ? "openrouter" : "other";
    hosts.push(host);
    if (host === "groq") return groq();
    return Response.json({ choices: [{ message: { content: "{\"ready\":true}" } }] });
  }) as unknown as typeof fetch;
  return hosts;
}
const dailyLimit = () => Response.json({ error: { message:
  "Rate limit reached for model `qwen/qwen3.8-27b` in organization `org_x` service tier `on_demand` on tokens per day (TPD): Limit 200000, Used 199800, Requested 1200. Please try again in 7m12s." } },
  { status: 429, headers: { "retry-after": "432" } });
const ok = () => Response.json({ choices: [{ message: { content: "{\"ready\":true}" } }] });

/** A fresh server instance: its own module state, the shared store. */
async function instance() {
  vi.resetModules();
  return (await import("@/lib/llm")).complete;
}

beforeEach(() => {
  setEnv();
  store.rows.clear();
  store.parks.length = 0;
  store.down = false;
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("core: a 429 parks the key for every server instance (#1568)", () => {
  it("a fresh instance skips the Groq key another instance parked, until Groq's retry-after", async () => {
    let now = Date.parse("2026-10-28T14:00:00Z");
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const first = routeFetch(dailyLimit);
    await (await instance())([{ role: "user", content: "plan 1" }], {});
    expect(first).toEqual(["groq", "openrouter"]);
    expect(store.parks).toEqual([{ p_key: "groq:0", p_until: new Date(now + 432_000).toISOString() }]);

    now += 60_000;
    const second = routeFetch(ok);
    const result = await (await instance())([{ role: "user", content: "plan 2" }], {});
    expect(result.provider).toBe("openrouter");
    expect(second).toEqual(["openrouter"]);

    // After retry-after, a fresh instance asks Groq again.
    now += 432_000;
    const third = routeFetch(ok);
    expect((await (await instance())([{ role: "user", content: "plan 3" }], {})).provider).toBe("groq");
    expect(third).toEqual(["groq"]);
  });

  it("works as before when the shared store is unavailable (each instance parks for itself)", async () => {
    store.down = true;
    routeFetch(dailyLimit);
    await (await instance())([{ role: "user", content: "plan 1" }], {});
    const fresh = routeFetch(ok);
    expect((await (await instance())([{ role: "user", content: "plan 2" }], {})).provider).toBe("groq");
    expect(fresh).toEqual(["groq"]);
  });

  it("a later, shorter park never shortens an earlier one", async () => {
    const now = Date.parse("2026-10-28T14:00:00Z");
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const { parkShared } = await import("@/lib/llm/shared-cooldown");
    parkShared("groq:0", now + 432_000);
    parkShared("groq:0", now + 60_000);
    await vi.waitFor(() => expect(store.parks).toHaveLength(2));
    expect(store.rows.get("groq:0")).toBe(new Date(now + 432_000).toISOString());
  });
});
