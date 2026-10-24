import { beforeEach, describe, expect, it, vi } from "vitest";

/** updateCreativeCopy (#280): the owner's own wording, saved without the AI. */

const h = vi.hoisted(() => ({
  getUser: vi.fn(),
  rows: {} as Record<string, unknown>,
  updates: [] as { table: string; payload: Record<string, unknown> }[],
  filters: [] as { table: string; op: string; args: unknown[] }[],
  logEvent: vi.fn(),
  revalidatePath: vi.fn(),
  instructions: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: h.revalidatePath }));
vi.mock("@/lib/audit", () => ({ logEvent: h.logEvent }));
vi.mock("@/lib/supabase/queries", () => ({ getActiveInstructionsText: h.instructions }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: h.getUser },
    from: (table: string) => {
      let payload: Record<string, unknown> | null = null;
      const query = {
        select: () => query,
        update: (next: Record<string, unknown>) => {
          payload = next;
          h.updates.push({ table, payload: next });
          return query;
        },
        eq: (...args: unknown[]) => (h.filters.push({ table, op: "eq", args }), query),
        contains: (...args: unknown[]) => (h.filters.push({ table, op: "contains", args }), query),
        not: (...args: unknown[]) => (h.filters.push({ table, op: "not", args }), query),
        limit: async () => ({ data: h.rows[table] ?? [], error: null }),
        maybeSingle: async () => {
          const row = h.rows[table] as Record<string, unknown> | null | undefined;
          if (!row) return { data: null, error: null };
          return { data: payload ? { ...row, ...payload } : row, error: null };
        },
      };
      return query;
    },
  }),
}));

const copy = {
  headline: "Solar that pays for itself",
  primary_text: "Cut your bill with rooftop solar.\nFree site visit in Jaipur.",
  description: "Rooftop solar for Jaipur homes",
  cta: "Get Quote" as const,
};

const generation = {
  receiptVersion: 1,
  concept: {
    headline: "Old headline",
    primary_text: "Old text",
    description: "Old description",
    cta: "Learn More",
    rationale: "Keeps the rationale",
    sourceQuotes: ["Free site visit"],
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  h.updates.length = 0;
  h.filters.length = 0;
  h.getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
  h.instructions.mockResolvedValue("");
  h.rows = {
    creatives: { business_id: "b1", generation, status: "approved" },
    businesses: { name: "Solaride", vertical: "solar", offers: ["Free site visit"], usps: [], locations: ["Jaipur"] },
    campaigns: [],
  };
});

async function save(over: Partial<typeof copy> = {}) {
  const { updateCreativeCopy } = await import("@/app/(app)/studio/actions");
  return updateCreativeCopy("c1", { ...copy, ...over });
}

describe("updateCreativeCopy", () => {
  it("refuses when signed out and saves nothing", async () => {
    h.getUser.mockResolvedValue({ data: { user: null } });
    await expect(save()).resolves.toEqual({ ok: false, error: "Not authenticated." });
    expect(h.updates).toEqual([]);
  });

  it("refuses an ad the owner can't see (RLS hides it) and saves nothing", async () => {
    h.rows.creatives = null;
    await expect(save()).resolves.toEqual({ ok: false, error: "Creative not found or no longer accessible." });
    expect(h.updates).toEqual([]);
  });

  it.each([
    [{ headline: "x".repeat(41) }, "Headline must be 40 characters or fewer."],
    [{ primary_text: "x".repeat(901) }, "Main text must be 900 characters or fewer."],
    [{ description: "x".repeat(101) }, "Description must be 100 characters or fewer."],
    [{ headline: "   " }, "Headline can't be empty."],
    [{ cta: "Buy Now" as never }, "Button isn't valid."],
  ])("enforces Create's limits: %o", async (over, error) => {
    await expect(save(over)).resolves.toEqual({ ok: false, error });
    expect(h.updates).toEqual([]);
  });

  it("saves the copy, keeps the receipt and leaves an approved ad approved", async () => {
    const res = await save();
    expect(res).toMatchObject({ ok: true, warnings: [] });
    expect(res.liveNotice).toBeUndefined();
    const [{ table, payload }] = h.updates;
    expect(table).toBe("creatives");
    expect(payload).not.toHaveProperty("status");
    expect(payload).toMatchObject({ headline: copy.headline, primary_text: copy.primary_text, cta: "Get Quote" });
    expect(payload.generation).toMatchObject({
      receiptVersion: 1,
      concept: { ...copy, rationale: "Keeps the rationale", sourceQuotes: ["Free site visit"] },
    });
    expect(h.logEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "creative.edit", entityId: "c1" }));
    expect(h.revalidatePath).toHaveBeenCalledWith("/studio");
  });

  it("warns about claims missing from the Brand but still saves", async () => {
    const res = await save({ headline: "20% off solar this week", description: "Guaranteed savings" });
    expect(res.ok).toBe(true);
    expect(res.warnings).toEqual([
      "\"20%\" isn't in your Brand. Check it's true, or add it to your Brand's offers.",
      "\"Guaranteed\" isn't in your Brand. Check it's true, or add it to your Brand's offers.",
    ]);
    expect(h.updates).toHaveLength(1);
  });

  it("accepts an offer that the Brand or the owner's instructions back up", async () => {
    h.instructions.mockResolvedValue("## Diwali\n20% off till Nov 15");
    const res = await save({ headline: "20% off solar this week" });
    expect(res.warnings).toEqual([]);
  });

  it("says plainly when the ad is already live on Meta", async () => {
    h.rows.campaigns = [{ id: "camp1" }];
    const res = await save();
    expect(res).toMatchObject({ ok: true, liveNotice: "This ad is live on Meta; your edit applies to new campaigns." });
    expect(h.filters).toEqual(expect.arrayContaining([
      { table: "campaigns", op: "contains", args: ["creative_ids", ["c1"]] },
      { table: "campaigns", op: "not", args: ["meta_campaign_id", "is", null] },
    ]));
  });

  it("gives an older ad without a receipt a description it can show", async () => {
    h.rows.creatives = { business_id: "b1", generation: null };
    await save();
    expect(h.updates[0].payload.generation).toMatchObject({ concept: { description: copy.description } });
  });
});
