import { afterEach, describe, expect, it, vi } from "vitest";
import { friendlyMetaError, MetaClient, MetaError } from "@/lib/meta/client";

const creds = {
  adAccountId: "act_123",
  pageId: "999",
  accessToken: "tok",
};

afterEach(() => vi.restoreAllMocks());

describe("MetaClient.verifyCampaignActivation", () => {
  const campaign = { id: "camp_1", account_id: "123", status: "PAUSED" };
  const adSet = { id: "set_1", status: "ACTIVE", daily_budget: "25000", promoted_object: { page_id: "999" } };
  const mockDelivery = (campaignResponse: unknown, adSetResponse: unknown) => vi.spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(new Response(JSON.stringify(campaignResponse)))
    .mockResolvedValueOnce(new Response(JSON.stringify(adSetResponse)));

  it("verifies the total ad-set budget and bound Page using only timed GET requests", async () => {
    const fetchMock = mockDelivery(campaign, { data: [adSet, { ...adSet, id: "set_2" }] });
    await new MetaClient(creds).verifyCampaignActivation("camp_1", { dailyBudgetRupees: 500, status: "paused" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [, init] of fetchMock.mock.calls) {
      expect(init?.method).toBe("GET");
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it.each([
    ["foreign account", { ...campaign, account_id: "other" }, { data: [adSet] }],
    ["changed budget", campaign, { data: [{ ...adSet, daily_budget: "90000" }] }],
    ["changed Page", campaign, { data: [{ ...adSet, promoted_object: { page_id: "other" } }] }],
    ["incomplete ad sets", campaign, { data: [adSet], paging: { next: "https://graph.facebook.com/next" } }],
    ["lifetime budget", campaign, { data: [{ ...adSet, lifetime_budget: "100000" }] }],
    ["invalid budget", campaign, { data: [{ ...adSet, daily_budget: "unknown" }] }],
  ])("blocks %s", async (_label, campaignResponse, adSetResponse) => {
    mockDelivery(campaignResponse, adSetResponse);
    await expect(new MetaClient(creds).verifyCampaignActivation("camp_1", { dailyBudgetRupees: 250, status: "paused" }))
      .rejects.toBeInstanceOf(MetaError);
  });
});

describe("MetaClient.updateCampaignStatus", () => {
  it("does not bind campaigns containing a different Page", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: "set", status: "ACTIVE", daily_budget: "50000", promoted_object: { page_id: "other" } }] })));
    expect(await new MetaClient(creds).readBoundCampaign({ id: "campaign", account_id: "123", name: "Other Page", status: "PAUSED", objective: "OUTCOME_LEADS" })).toBeNull();
  });

  it("reads a verified Page binding and ad-set budget for sync", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: "set", status: "ACTIVE", daily_budget: "50000", promoted_object: { page_id: "999" } }] })));
    expect(await new MetaClient(creds).readBoundCampaign({ id: "campaign", account_id: "123", name: "Our Page", status: "PAUSED", objective: "OUTCOME_LEADS" }))
      .toEqual({ dailyBudgetRupees: 500, adSetId: "set" });
    expect(fetchMock.mock.calls[0][1]?.method).toBe("GET");
  });

  it("POSTs the new status to the campaign node with the token", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ success: true }), { status: 200 }),
      );

    const client = new MetaClient(creds);
    await client.updateCampaignStatus("camp_1", "PAUSED");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://graph.facebook.com/v21.0/camp_1");
    expect(init?.method).toBe("POST");
    const body = String(init?.body);
    expect(body).toContain("status=PAUSED");
    expect(body).toContain("access_token=tok");
  });

  it("resumes with ACTIVE", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}", { status: 200 }));
    await new MetaClient(creds).updateCampaignStatus("camp_2", "ACTIVE");
    expect(String(fetchMock.mock.calls[0][1]?.body)).toContain("status=ACTIVE");
  });

  it("throws a MetaError when Meta returns an error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ error: { message: "Invalid campaign" } }),
        { status: 400 },
      ),
    );
    await expect(
      new MetaClient(creds).updateCampaignStatus("bad", "PAUSED"),
    ).rejects.toBeInstanceOf(MetaError);
  });
});

describe("MetaClient.createLeadCampaign checkpoints", () => {
  it("reports each external mutation as soon as it returns", async () => {
    const responses = [
      new Response(JSON.stringify({ id: "campaign-1" }), { status: 200 }),
      new Response(new Uint8Array([1, 2, 3]), { status: 200 }),
      new Response(JSON.stringify({ images: { uploaded: { hash: "image-hash-1" } } }), { status: 200 }),
      new Response(JSON.stringify({ id: "adset-1" }), { status: 200 }),
      new Response(JSON.stringify({ id: "creative-1" }), { status: 200 }),
      new Response(JSON.stringify({ id: "ad-1" }), { status: 200 }),
    ];
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      const response = responses.shift();
      if (!response) throw new Error("unexpected fetch");
      return response;
    });
    const checkpoints: string[] = [];

    const result = await new MetaClient(creds).createLeadCampaign({
      name: "Checkpoint test",
      dailyBudgetRupees: 200,
      leadFormId: "form-1",
      link: "https://example.com",
      creatives: [{ imageUrl: "https://example.com/image.png", headline: "Headline", message: "Message" }],
      onCheckpoint: (checkpoint) => {
        checkpoints.push(`${checkpoint.phase}:${checkpoint.externalId}`);
      },
    });

    expect(result).toMatchObject({ campaignId: "campaign-1", adSetId: "adset-1", adIds: ["ad-1"] });
    expect(checkpoints).toEqual([
      "campaign:campaign-1",
      "creative:image-hash-1",
      "adset:adset-1",
      "creative:creative-1",
      "ad:ad-1",
    ]);
  });
});

describe("friendlyMetaError", () => {
  it("hides localized CTA validation text", () => {
    expect(
      friendlyMetaError(
        new MetaError("इस CTA प्रकार के लिए अमान्य मान फ़ील्ड lead_gen_form_id: BOOK_NOW."),
      ),
    ).toContain("Meta rejected the ad call-to-action");
  });

  it("gives reconnect guidance for token and permission failures", () => {
    expect(friendlyMetaError(new MetaError("Invalid OAuth access token"))).toContain(
      "Reconnect the ad account",
    );
  });

  it("uses a safe fallback for unknown provider errors", () => {
    expect(friendlyMetaError(new Error("opaque provider detail"), "Try again later.")).toBe(
      "Try again later.",
    );
  });
});

describe("MetaClient input boundaries", () => {
  it("rejects malformed creative image URLs before fetch", async () => {
    const client = new MetaClient(creds);
    await expect(client.uploadAdImage("not-a-url")).rejects.toMatchObject({
      name: "MetaError",
      message: "Creative image URL is invalid.",
    });
  });
});
