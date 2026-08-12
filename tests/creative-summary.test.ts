import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CampaignInsights } from "@/lib/meta/client";

/** Fresh module state + a no-LLM-keys environment for each test. */
async function loadSummary() {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  process.env.GOOGLE_AI_API_KEYS = "";
  process.env.GROQ_API_KEYS = "";
  process.env.OPENROUTER_API_KEYS = "";
  process.env.CEREBRAS_API_KEYS = "";
  vi.resetModules();
  return import("@/lib/creative/summary");
}

const base: CampaignInsights = {
  impressions: 0,
  clicks: 0,
  leads: 0,
  spend: 0,
  cpl: null,
};

describe("summarizeInsights", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("short-circuits with a no-delivery message when nothing spent or shown", async () => {
    const { summarizeInsights } = await loadSummary();
    const out = await summarizeInsights("Test", { ...base });
    expect(out).toMatch(/no delivery yet/i);
  });

  it("falls back to a compact metric line when the LLM is unavailable", async () => {
    const { summarizeInsights } = await loadSummary();
    const out = await summarizeInsights("Test", {
      impressions: 1000,
      clicks: 40,
      leads: 8,
      spend: 1200,
      cpl: 150,
    });
    expect(out).toBe("8 leads, ₹1200 spent, ₹150 per lead.");
  });

  it("omits cost-per-lead from the fallback when it's unknown", async () => {
    const { summarizeInsights } = await loadSummary();
    const out = await summarizeInsights("Test", {
      impressions: 500,
      clicks: 10,
      leads: 0,
      spend: 300,
      cpl: null,
    });
    expect(out).toBe("0 leads, ₹300 spent.");
  });

  it("uses the LLM sentence when a provider succeeds", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    process.env.GOOGLE_AI_API_KEYS = "";
    process.env.GROQ_API_KEYS = "key-a";
    process.env.OPENROUTER_API_KEYS = "";
    process.env.CEREBRAS_API_KEYS = "";
    process.env.LLM_PROVIDER_ORDER = "google,groq,openrouter,cerebras";
    vi.resetModules();

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: "  Doing great — 8 leads at ₹150 each.  " } }],
      }),
      text: async () => "",
    }) as unknown as typeof fetch;

    const { summarizeInsights } = await import("@/lib/creative/summary");
    const out = await summarizeInsights("Festive", {
      impressions: 1000,
      clicks: 40,
      leads: 8,
      spend: 1200,
      cpl: 150,
    });
    expect(out).toBe("Doing great — 8 leads at ₹150 each.");
  });
});
