import { afterEach, describe, expect, it, vi } from "vitest";
import { friendlyMetaError, MetaClient, MetaError } from "@/lib/meta/client";
import { targetingInputSchema } from "@/lib/campaign/connect-contracts";
import { decodeCampaignInsights } from "@/lib/meta/insights";

const creds = {
  adAccountId: "act_123",
  pageId: "999",
  accessToken: "tok",
};

afterEach(() => vi.restoreAllMocks());

describe("MetaClient Page-token lookup", () => {
  it("does not send a provider request after the worker deadline expires", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    await expect(new MetaClient(creds, AbortSignal.abort(new Error("Execution stopped"))).getPageAccessToken()).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("aborts an in-flight provider read when the worker stops", async () => {
    const controller = new AbortController();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, options) => {
      controller.abort();
      expect(options?.signal?.aborted).toBe(true);
      throw new DOMException("Execution stopped", "AbortError");
    });
    await expect(new MetaClient(creds, controller.signal).searchGeoLocations("Jaipur")).rejects.toThrow("Execution stopped");
  });

  it.each([
    [{ id: "999", has_whatsapp_business_number: true, whatsapp_number: "+91 98765-43210" }, "+919876543210"],
    [{ id: "999", has_whatsapp_business_number: false, whatsapp_number: "+919876543210" }, null],
    [{ id: "other", has_whatsapp_business_number: true, whatsapp_number: "+919876543210" }, null],
    [{ id: "999", has_whatsapp_business_number: true, whatsapp_number: "123<script>" }, null],
    [{ id: "999", has_whatsapp_business_number: true }, null],
  ])("requires Page-owned WhatsApp Business number evidence: %j", async (page, expected) => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ access_token: "page-token" }))
      .mockResolvedValueOnce(Response.json(page));
    expect(await new MetaClient(creds).getWhatsAppNumber()).toBe(expected);
    expect(fetchMock.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
  });

  it("propagates search cancellation to the provider request", async () => {
    const controller = new AbortController();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, options) => {
      controller.abort();
      expect(options?.signal?.aborted).toBe(true);
      throw new DOMException("Cancelled", "AbortError");
    });
    await expect(new MetaClient(creds).searchGeoLocations("Jaipur", { signal: controller.signal })).rejects.toThrow("Cancelled");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("shares concurrent and subsequent lookups only within one client", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json({ access_token: "page-token" }));
    const client = new MetaClient(creds);
    expect(await Promise.all([client.getPageAccessToken(), client.getPageAccessToken(), client.getPageAccessToken()])).toEqual(["page-token", "page-token", "page-token"]);
    await client.getPageAccessToken();
    expect(fetchMock).toHaveBeenCalledOnce();
    await new MetaClient({ ...creds, pageId: "another-page" }).getPageAccessToken();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not cache failed token lookups", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({}))
      .mockResolvedValueOnce(Response.json({ access_token: "page-token" }));
    const client = new MetaClient(creds);
    await expect(client.getPageAccessToken()).rejects.toThrow("page access token");
    await expect(client.getPageAccessToken()).resolves.toBe("page-token");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

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
  it.each([false, true])("selects canonical lead counts independent of action order (reverse=%s)", reverse => {
    const actions = [
      { action_type: "offsite_conversion.fb_pixel_lead", value: "99" },
      { action_type: "onsite_conversion.lead_grouped", value: "4" },
      { action_type: "lead", value: "5" },
    ];
    expect(decodeCampaignInsights({ data: [{ spend: "100.50", actions: reverse ? actions.reverse() : actions }] }, "instant_form"))
      .toMatchObject({ leads: 5, spend: 100.5, cpl: 20.1 });
  });

  it("uses grouped leads only when the aggregate is absent, never substring matches", () => {
    expect(decodeCampaignInsights({ data: [{ actions: [{ action_type: "onsite_conversion.lead_grouped", value: "4" }] }] }, "instant_form").leads).toBe(4);
    expect(decodeCampaignInsights({ data: [{ actions: [{ action_type: "unrelated_lead_event", value: "99" }] }] }, "instant_form").leads).toBe(0);
  });

  it("does not reject fractional metrics for unrelated actions", () => {
    expect(decodeCampaignInsights({ data: [{ actions: [{ action_type: "unrelated", value: "1.25" }, { action_type: "lead", value: "0" }, { action_type: "onsite_conversion.lead_grouped", value: "4" }] }] }, "instant_form").leads).toBe(0);
  });

  it.each([
    {}, { data: null }, { data: [{}, {}] }, { data: [], paging: { next: "more" } },
    { data: [{ spend: "NaN" }] }, { data: [{ spend: "-1" }] }, { data: [{ spend: "" }] },
    { data: [{ impressions: "1.5" }] }, { data: [{ clicks: "9007199254740992" }] },
    { data: [{ actions: [{ action_type: "lead", value: "1.5" }] }] },
    { data: [{ date_start: "2026-09-20", date_stop: "2026-09-19" }] },
    { data: [{ actions: [{ action_type: "lead", value: "2" }, { action_type: "lead", value: "3" }] }] },
  ])("rejects malformed or ambiguous snapshots: %j", payload => {
    expect(() => decodeCampaignInsights(payload, "instant_form")).toThrow();
  });

  it("accepts explicit empty insights as no delivery", () => {
    expect(decodeCampaignInsights({ data: [] }, "whatsapp")).toMatchObject({ spend: 0, leads: 0, conversations: 0, cpl: null, costPerConversation: null });
  });

  it("rejects a malformed provider response after verified binding", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ id: "camp_1", account_id: "123" }))
      .mockResolvedValueOnce(Response.json({ data: [{ destination_type: "ON_AD", promoted_object: { page_id: "999" } }] }))
      .mockResolvedValueOnce(Response.json({}));
    await expect(new MetaClient(creds).getCampaignInsights("camp_1")).rejects.toThrow("incomplete or invalid");
  });

  it("counts WhatsApp conversation starts separately without summing overlapping messaging actions", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ id: "camp_1", account_id: "123" }))
      .mockResolvedValueOnce(Response.json({ data: [{ destination_type: "WHATSAPP", promoted_object: { page_id: "999" } }] }))
      .mockResolvedValueOnce(Response.json({ data: [{ spend: "150", actions: [
        { action_type: "onsite_conversion.messaging_conversation_started_7d", value: "3" },
        { action_type: "onsite_conversion.total_messaging_connection", value: "5" },
      ] }] }));
    expect(await new MetaClient(creds).getCampaignInsights("camp_1")).toMatchObject({ leads: 0, cpl: null, conversations: 3, costPerConversation: 50 });
  });

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
      .toEqual({ dailyBudgetRupees: 500, adSetId: "set", destination: "unknown" });
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
  it("rejects unsupported gender values in saved targeting and before provider mutation", async () => {
    expect(targetingInputSchema.safeParse({ gender: "invalid" }).success).toBe(false);
    expect(targetingInputSchema.safeParse({}).success).toBe(true);
    const fetchMock = vi.spyOn(globalThis, "fetch");
    await expect(new MetaClient(creds).createLeadCampaign({
      name: "Invalid gender", dailyBudgetRupees: 200, leadFormId: "form-1", link: "https://example.com", creatives: [],
      location: { countries: ["IN"] }, ageMin: 25, ageMax: 65, gender: "invalid" as "all",
    })).rejects.toThrow("gender demographic");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["all", "men", "women", undefined] as const)("maps gender %s across all age variants", async (gender) => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json({ id: "created-id" }));
    await new MetaClient(creds).createLeadCampaign({
      name: "Demographics", dailyBudgetRupees: 200, leadFormId: "form-1", link: "https://example.com", creatives: [],
      location: { countries: ["IN"] }, gender, variants: [{ ageMin: 25, ageMax: 39 }, { ageMin: 40, ageMax: 65 }],
    });
    const adsets = fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/adsets"));
    expect(adsets).toHaveLength(2);
    for (const [, init] of adsets) {
      const targeting = JSON.parse(new URLSearchParams(String(init?.body)).get("targeting")!);
      expect(targeting.genders).toEqual(gender === "men" ? [1] : gender === "women" ? [2] : undefined);
    }
  });

  it("creates WhatsApp ads paused with the verified recipient and no form", async () => {
    const client = new MetaClient(creds);
    vi.spyOn(client, "getWhatsAppNumber").mockResolvedValue("+919876543210");
    vi.spyOn(client, "uploadAdImage").mockResolvedValue("image-hash");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json({ id: "created-id" }));
    await client.createLeadCampaign({ name: "WhatsApp", dailyBudgetRupees: 200, destination: "whatsapp", whatsappNumber: "+919876543210", link: "https://example.com", creatives: [{ imageUrl: "https://example.com/ad.png", headline: "Offer", message: "Contact us" }], location: { countries: ["IN"] }, ageMin: 25, ageMax: 60 });
    const forms = fetchMock.mock.calls.map(([, init]) => new URLSearchParams(String(init?.body)));
    expect(forms[0].get("objective")).toBe("OUTCOME_ENGAGEMENT");
    expect(forms[1].get("destination_type")).toBe("WHATSAPP");
    expect(forms[1].get("optimization_goal")).toBe("CONVERSATIONS");
    expect(JSON.parse(forms[1].get("promoted_object")!)).toEqual({ page_id: "999", whatsapp_phone_number: "+919876543210" });
    const story = JSON.parse(forms[2].get("object_story_spec")!);
    expect(story.link_data.link).toBe("https://wa.me/919876543210");
    expect(story.link_data.call_to_action.value).not.toHaveProperty("lead_gen_form_id");
    expect([forms[0], forms[1], forms[3]].every(form => form.get("status") === "PAUSED")).toBe(true);
  });

  it.each([undefined, "+919876543211"])("blocks missing or changed WhatsApp recipient before mutation: %s", async (whatsappNumber) => {
    const client = new MetaClient(creds);
    vi.spyOn(client, "getWhatsAppNumber").mockResolvedValue("+919876543210");
    const fetchMock = vi.spyOn(globalThis, "fetch");
    await expect(client.createLeadCampaign({ name: "WhatsApp", dailyBudgetRupees: 200, destination: "whatsapp", whatsappNumber, link: "https://example.com", creatives: [], location: { countries: ["IN"] }, ageMin: 25, ageMax: 60 })).rejects.toThrow(/WhatsApp/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

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
  it("does not add a radius to city-only locations in any ad set", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json({ id: "created-id" }));
    await new MetaClient(creds).createLeadCampaign({
      name: "City coverage", dailyBudgetRupees: 200, leadFormId: "form-1", link: "https://example.com", creatives: [],
      location: { cities: [{ key: "city-1" }] }, excludedLocation: { cities: [{ key: "city-2" }] },
      variants: [{ ageMin: 25, ageMax: 39 }, { ageMin: 40, ageMax: 65 }],
    });
    const adsets = fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/adsets"));
    expect(adsets).toHaveLength(2);
    for (const [, init] of adsets) {
      const targeting = JSON.parse(new URLSearchParams(String(init?.body)).get("targeting")!);
      expect(targeting.geo_locations.cities).toEqual([{ key: "city-1" }]);
      expect(targeting.excluded_geo_locations.cities).toEqual([{ key: "city-2" }]);
    }
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
      creatives: [{ imageUrl: "https://example.com/image.png", headline: "Headline", message: "Message", description: "Discuss your rooftop plans." }],
      onCheckpoint: (checkpoint) => {
        checkpoints.push(`${checkpoint.phase}:${checkpoint.externalId}`);
      },
    });

    expect(result).toMatchObject({ campaignId: "campaign-1", adSetId: "adset-1", adIds: ["ad-1"] });
    const creativeCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/adcreatives"));
    const story = JSON.parse(new URLSearchParams(String(creativeCall?.[1]?.body)).get("object_story_spec")!);
    expect(story.link_data.description).toBe("Discuss your rooftop plans.");
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

  it.each(["bid_strategy is incompatible with daily_budget", "Invalid bidding strategy"])("distinguishes bidding configuration from budget amounts: %s", (message) => {
    expect(friendlyMetaError(new MetaError(message))).toContain("Meta rejected the bidding strategy.");
  });

  it("distinguishes billing events from budget amounts", () => {
    expect(friendlyMetaError(new MetaError("billing_event is invalid for this daily_budget"))).toContain("Meta rejected the billing event");
  });

  it("retains budget guidance for budget validation failures", () => {
    expect(friendlyMetaError(new MetaError("daily_budget is below the minimum"))).toBe(
      "Meta rejected the budget settings. Check the daily budget and try again.",
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
