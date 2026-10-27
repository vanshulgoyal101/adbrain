import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  campaign: null as Record<string, unknown> | null,
  listed: [] as { meta_ad_id: string }[],
  saved: [] as unknown[],
  setAdStatus: vi.fn(),
  purposes: [] as string[],
}));
const query = (rows: () => unknown) => {
  const q: Record<string, unknown> = {};
  for (const name of ["select", "eq", "limit"]) q[name] = () => q;
  q.maybeSingle = async () => ({ data: rows(), error: null });
  q.then = (resolve: (value: unknown) => void) => resolve({ data: rows(), error: null });
  return q;
};
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: (table: string) => query(() => table === "ad_results" ? m.listed : m.campaign) }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: () => query(() => ({ raw: m.campaign?.raw ?? {} })) }) }));
vi.mock("@/lib/campaign/activation", () => ({
  reviewableCampaign: (campaign: Record<string, unknown>) => campaign.meta_campaign_id ? { adAccountId: "act_1", pageId: "page_1", generation: 1 } : null,
  intendedCampaignChildren: () => ({ adIds: ["11"], adSetIds: ["1"], cappedAdSetIds: [] }),
}));
vi.mock("@/lib/campaign/trusted-write", () => ({ saveCampaign: async (_actor: unknown, row: unknown) => { m.saved.push(row); return { error: null }; } }));
vi.mock("@/lib/campaign/ad-pause", async (original) => ({ ...await original<typeof import("@/lib/campaign/ad-pause")>(), recordAdPause: async () => true }));
vi.mock("@/lib/audit", () => ({ logEvent: async () => undefined }));
vi.mock("@/lib/observability/logger", () => ({ recordProductEvent: () => undefined }));
vi.mock("@/lib/meta/connection-access", () => ({
  withMetaConnection: async (_context: unknown, options: { purpose: string }, run: (meta: unknown) => unknown) => { m.purposes.push(options.purpose); return run({ setAdStatus: m.setAdStatus }); },
}));

import { setAdDelivery } from "@/lib/campaign/ad-pause-service";

const context = { businessId: "b1", userId: "u1" } as never;
beforeEach(() => {
  m.campaign = { id: "c1", name: "Run", status: "active", meta_campaign_id: "100", meta_ad_ids: ["11"], raw: {} };
  m.listed = [{ meta_ad_id: "22" }];
  m.saved = []; m.purposes = [];
  m.setAdStatus.mockReset().mockImplementation(async (_campaign: string, adId: string, status: string) => ({ id: adId, status, effectiveStatus: status }));
});

describe("setAdDelivery (#1045)", () => {
  it("pauses a card ad (a capped copy from the stored results) and records it on the campaign", async () => {
    expect(await setAdDelivery(context, "c1", "22", "pause", "expensive")).toEqual({ adId: "22", status: "PAUSED", effectiveStatus: "PAUSED" });
    expect(m.setAdStatus).toHaveBeenCalledWith("100", "22", "PAUSED");
    expect(m.purposes).toEqual(["pause"]);
    expect(m.saved).toEqual([{ raw: { adPauses: [expect.objectContaining({ adId: "22", action: "paused", reason: "expensive" })] } }]);
  });

  it("undoes only an ad AdBrain paused, as an activation", async () => {
    await expect(setAdDelivery(context, "c1", "22", "undo")).rejects.toThrow("AdBrain didn't pause this ad");
    expect(m.setAdStatus).not.toHaveBeenCalled();
    m.campaign!.raw = { adPauses: [{ adId: "22", action: "paused", at: "t" }] };
    expect((await setAdDelivery(context, "c1", "22", "undo")).status).toBe("ACTIVE");
    expect(m.purposes).toEqual(["activate"]);
  });

  it("refuses an ad outside the campaign, a campaign that isn't running, and an unconfirmed read-back", async () => {
    await expect(setAdDelivery(context, "c1", "99", "pause")).rejects.toThrow("This ad isn't part of the campaign.");
    m.campaign!.status = "paused";
    await expect(setAdDelivery(context, "c1", "22", "pause")).rejects.toThrow("Only a running campaign's ads can be paused here.");
    m.campaign!.status = "active";
    m.setAdStatus.mockResolvedValue({ id: "22", status: "ACTIVE", effectiveStatus: "ACTIVE" });
    await expect(setAdDelivery(context, "c1", "22", "pause")).rejects.toThrow("Meta didn't confirm the change.");
    expect(m.saved).toEqual([]);
  });
});
