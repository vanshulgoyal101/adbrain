import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  campaign: null as Record<string, unknown> | null,
  listed: [] as { meta_ad_id: string }[],
  saved: [] as unknown[],
  setAdStatus: vi.fn(),
  purposes: [] as string[],
  waiting: false,
}));
const query = (rows: () => unknown) => {
  const q: Record<string, unknown> = {};
  for (const name of ["select", "eq", "limit"]) q[name] = () => q;
  q.maybeSingle = async () => ({ data: rows(), error: null });
  q.then = (resolve: (value: unknown) => void) => resolve({ data: rows(), error: null });
  return q;
};
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: (table: string) => query(() => table === "ad_results" ? m.listed : m.campaign) }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: (table: string) => query(() => table === "campaign_edit_operations" ? (m.waiting ? [{ id: "op-1" }] : []) : { raw: m.campaign?.raw ?? {} }) }) }));
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
import { MetaWriteUncertainError } from "@/lib/meta/client";

const context = { businessId: "b1", userId: "u1" } as never;
const recorded = () => (m.saved as { raw: { adPauses?: unknown[] } }[]).flatMap((row) => row.raw.adPauses ?? []);
beforeEach(() => {
  m.campaign = { id: "c1", name: "Run", status: "active", meta_campaign_id: "100", meta_ad_ids: ["11"], raw: {} };
  m.listed = [{ meta_ad_id: "22" }];
  m.saved = []; m.purposes = []; m.waiting = false;
  m.setAdStatus.mockReset().mockImplementation(async (_campaign: string, adId: string, status: string) => ({ id: adId, status, effectiveStatus: status, changed: true }));
});

describe("setAdDelivery (#1045)", () => {
  // #1146: the waiting new-audience copy has its own copy of the ad, which a pause here wouldn't reach.
  it("refuses, before any Meta call, while a new audience waits to be switched on", async () => {
    m.waiting = true;
    await expect(setAdDelivery(context, "c1", "22", "pause")).rejects.toMatchObject({ status: 409, code: "switch_pending" });
    expect(m.setAdStatus).not.toHaveBeenCalled();
  });

  it("pauses a card ad (a capped copy from the stored results) and records it on the campaign", async () => {
    expect(await setAdDelivery(context, "c1", "22", "pause", "expensive")).toEqual({ adId: "22", status: "PAUSED", effectiveStatus: "PAUSED", changed: true });
    expect(m.setAdStatus).toHaveBeenCalledWith("100", "22", "PAUSED");
    expect(m.purposes).toEqual(["pause"]);
    expect(m.saved).toEqual([
      { raw: { adPauseIntents: [expect.objectContaining({ adId: "22", action: "paused", reason: "expensive" })] } },
      { raw: { adPauseIntents: [], adPauses: [expect.objectContaining({ adId: "22", action: "paused", reason: "expensive" })] } },
    ]);
  });

  it("records nothing when the ad was already paused in Meta, so a later Undo can't turn it on (Reviewer, #1048)", async () => {
    m.setAdStatus.mockResolvedValue({ id: "22", status: "PAUSED", effectiveStatus: "PAUSED", changed: false });
    expect((await setAdDelivery(context, "c1", "22", "pause")).changed).toBe(false);
    expect(recorded()).toEqual([]);
    expect(m.saved.at(-1)).toEqual({ raw: { adPauseIntents: [] } });
    await expect(setAdDelivery(context, "c1", "22", "undo")).rejects.toThrow("AdBrain didn't pause this ad");
  });

  // #2322/#2395: Meta may have paused the ad, so the owner is never told nothing changed or to just try again.
  it("does not claim an ad is unchanged when a pause read-back fails", async () => {
    m.setAdStatus.mockRejectedValueOnce(new MetaWriteUncertainError(new Error("read-back failed")));
    const refusal = await setAdDelivery(context, "c1", "22", "pause").then(() => null, (error: unknown) => error);
    expect(refusal).toMatchObject({ message: "Meta didn't confirm the change. Refresh the campaign before trying again.", status: 502, retryable: false });
    expect(m.saved.at(-1)).toEqual({ raw: { adPauseIntents: [expect.objectContaining({ adId: "22", action: "paused" })] } });
    expect(recorded()).toEqual([]);
  });

  it("records a retried pause that Meta had already made, but not from an intent older than a day", async () => {
    m.setAdStatus.mockResolvedValue({ id: "22", status: "PAUSED", effectiveStatus: "PAUSED", changed: false });
    m.campaign!.raw = { adPauseIntents: [{ adId: "22", action: "paused", at: new Date(Date.now() - 25 * 3600_000).toISOString() }] };
    expect((await setAdDelivery(context, "c1", "22", "pause")).changed).toBe(false);
    m.campaign!.raw = { adPauseIntents: [{ adId: "22", action: "paused", at: new Date().toISOString(), reason: "expensive" }] };
    expect((await setAdDelivery(context, "c1", "22", "pause")).changed).toBe(true);
    expect(m.saved.at(-1)).toEqual({ raw: { adPauseIntents: [], adPauses: [expect.objectContaining({ adId: "22", action: "paused", reason: "expensive" })] } });
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
    m.setAdStatus.mockResolvedValue({ id: "22", status: "ACTIVE", effectiveStatus: "ACTIVE", changed: true });
    await expect(setAdDelivery(context, "c1", "22", "pause")).rejects.toThrow("Meta didn't confirm the change.");
    expect(recorded()).toEqual([]);
  });
});
