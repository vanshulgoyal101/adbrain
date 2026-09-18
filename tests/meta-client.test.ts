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

describe("campaign object binding", () => {
  it.each(["delete", "insights"])("allows bound campaign %s after verification", async (operation) => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ id: "camp_1", account_id: "123" }))
      .mockResolvedValueOnce(Response.json({ data: [{ promoted_object: { page_id: "999" } }] }))
      .mockResolvedValueOnce(Response.json(operation === "delete" ? { success: true } : { data: [{ impressions: "10", clicks: "2", spend: "5" }] }));
    const client = new MetaClient(creds);
    if (operation === "delete") await client.deleteObject("camp_1");
    else expect(await client.getCampaignInsights("camp_1")).toMatchObject({ impressions: 10, clicks: 2, spend: 5 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2][1]?.method).toBe(operation === "delete" ? "DELETE" : "GET");
  });

  it.each(["pause", "delete", "insights"])("blocks %s for a forged account reference", async (operation) => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json({ id: "foreign", account_id: "456" }));
    const client = new MetaClient(creds);
    await expect(operation === "pause" ? client.updateCampaignStatus("foreign", "PAUSED")
      : operation === "delete" ? client.deleteObject("foreign") : client.getCampaignInsights("foreign"))
      .rejects.toThrow("connected ad account");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][1]?.method).toBe("GET");
  });

  it.each([
    { data: [{ promoted_object: { page_id: "other" } }] },
    { data: [] },
    { data: [{ promoted_object: { page_id: "999" } }], paging: { next: "more" } },
  ])("blocks deletion when Page evidence is incomplete or foreign: %j", async (adSets) => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ id: "camp_1", account_id: "123" }))
      .mockResolvedValueOnce(Response.json(adSets));
    await expect(new MetaClient(creds).deleteObject("camp_1")).rejects.toThrow("Page binding");
    expect(fetchMock.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
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
      .mockResolvedValueOnce(Response.json({ id: "camp_1", account_id: "123" }))
      .mockResolvedValueOnce(Response.json({ data: [{ promoted_object: { page_id: "999" } }] }))
      .mockResolvedValue(
        new Response(JSON.stringify({ success: true }), { status: 200 }),
      );

    const client = new MetaClient(creds);
    await client.updateCampaignStatus("camp_1", "PAUSED");

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [url, init] = fetchMock.mock.calls[2];
    expect(String(url)).toBe("https://graph.facebook.com/v21.0/camp_1");
    expect(init?.method).toBe("POST");
    const body = String(init?.body);
    expect(body).toContain("status=PAUSED");
    expect(body).toContain("access_token=tok");
  });

  it("resumes with ACTIVE", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ id: "camp_2", account_id: "123" }))
      .mockResolvedValueOnce(Response.json({ data: [{ promoted_object: { page_id: "999" } }] }))
      .mockResolvedValue(new Response("{}", { status: 200 }));
    await new MetaClient(creds).updateCampaignStatus("camp_2", "ACTIVE");
    expect(String(fetchMock.mock.calls[2][1]?.body)).toContain("status=ACTIVE");
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
  it.each([
    { location: { cities: [{ key: "city-1", radius: 5, distance_unit: "kilometer" }] }, ageMin: 25, ageMax: 55 },
    { location: { countries: ["IN"] }, ageMin: 55, ageMax: 25 },
    { location: { countries: ["IN"] } },
    { location: { countries: ["IN"] }, ageMin: 25, ageMax: 55, variants: [{ ageMin: 30, ageMax: 20 }] },
  ])("rejects invalid radii and age ranges before mutations: %j", async (targeting) => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    await expect(new MetaClient(creds).createLeadCampaign({ name: "Invalid targeting", dailyBudgetRupees: 200, leadFormId: "form-1", link: "https://example.com", creatives: [], ...targeting })).rejects.toBeInstanceOf(MetaError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("preserves interests and excluded geography across both age variants", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ id: "campaign-1" }))
      .mockResolvedValueOnce(Response.json({ id: "adset-1" }))
      .mockResolvedValueOnce(Response.json({ id: "adset-2" }));
    const interests = [{ id: "12345", name: "Solar energy" }];
    await new MetaClient(creds).createLeadCampaign({
      name: "Audience bands", dailyBudgetRupees: 200, leadFormId: "form-1", link: "https://example.com", creatives: [],
      location: { regions: [{ key: "region-1" }] }, excludedLocation: { cities: [{ key: "city-2", radius: 20, distance_unit: "kilometer" }] }, interests,
      variants: [{ ageMin: 25, ageMax: 39 }, { ageMin: 40, ageMax: 65 }],
    });
    const calls = fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/adsets"));
    expect(calls).toHaveLength(2);
    const payloads = calls.map(([, init]) => JSON.parse(new URLSearchParams(String(init?.body)).get("targeting")!));
    expect(payloads.map((payload) => [payload.age_min, payload.age_max])).toEqual([[25, 39], [40, 65]]);
    for (const payload of payloads) expect(payload).toMatchObject({ flexible_spec: [{ interests }], excluded_geo_locations: { cities: [{ key: "city-2", radius: 20 }] }, targeting_automation: { advantage_audience: 0 } });
  });
  it("rejects missing geography before any provider mutation", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    await expect(new MetaClient(creds).createLeadCampaign({
      name: "Missing audience", dailyBudgetRupees: 200, leadFormId: "form-1",
      link: "https://example.com", creatives: [],
    })).rejects.toThrow("resolved campaign location");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports each external mutation as soon as it returns", async () => {
    const responses = [
      new Response(JSON.stringify({ id: "campaign-1" }), { status: 200 }),
      new Response(new Uint8Array([1, 2, 3]), { status: 200 }),
      new Response(JSON.stringify({ images: { uploaded: { hash: "image-hash-1" } } }), { status: 200 }),
      new Response(JSON.stringify({ id: "adset-1" }), { status: 200 }),
      new Response(JSON.stringify({ id: "creative-1" }), { status: 200 }),
      new Response(JSON.stringify({ id: "ad-1" }), { status: 200 }),
    ];
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
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
      location: { cities: [{ key: "city-1", radius: 25, distance_unit: "kilometer" }] },
      ageMin: 28,
      ageMax: 58,
      interests: [{ id: "12345", name: "Solar energy" }],
      creatives: [{ imageUrl: "https://example.com/image.png", headline: "Headline", message: "Message" }],
      onCheckpoint: (checkpoint) => {
        checkpoints.push(`${checkpoint.phase}:${checkpoint.externalId}`);
      },
    });

    expect(result).toMatchObject({ campaignId: "campaign-1", adSetId: "adset-1", adIds: ["ad-1"] });
    const adsetCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/adsets"));
    const payload = new URLSearchParams(String(adsetCall?.[1]?.body));
    expect(JSON.parse(payload.get("targeting")!)).toEqual({
      geo_locations: { cities: [{ key: "city-1", radius: 25, distance_unit: "kilometer" }], location_types: ["home", "recent"] },
      age_min: 28, age_max: 58,
      flexible_spec: [{ interests: [{ id: "12345", name: "Solar energy" }] }],
      targeting_automation: { advantage_audience: 0 },
    });
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
  it("resolves only exact provider-backed interests, not invented or loosely related matches", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ data: [{ id: "12345", name: "Solar energy" }] }))
      .mockResolvedValueOnce(Response.json({ data: [{ id: "54321", name: "Unrelated" }] }))
      .mockResolvedValueOnce(Response.json({ data: [{ id: "12345", current_status: "NORMAL" }] }));
    await expect(new MetaClient(creds).resolveAudienceInterests(["Solar energy", "Home improvements"]))
      .resolves.toEqual({ interests: [{ id: "12345", name: "Solar energy" }], unresolved: ["Home improvements"] });
    expect(fetchMock.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
  });
  it.each(["DEPRECATING", "NON-DELIVERABLE", "UNKNOWN"])("blocks a catalog interest with status %s", async (current_status) => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ data: [{ id: "12345", name: "Solar energy" }] }))
      .mockResolvedValueOnce(Response.json({ data: [{ id: "12345", current_status }] }));
    await expect(new MetaClient(creds).resolveAudienceInterests(["Solar energy"]))
      .resolves.toEqual({ interests: [], unresolved: ["Solar energy"] });
  });
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
  it.each(["http://localhost./image.png", "http://[::ffff:7f00:1]/image.png"])(
    "rejects private media without fetching or uploading: %s", async (url) => {
      const fetchMock = vi.spyOn(globalThis, "fetch");
      await expect(new MetaClient(creds).uploadAdImage(url)).rejects.toBeInstanceOf(MetaError);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("rejects oversized media before uploading to Meta", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("image", {
      headers: { "content-length": "999999999" },
    }));
    await expect(new MetaClient(creds).uploadAdImage("https://example.com/image.png")).rejects.toThrow("too large");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("rejects malformed creative image URLs before fetch", async () => {
    const client = new MetaClient(creds);
    await expect(client.uploadAdImage("not-a-url")).rejects.toMatchObject({
      name: "MetaError",
      message: "Creative image URL is invalid.",
    });
  });
});
