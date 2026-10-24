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
