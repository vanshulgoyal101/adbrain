import { afterEach, describe, expect, it, vi } from "vitest";
import { friendlyMetaError, MetaClient, MetaError } from "@/lib/meta/client";

const creds = {
  adAccountId: "act_123",
  pageId: "999",
  accessToken: "tok",
};

afterEach(() => vi.restoreAllMocks());

describe("MetaClient.updateCampaignStatus", () => {
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
