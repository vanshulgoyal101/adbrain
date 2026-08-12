import { afterEach, describe, expect, it, vi } from "vitest";
import { MetaClient, MetaError } from "@/lib/meta/client";

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
