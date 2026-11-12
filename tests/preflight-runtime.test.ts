import { describe, expect, it, vi } from "vitest";

const access = vi.hoisted(() => ({
  getConnectionStatus: vi.fn(async () => ({ generation: 3, selected: { adAccountId: "act_1", pageId: "1" }, capabilities: { canCreatePaused: { state: "available" } } })),
  withMetaConnection: vi.fn(async (_actor: unknown, _options: unknown, run: (meta: unknown) => unknown) => run({
    readActiveLeadForm: async (id: string) => ({ id }),
    getWhatsAppNumber: async () => "+919999994842",
    resolveGeoTargeting: async () => ({ targeting: { cities: [{ key: "1" }] }, matched: [{ key: "1", name: "Austin", type: "city" }], unresolved: [] }),
    resolveAudienceInterests: async () => ({ interests: [], unresolved: [] }),
  })),
}));
vi.mock("@/lib/meta/connection-access", () => access);
const evidence = vi.hoisted(() => ({ getCostPerResult: vi.fn(async () => 69) }));
vi.mock("@/lib/campaign/result-evidence-store", () => evidence);
// #253's bindings have their own tests (whatsapp-bindings.test.ts); here the Page's number is the one.
vi.mock("@/lib/meta/whatsapp-bindings", () => ({
  whatsappNumberForBusiness: (_businessId: string, meta: { getWhatsAppNumber: (requested: string | null, bound: string[]) => Promise<string | null> }, requested: string | null) => meta.getWhatsAppNumber(requested, []),
}));

import { buildCampaignPreflightLoaders } from "@/lib/campaign/preflight-runtime";

const actor = { businessId: "b1", userId: "u1" } as never;
const supabase = {
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { locations: [], website: null } }) }) }) }),
} as never;

describe("preflight loaders (#366)", () => {
  it("read the Meta connection once per preflight, however many loaders need it", async () => {
    const loaders = buildCampaignPreflightLoaders(supabase, actor);
    const draft = { input: { destination: "whatsapp", whatsappNumber: "+91 ••••• 4842", targeting: { location: { mode: "ai", includedNames: ["Austin"] } } } } as never;
    await Promise.all([
      loaders.getConnection(actor),
      loaders.findForm("b1", "form-1"),
      loaders.findWhatsAppNumber?.(actor, "+91 ••••• 4842"),
      loaders.resolveGeo(actor, draft),
    ]);
    expect(access.getConnectionStatus).toHaveBeenCalledTimes(1);
    buildCampaignPreflightLoaders(supabase, actor).getConnection(actor);
    expect(access.getConnectionStatus).toHaveBeenCalledTimes(2);
  });
});

describe("WhatsApp number loader (#681)", () => {
  it("a failed Meta read rejects (Review says try again) instead of reading as 'no number linked'", async () => {
    access.withMetaConnection.mockImplementationOnce(async () => { throw new Error("Meta request failed (500)."); });
    await expect(buildCampaignPreflightLoaders(supabase, actor).findWhatsAppNumber?.(actor, "+91 ••••• 4842")).rejects.toThrow("Meta request failed");
  });

  it("reads the Page's number when Meta answers", async () => {
    await expect(buildCampaignPreflightLoaders(supabase, actor).findWhatsAppNumber?.(actor, "+91 ••••• 4842")).resolves.toBe("+919999994842");
  });
});

describe("preflight loaders for the Review warnings (#419 2b)", () => {
  it("marks a creative 9:16-ready from its saved overlay design, and reads the business's own cost per result", async () => {
    const design = { format: "portrait", width: 1080, height: 1350, brandName: "Solaride", logoUrl: null, headline: "Cut your bill", subhead: "Free site survey",
      benefits: [], phone: null, contactLine: null, ctaLabel: "Contact Us", primaryColor: "#1d3a2e", ctaTextColor: "#ffffff", fontFamily: "sans-serif", layout: "top" };
    const rows = [
      { id: "c1", business_id: "b1", status: "approved", image_url: "https://x/1.png", headline: "A", primary_text: "a", cta: null, generation: { composition: "overlay", photoUrl: "https://x/p.png", design, ownWords: true } },
      { id: "c2", business_id: "b1", status: "approved", image_url: "https://x/2.png", headline: "B", primary_text: "b", cta: null, generation: { composition: "image-only" } },
    ];
    const query = { select: () => query, in: () => query, eq: async () => ({ data: rows }) };
    const loaders = buildCampaignPreflightLoaders({ from: () => query } as never, actor);
    expect((await loaders.findCreatives("b1", ["c1", "c2"])).map((creative) => [creative.storyReady, creative.ownWords])).toEqual([[true, true], [false, false]]);
    expect(await loaders.findCostPerResult?.(actor, "whatsapp")).toBe(69);
    expect(evidence.getCostPerResult).toHaveBeenCalledWith("b1", "whatsapp");
  });
});

describe("owner-written ad context loader (#780)", () => {
  const loadWith = (response: { data: Record<string, unknown> | null; error: unknown }) => {
    const business = {
      select: vi.fn(() => business),
      eq: vi.fn(() => business),
      maybeSingle: vi.fn(async () => response),
    };
    const loaders = buildCampaignPreflightLoaders({ from: () => business } as never, actor);
    return { business, loaders };
  };

  it("reads current Brand facts and vertical", async () => {
    const { business, loaders } = loadWith({
      data: {
        name: "Study Hub", description: "Small-group lessons", target_audience: "Adults",
        usps: ["Flexible schedule"], offers: ["Free assessment"], locations: ["Austin"], vertical: "Education",
      },
      error: null,
    });

    const readOwnWordsContext = loaders.findOwnWordsContext;
    if (!readOwnWordsContext) throw new Error("The owner-written Brand context loader is missing.");
    await expect(readOwnWordsContext(actor)).resolves.toEqual({
      brandFacts: ["Study Hub", "Small-group lessons", "Adults", "Flexible schedule", "Free assessment", "Austin"],
      vertical: "Education",
    });
    expect(business.select).toHaveBeenCalledWith("name, description, target_audience, usps, offers, locations, vertical");
    expect(business.eq).toHaveBeenCalledWith("id", "b1");
  });

  it("rejects when the current Brand read fails", async () => {
    const { loaders } = loadWith({ data: null, error: { message: "timeout" } });

    const readOwnWordsContext = loaders.findOwnWordsContext;
    if (!readOwnWordsContext) throw new Error("The owner-written Brand context loader is missing.");
    await expect(readOwnWordsContext(actor)).rejects.toThrow("Current Brand facts could not be checked");
  });
});


describe("WhatsApp message loader (#2422)", () => {
  const loadersWith = (business: Record<string, unknown>) => {
    const businesses = { select: () => businesses, eq: () => businesses, maybeSingle: async () => ({ data: business, error: null }) };
    const creatives = { select: () => creatives, in: () => creatives, eq: async () => ({ data: [] }) };
    return buildCampaignPreflightLoaders({ from: (table: string) => (table === "businesses" ? businesses : creatives) } as never, actor);
  };
  const draft = { destination: "whatsapp", creativeIds: [], targeting: {} } as never;

  it("holds a saved message to the policy rules, not only this campaign's edit", async () => {
    const saved = { greeting: "Hi! 100% visa with our team.", opening: { kind: "prefill", prefill: "Hi, I'd like a demo class", callButton: false }, language: "en" };
    const found = await loadersWith({ name: "Study Hub", vertical: "IELTS coaching", offers: [], usps: [], description: null, locations: [], whatsapp_template: saved }).findWhatsAppMessage?.(actor, draft);
    expect(found?.message.source).toBe("saved");
    expect(found?.problem).toBe('"100% visa" in the welcome is a promise Meta rejects. Reword it.');
  });

  it("passes AdBrain's suggested message", async () => {
    const found = await loadersWith({ name: "Study Hub", vertical: "IELTS coaching", offers: [], usps: [], description: null, locations: [], whatsapp_template: null }).findWhatsAppMessage?.(actor, draft);
    expect(found?.message.source).toBe("suggested");
    expect(found?.problem).toBeNull();
  });
});

describe("WhatsApp message loader fails closed (#2452)", () => {
  const failing = (businessError: unknown, creativesError: unknown) => {
    const businesses = { select: () => businesses, eq: () => businesses, maybeSingle: async () => ({ data: businessError ? null : { name: "Study Hub", whatsapp_template: null, locations: [] }, error: businessError }) };
    const creatives = { select: () => creatives, in: () => creatives, eq: async () => ({ data: null, error: creativesError }) };
    return buildCampaignPreflightLoaders({ from: (table: string) => (table === "businesses" ? businesses : creatives) } as never, actor);
  };
  const draft = { destination: "whatsapp", creativeIds: ["c1"], targeting: {} } as never;

  it.each([
    ["the business read", { message: "timeout" }, null],
    ["the ads read", null, { message: "timeout" }],
  ])("rejects (Review says try again) when %s fails, instead of passing a fallback message", async (_label, businessError, creativesError) => {
    await expect(failing(businessError, creativesError).findWhatsAppMessage?.(actor, draft)).rejects.toThrow("WhatsApp message could not be read.");
  });
});

describe("own-photo rights loader (#784)", () => {
  it("marks an ad with the owner's own photo (library or Brand) and reads their confirmation since any hand-over", async () => {
    const rows = [
      { id: "c1", business_id: "b1", status: "approved", image_url: "https://x/1.png", headline: "A", primary_text: "a", cta: null, generation: null, media_asset_id: "m1" },
      { id: "c2", business_id: "b1", status: "approved", image_url: "https://x/2.png", headline: "B", primary_text: "b", cta: null, generation: null, media_asset_id: null },
      { id: "c3", business_id: "b1", status: "approved", image_url: "https://x/3.png", headline: "C", primary_text: "c", cta: null, generation: { ownerPhoto: "https://x/brand.jpg" }, media_asset_id: null },
      { id: "c4", business_id: "b1", status: "approved", image_url: "https://x/4.png", headline: "D", primary_text: "d", cta: null, generation: { ownerPhoto: null }, media_asset_id: null },
      { id: "c5", business_id: "b1", status: "approved", image_url: "https://x/5.png", headline: "E", primary_text: "e", cta: null, generation: { image: { provider: "owner-photo" }, ownerPhoto: null }, media_asset_id: null },
      { id: "c6", business_id: "b1", status: "approved", image_url: "https://x/6.png", headline: "F", primary_text: "f", cta: null, generation: { image: { provider: "gemini" } }, media_asset_id: null },
    ];
    const creatives = { select: () => creatives, in: () => creatives, eq: async () => ({ data: rows }) };
    const business = { owner_id: "owner-1", vertical: "solar energy", transferred_at: "2026-11-02T09:00:00Z" };
    const businesses = { select: () => businesses, eq: () => businesses, maybeSingle: async () => ({ data: business, error: null }) };
    const consents = (confirmedAt: string) => {
      const query = { select: () => query, eq: () => query, order: () => query, limit: async () => ({ data: [{ terms_version: "x", people_confirmed: false, confirmed_at: confirmedAt, user_id: "owner-1" }], error: null }) };
      return query;
    };
    const build = (confirmedAt: string) => buildCampaignPreflightLoaders({ from: (table: string) => table === "creatives" ? creatives : table === "businesses" ? businesses : consents(confirmedAt) } as never, actor);
    expect((await build("2026-11-02T10:00:00Z").findCreatives("b1", ["c1", "c2", "c3", "c4", "c5", "c6"])).map((creative) => creative.ownMedia)).toEqual([true, false, true, false, true, false]);
    expect(await build("2026-11-02T10:00:00Z").findMediaConsent?.(actor)).toBe(true);
    expect(await build("2026-11-01T10:00:00Z").findMediaConsent?.(actor)).toBe(false);
  });
});
