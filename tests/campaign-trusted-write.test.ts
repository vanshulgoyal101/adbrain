import { beforeEach, describe, expect, it, vi } from "vitest";
import { deleteVerifiedCampaign, saveCampaign, saveCampaignResult } from "@/lib/campaign/trusted-write";
import type { createAdminClient } from "@/lib/supabase/admin";

const actor = { businessId: "owned-business", userId: "verified-user" };
const from = vi.fn();
const eq = vi.fn();
const insert = vi.fn();
const update = vi.fn();
const remove = vi.fn();
const maybeSingle = vi.fn();
const single = vi.fn();
const query = { select: () => query, eq, insert, update, delete: remove, maybeSingle, single };
const database = { from } as unknown as ReturnType<typeof createAdminClient>;

beforeEach(() => {
  vi.clearAllMocks();
  from.mockReturnValue(query);
  for (const method of [eq, insert, update, remove]) method.mockReturnValue(query);
  maybeSingle.mockResolvedValue({ data: { id: actor.businessId }, error: null });
  single.mockResolvedValue({ data: { id: "campaign" }, error: null });
});

describe("trusted campaign persistence", () => {
  it.each([null, { message: "lookup unavailable" }])("fails closed for missing ownership or a read error: %s", async error => {
    maybeSingle.mockResolvedValue({ data: null, error });
    await expect(saveCampaign(actor, { status: "paused" }, "campaign", database)).rejects.toThrow("ownership");
    expect(update).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it("verifies the user and scopes status updates to the owned business and campaign", async () => {
    await saveCampaign(actor, { status: "paused" }, "campaign", database);
    expect(eq.mock.calls).toEqual([["id", actor.businessId], ["owner_id", actor.userId], ["business_id", actor.businessId], ["id", "campaign"]]);
    expect(update).toHaveBeenCalledWith({ business_id: actor.businessId, status: "paused" });
  });

  it("persists new paused campaigns without changing session read permissions", async () => {
    await saveCampaign(actor, { status: "paused", meta_campaign_id: "provider-id" }, undefined, database);
    expect(insert).toHaveBeenCalledWith({ business_id: actor.businessId, objective: "leads", status: "paused", meta_campaign_id: "provider-id" });
  });

  it("rejects result insertion for a campaign outside the checked business", async () => {
    maybeSingle.mockResolvedValueOnce({ data: { id: actor.businessId }, error: null })
      .mockResolvedValueOnce({ data: null, error: null });
    await expect(saveCampaignResult(actor, { campaign_id: "foreign" }, database)).rejects.toThrow("ownership");
    expect(insert).not.toHaveBeenCalled();
  });

  it("saves owned results and returns persistence failures to the caller", async () => {
    single.mockResolvedValue({ data: null, error: { code: "23514" } });
    expect(await saveCampaignResult(actor, { campaign_id: "campaign", spend: -1 }, database)).toMatchObject({ error: { code: "23514" } });
    expect(eq).toHaveBeenCalledWith("business_id", actor.businessId);
  });

  it("scopes provider-confirmed deletion to the owner and exact campaign", async () => {
    await deleteVerifiedCampaign(actor, "campaign", database);
    expect(eq.mock.calls).toEqual([["id", actor.businessId], ["owner_id", actor.userId], ["business_id", actor.businessId], ["id", "campaign"]]);
    expect(remove).toHaveBeenCalledOnce();
  });
});