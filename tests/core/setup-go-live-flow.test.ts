import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import createTape from "./fixtures/meta/create.json";
import deliveryTape from "./fixtures/meta/delivery.json";
import whatsappTape from "./fixtures/meta/whatsapp-number.json";
import { activationConfirmationPayload } from "@/lib/campaign/activation";
import type { DraftInput, OperationDTO, ReviewDTO } from "@/lib/campaign/connect-contracts";
import { goLive, goLiveStorageKey, type GoLiveDeps, type GoLiveInput, type GoLiveStep } from "@/lib/campaign/setup-go-live-flow";
import { MetaClient, type CampaignDeliverySnapshot } from "@/lib/meta/client";
import type { ConnectionDTO } from "@/lib/meta/connect-contracts";
import { maskWhatsAppNumber } from "@/lib/meta/whatsapp-status-shared";
import { createMetaConnectClient } from "@/lib/meta-connect-ui/client";

// #1271 (#1251 WS1 slice 4b): setup's one-tap Go live, driven through the real browser client (its schemas parse
// every answer) against a stand-in AdBrain API whose Meta-derived answers come from the recordings:
// - the campaign Meta created (create.json: campaign, ad set, ad ids on act_9000000000000001 / Page 900000000000002,
//   ₹200 a day), stored as the create route stores it (launch-routes.test.ts);
// - GET /api/campaigns/[id]'s delivery, read by the real MetaClient from delivery.json (manage-routes.test.ts);
// - the WhatsApp number Meta returned for the Page's business (whatsapp-number.json), masked as AdBrain shows it.
// PATCH checks the digest exactly as the route does (sha256 of activationConfirmationPayload with capDays).
type Exchange = { method: string; path: string; status: number; body: unknown };

const BUSINESS = "816aaafb-7ebc-4ad7-bbda-001beff172f8";
const ADS = [
  { id: "e3d165a9-bbf8-47f7-8c61-e69dbb8ee3d1", headline: "Diwali Renewal, Starting With Your Spine" },
  { id: "0b6f8f53-6a54-4f3b-9d0e-5c7d2a4a9c11", headline: "Saturday appointments" },
];
const DRAFT = "90d1d2bb-466c-4889-9af2-edb533e82531";
const OPERATION = "6f1c2b9e-4a7d-4e0f-9b3a-1c2d3e4f5a6b";
const ROW = "00000000-0000-4000-9000-000000000001";
const REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const KEY = "setup-go-live-key-0001";
const GENERATION = 1;
const DAILY = 200;
const [campaignPost, , adSetPost, , adPost] = createTape as Exchange[];
const META = {
  campaignId: (campaignPost.body as { id: string }).id,
  adSetId: (adSetPost.body as { id: string }).id,
  adId: (adPost.body as { id: string }).id,
  adAccountId: campaignPost.path.split("/")[0],
  pageId: "900000000000002",
};
const recordedNumber = (() => {
  const accounts = whatsappTape.tape.find((exchange) => exchange.path.includes("owned_whatsapp_business_accounts"))!.body as {
    data: { phone_numbers: { data: { display_phone_number: string }[] } }[];
  };
  return accounts.data[0].phone_numbers.data[0].display_phone_number.replace(/\s/g, "");
})();
const MASKED = maskWhatsAppNumber(recordedNumber);

const available = { state: "available" as const, blockers: [] };
const connection: ConnectionDTO = {
  businessId: BUSINESS, generation: GENERATION, authorization: "connected", checkedAt: "2026-10-25T00:00:00.000Z",
  selected: { metaBusinessId: null, adAccountId: META.adAccountId, accountName: "Solaride 101", pageId: META.pageId, pageName: "Solaride Energy", currency: "INR", timezoneName: "Asia/Kolkata" },
  capabilities: { canReadInsights: available, canReadLeads: available, canCreatePaused: available, canActivate: available },
};
// The paused campaign row the create route stores for the recorded launch.
const campaignRow = {
  id: ROW, business_id: BUSINESS, name: "Setup", objective: "leads", status: "paused" as const, daily_budget: DAILY,
  meta_campaign_id: META.campaignId, meta_adset_id: META.adSetId, meta_ad_ids: [META.adId],
  meta_ad_account_id: META.adAccountId, meta_page_id: META.pageId, meta_connection_generation: GENERATION,
  raw: { source: "campaign_operation", metaResult: { campaignId: META.campaignId, adSetIds: [META.adSetId], adIds: [META.adId] } },
};
const weeklyCapRefusal = "Activating this would commit about ₹2,100 a week, over your ₹1,000 a week cap. Raise the cap in Settings or pause another campaign first.";
const noWebsite = { code: "PREFLIGHT_BLOCKED" as const, reason: "REVIEW_NO_WEBSITE" as const, action: { kind: "open_brand" as const },
  message: "Add your business website on the Your business page. Meta lead ads must link to the advertiser's own website, not Facebook." };

/** GET /api/campaigns/[id]'s delivery for the recorded launch: the real MetaClient reading delivery.json. */
async function recordedDelivery(): Promise<CampaignDeliverySnapshot> {
  const pending = [...deliveryTape as Exchange[]];
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = new URL(String(input));
    url.searchParams.delete("access_token");
    const path = url.pathname.replace(/^\/v\d+\.\d+\//, "") + url.search;
    const index = pending.findIndex((exchange) => exchange.method === "GET" && exchange.path === path);
    if (index < 0) throw new Error(`Unrecorded Graph call: GET ${path}`);
    const [exchange] = pending.splice(index, 1);
    return Response.json(exchange.body, { status: exchange.status });
  });
  try {
    return await new MetaClient({ adAccountId: META.adAccountId, pageId: META.pageId, accessToken: "core-test" }).readCampaignDelivery(META.campaignId, {
      dailyBudgetRupees: DAILY, status: "paused", adSetIds: [META.adSetId], adIds: [META.adId],
    });
  } finally {
    spy.mockRestore();
  }
}

function memoryStorage() {
  const items = new Map<string, string>();
  return { items, getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => void items.set(key, value), removeItem: (key: string) => void items.delete(key) };
}

type Options = {
  review?: Partial<ReviewDTO>;
  created?: OperationDTO["state"];
  patch?: { status: number; body: unknown };
  existing?: OperationDTO | null;
};

async function api(options: Options = {}) {
  const delivery = await recordedDelivery();
  const calls: string[] = [];
  const bodies: Record<string, unknown> = {};
  let draftInput: DraftInput | null = null;
  const operation = (state: OperationDTO["state"]): OperationDTO => ({
    operationId: OPERATION, businessId: BUSINESS, state, campaignId: state === "succeeded" ? ROW : null,
    blockers: state === "failed" ? [{ code: "UNAVAILABLE" as const, message: "Meta refused the ad image.", action: null }] : [],
  });
  const ok = (data: unknown) => Response.json({ ok: true, data, requestId: REQUEST_ID });
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const method = init?.method ?? "GET";
    calls.push(`${method} ${url.pathname}`);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (body !== undefined) bodies[`${method} ${url.pathname}`] = body;
    switch (`${method} ${url.pathname}`) {
      case "GET /api/meta/connections/status": return ok(connection);
      case "GET /api/meta/whatsapp": return Response.json({ state: "ready", numbers: [{ masked: MASKED, source: "business" }] });
      case "POST /api/campaign-drafts":
        draftInput = body;
        return ok({ draftId: DRAFT, version: 1, expiresAt: "2099-01-01T00:00:00.000Z", input: body });
      case "POST /api/campaigns/preflight":
        return ok({
          draftId: DRAFT, draftVersion: 1, connectionGeneration: GENERATION, canCreatePaused: true, blockers: [], planHash: "c".repeat(64),
          destination: "whatsapp", whatsappNumber: recordedNumber, currency: "INR", perAdSetDailyBudgetRupees: DAILY, adSetCount: 1,
          totalDailyBudgetRupees: DAILY, resolvedAreaLabel: "Austin, Texas", selected: connection.selected, ...options.review,
        } satisfies ReviewDTO);
      case "POST /api/campaigns/create": return ok(operation("running"));
      case `GET /api/campaigns/operations/${OPERATION}`: return ok(operation(options.created ?? "succeeded"));
      case "GET /api/campaigns/operations": return ok(options.existing ?? null);
      case "GET /api/campaigns/list": return Response.json({ campaigns: [campaignRow], results: {}, nextCursor: null });
      case `GET /api/campaigns/${ROW}`: return Response.json({ delivery, learning: { costPerResultRupees: null, pausedAt: null } });
      case `PATCH /api/campaigns/${ROW}`: {
        const expected = createHash("sha256").update(activationConfirmationPayload(campaignRow, connection, delivery, body.capDays)).digest("hex");
        if (body.confirmationDigest !== expected) return Response.json({ error: "Campaign or child review changed; review the current Meta delivery settings again." }, { status: 409 });
        if (options.patch) return Response.json(options.patch.body, { status: options.patch.status });
        return Response.json({ ok: true, status: "active" });
      }
    }
    throw new Error(`Unexpected AdBrain call: ${method} ${url.pathname}`);
  });
  const storage = memoryStorage();
  const deps: GoLiveDeps = {
    client: createMetaConnectClient({ fetchImpl: fetchImpl as typeof fetch }), fetch: fetchImpl as typeof fetch, storage,
    newKey: () => KEY, sleep: async () => {}, now: () => new Date("2026-10-28T10:00:00+05:30"),
  };
  return { deps, calls, bodies, storage, draft: () => draftInput };
}

const input: GoLiveInput = { businessId: BUSINESS, businessName: "Cedar Ridge Chiropractic", ads: ADS, dailyBudgetRupees: DAILY, capDays: 2 };
const writes = (calls: string[]) => calls.filter((call) => !call.startsWith("GET "));

afterEach(() => vi.restoreAllMocks());

describe("core: setup Go live one tap (#1271 4b) on recorded Meta answers", () => {
  it("saves the picked ads at ₹d a day on WhatsApp, reviews, creates paused, then turns it on capped for 2 days", async () => {
    const { deps, calls, bodies, storage, draft } = await api();
    const steps: GoLiveStep[] = [];
    await expect(goLive(deps, input, (step) => steps.push(step))).resolves.toEqual({ kind: "live", campaignId: ROW });
    expect(steps).toEqual(["check", "create", "activate"]);
    expect(calls).toEqual([
      "GET /api/meta/connections/status", "GET /api/meta/whatsapp", "POST /api/campaign-drafts", "POST /api/campaigns/preflight",
      "POST /api/campaigns/create", `GET /api/campaigns/operations/${OPERATION}`, "GET /api/campaigns/list",
      `GET /api/campaigns/${ROW}`, `PATCH /api/campaigns/${ROW}`,
    ]);
    expect(draft()).toEqual({
      businessId: BUSINESS, name: "Diwali Renewal, Starting With Your Spine · WhatsApp · Oct 28", goal: "Diwali Renewal, Starting With Your Spine · WhatsApp · Oct 28",
      mode: "manual", creativeIds: ADS.map((ad) => ad.id), dailyBudgetRupees: DAILY, leadFormId: null, destination: "whatsapp",
      whatsappNumber: MASKED, targeting: expect.any(Object), abTest: false,
    });
    expect(bodies["POST /api/campaigns/create"]).toEqual({ businessId: BUSINESS, draftId: DRAFT, draftVersion: 1, planHash: "c".repeat(64), connectionGeneration: GENERATION, idempotencyKey: KEY });
    expect(bodies[`PATCH /api/campaigns/${ROW}`]).toEqual({ status: "active", confirmationDigest: expect.stringMatching(/^[a-f0-9]{64}$/), connectionGeneration: GENERATION, capDays: 2 });
    expect(storage.items.size).toBe(0);
  });

  it("preflight blockers: says Meta's own words and creates nothing", async () => {
    const { deps, calls, storage } = await api({ review: { canCreatePaused: false, planHash: null, blockers: [noWebsite] } });
    await expect(goLive(deps, input)).resolves.toEqual({ kind: "blocked", messages: [noWebsite.message] });
    expect(writes(calls)).toEqual(["POST /api/campaign-drafts", "POST /api/campaigns/preflight"]);
    expect(storage.items.size).toBe(0);
  });

  it("a create operation that fails activates nothing and forgets the request", async () => {
    const { deps, calls, storage } = await api({ created: "failed" });
    await expect(goLive(deps, input)).resolves.toEqual({ kind: "failed", message: "Meta refused the ad image." });
    expect(calls.some((call) => call.includes("/api/campaigns/list") || call.startsWith("PATCH"))).toBe(false);
    expect(storage.items.size).toBe(0);
  });

  it("the weekly cap refuses the PATCH: 'refused' with the campaign and the server's words; the request is kept", async () => {
    const { deps, storage } = await api({ patch: { status: 422, body: { error: weeklyCapRefusal } } });
    await expect(goLive(deps, input)).resolves.toEqual({ kind: "refused", campaignId: ROW, message: weeklyCapRefusal });
    expect(storage.items.has(goLiveStorageKey(input))).toBe(true);
  });

  it("resume: a stored request whose operation exists is not created again", async () => {
    const existing: OperationDTO = { operationId: OPERATION, businessId: BUSINESS, state: "succeeded", campaignId: ROW, blockers: [] };
    const { deps, calls, storage } = await api({ existing });
    storage.setItem(goLiveStorageKey(input), JSON.stringify({ request: {
      businessId: BUSINESS, draftId: DRAFT, draftVersion: 1, planHash: "c".repeat(64), connectionGeneration: GENERATION, idempotencyKey: KEY,
    } }));
    await expect(goLive(deps, input)).resolves.toEqual({ kind: "live", campaignId: ROW });
    expect(calls).toContain("GET /api/campaigns/operations");
    expect(calls.filter((call) => call === "POST /api/campaigns/create" || call === "POST /api/campaign-drafts")).toEqual([]);
    expect(writes(calls)).toEqual([`PATCH /api/campaigns/${ROW}`]);
  });

  it("resume: a stored request Meta never received is sent again with the same idempotency key", async () => {
    const { deps, calls, bodies, storage } = await api({ existing: null });
    const request = { businessId: BUSINESS, draftId: DRAFT, draftVersion: 1, planHash: "c".repeat(64), connectionGeneration: GENERATION, idempotencyKey: "stored-key-0001" };
    storage.setItem(goLiveStorageKey(input), JSON.stringify({ request }));
    await expect(goLive(deps, input)).resolves.toEqual({ kind: "live", campaignId: ROW });
    expect(calls.filter((call) => call === "POST /api/campaigns/create")).toHaveLength(1);
    expect(bodies["POST /api/campaigns/create"]).toEqual(request);
  });

  it("not connected: asks to connect and calls nothing else", async () => {
    const { deps, calls } = await api();
    deps.client = { ...deps.client, status: async () => ({ ...connection, authorization: "reauth_required" }) };
    await expect(goLive(deps, input)).resolves.toEqual({ kind: "connect" });
    expect(calls).toEqual([]);
  });
});

describe("core: step 3's welcome preview (#1529)", () => {
  it("is Review's own message, from Go live's own draft: the saved one, else AdBrain's", async () => {
    const { setupWelcome } = await import("@/lib/campaign/setup-welcome");
    const { setupDraftInput } = await import("@/lib/campaign/setup-go-live-flow");
    const { campaignWhatsAppMessage } = await import("@/lib/campaign/campaign-whatsapp-message");
    const rows = [
      { id: "a", headline: "Free site survey in Mohali", primary_text: "Cut your power bill. Tap, then press Send: \"I'd like a free site survey\"", image_url: "/a.png", generation: null },
      { id: "x", headline: null, primary_text: "No picture yet", image_url: null, generation: null },
    ];
    const brand = { id: "b1", name: "Solaride", offers: ["Free site survey"], locations: ["Mohali"] };
    const saved = { greeting: "Hi from Solaride!", opening: { kind: "prefill", prefill: "I'd like a free site survey", callButton: true }, language: "en" };
    expect(setupWelcome({ ...brand, whatsapp_template: saved }, rows)).toEqual({
      source: "saved", language: "en", greeting: "Hi from Solaride!", autofill: "I'd like a free site survey", callButton: true,
    });
    const suggested = setupWelcome({ ...brand, whatsapp_template: null }, rows);
    const draft = setupDraftInput({ businessId: "b1", name: "any", adIds: ["a"], dailyBudgetRupees: 500, whatsappNumber: "+919876543210" });
    const review = campaignWhatsAppMessage({ draft, business: { ...brand, whatsapp_template: null }, creatives: [rows[0]] });
    expect(suggested).toMatchObject({ source: "suggested", greeting: review.opening.greeting, autofill: review.opening.autofill });
  });
});
