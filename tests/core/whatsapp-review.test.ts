import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import recorded from "./fixtures/meta/whatsapp-number.json";
import refused from "./fixtures/meta/whatsapp-business-refused.json";
import { prepareCampaignReview, type PreflightLoaders } from "@/lib/campaign/preflight-service";
import type { DraftRecord } from "@/lib/campaign/draft-store";
import type { WhatsAppNumberSource } from "@/lib/meta/whatsapp-status-shared";
import { MetaClient } from "@/lib/meta/client";
import { whatsappNumberForBusiness } from "@/lib/meta/whatsapp-bindings";

const db = vi.hoisted(() => ({ bound: [] as string[], sources: {} as Record<string, string>, managed: false, writes: [] as unknown[] }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => table === "whatsapp_number_bindings"
          ? Promise.resolve({ data: db.bound.map((phone_e164) => ({ phone_e164, source: db.sources[phone_e164] ?? "owner_pick" })), error: null })
          : { maybeSingle: async () => ({ data: db.managed ? { business_id: "b" } : null, error: null }) },
      }),
      upsert: async (row: unknown) => { db.writes.push(row); return { error: null }; },
    }),
  }),
}));

const creds = { adAccountId: "act_9000000000000001", pageId: "900000000000002", accessToken: "test-token" };
const actor = { businessId: "11111111-1111-4111-8111-111111111111", userId: "owner" };
const pageNumber = "+919999991111";
const masked = "+91 ••••• 1111";
const waba = "owned_whatsapp_business_accounts";
const secret = "test-meta-app-secret-for-choices";

function choiceId(businessId: string, source: WhatsAppNumberSource, number: string) {
  return createHmac("sha256", secret).update(`whatsapp-choice:v1\0${businessId}\0${source}\0${number}`).digest("hex");
}

function replay(page: unknown, denied = true, tape: { path: string; status: number; body: unknown }[] = recorded.tape) {
  const calls: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    expect(init?.method ?? "GET").toBe("GET");
    const url = new URL(String(input));
    url.searchParams.delete("appsecret_proof");
    const path = decodeURIComponent(url.pathname.replace("/v26.0/", "") + url.search);
    calls.push(path);
    if (path === `${creds.pageId}?fields=access_token`) return Response.json({ access_token: "page-token" });
    if (path.startsWith(`${creds.pageId}?fields=id,has_whatsapp_business_number`)) return Response.json(page);
    if (denied && path.includes(waba)) return Response.json(refused.body, { status: refused.status });
    const exchange = tape.find((entry) => entry.path === path);
    if (!exchange) throw new Error(`Unrecorded Graph call: ${path}`);
    return Response.json(exchange.body, { status: exchange.status });
  });
  return calls;
}

function review(source?: WhatsAppNumberSource, identity?: string, requested = masked) {
  const draft: DraftRecord = {
    id: "draft", businessId: actor.businessId, ownerId: actor.userId, version: 1,
    createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z", expiresAt: "2026-12-01T00:00:00Z",
    input: {
      businessId: actor.businessId, name: "Chats", goal: "Enquiries", mode: "manual",
      creativeIds: ["creative"], dailyBudgetRupees: 300, leadFormId: null, destination: "whatsapp",
      whatsappNumber: requested, ...(source ? { whatsappNumberSource: source } : {}),
      ...(identity ? { whatsappNumberChoiceId: identity } : {}), targeting: {}, abTest: false,
    },
  };
  const meta = new MetaClient(creds);
  const loaders: PreflightLoaders = {
    findDraft: async () => draft,
    findCreatives: async () => [],
    findForm: async () => null,
    findWhatsAppNumber: (owner, requested, chosenSource, identity) => whatsappNumberForBusiness(owner.businessId, meta, requested ?? null, chosenSource, identity),
    getConnection: async () => ({
      generation: 1, canCreatePaused: true,
      selected: { metaBusinessId: null, adAccountId: creds.adAccountId, accountName: "Account", pageId: creds.pageId, pageName: "Page", currency: "INR", timezoneName: "Asia/Kolkata" },
    }),
    resolveGeo: async () => ({ resolvedAreaLabel: "Jaipur", unresolvedNames: [], explicitlyNationwide: false }),
    hash: () => "a".repeat(64),
  };
  return prepareCampaignReview(loaders, {
    actor, draftId: draft.id, requestedDraftVersion: draft.version, now: "2026-11-04T00:00:00Z",
  });
}

beforeEach(() => { db.bound = []; db.sources = {}; db.managed = false; db.writes = []; vi.stubEnv("META_APP_SECRET", secret); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("core: WhatsApp Review through recorded Meta reads", () => {
  it("does not turn a denied business choice into the Page or a not-linked blocker", async () => {
    const calls = replay({ id: creds.pageId, has_whatsapp_business_number: true, whatsapp_number: pageNumber });
    await expect(review("business", choiceId(actor.businessId, "business", pageNumber))).rejects.toMatchObject({ status: 403, code: 200 });
    expect(calls.some((path) => path.includes(waba))).toBe(true);
    expect(db.writes).toEqual([]);
  });

  it("reviews an explicitly selected verified Page despite WABA denial without binding another number", async () => {
    const calls = replay({ id: creds.pageId, has_whatsapp_business_number: true, whatsapp_number: pageNumber });
    const result = await review("page", choiceId(actor.businessId, "page", pageNumber));
    expect(result).toMatchObject({ kind: "review", review: { whatsappNumber: pageNumber } });
    expect(calls.some((path) => path.includes(waba))).toBe(false);
    expect(db.writes).toEqual([]);
  });

  it("propagates an incomplete Page read through Review instead of reporting an unlinked number", async () => {
    replay({ id: creds.pageId, has_whatsapp_business_number: true });
    await expect(review("page", choiceId(actor.businessId, "page", pageNumber))).rejects.toThrow("WhatsApp Page number could not be read");
    expect(db.writes).toEqual([]);
  });

  it("does not bind a replacement business number with the same mask as the saved choice", async () => {
    const previous = "+919876541111";
    const replacement = "+918888881111";
    const tape = recorded.tape.map((entry) => entry.path.includes(waba) ? {
      ...entry, body: { data: [{ id: "123", phone_numbers: { data: [{ display_phone_number: replacement }] } }] },
    } : entry);
    replay({ id: creds.pageId }, false, tape);
    const result = await review("business", choiceId(actor.businessId, "business", previous));
    expect(result).toMatchObject({ kind: "review", review: {
      whatsappNumber: null, blockers: expect.arrayContaining([expect.objectContaining({ reason: "REVIEW_WHATSAPP_CHOOSE" })]),
    } });
    expect(db.writes).toEqual([]);
  });

  it("does not accept another business's opaque choice or bind it", async () => {
    const tape = recorded.tape.map((entry) => entry.path.includes(waba) ? {
      ...entry, body: { data: [{ id: "123", phone_numbers: { data: [{ display_phone_number: pageNumber }] } }] },
    } : entry);
    replay({ id: creds.pageId }, false, tape);
    const result = await review("business", choiceId("22222222-2222-4222-8222-222222222222", "business", pageNumber));
    expect(result).toMatchObject({ kind: "review", review: {
      whatsappNumber: null, blockers: expect.arrayContaining([expect.objectContaining({ reason: "REVIEW_WHATSAPP_CHOOSE" })]),
    } });
    expect(db.writes).toEqual([]);
  });

  it("requires a fresh selection for a legacy masked draft, even when its mask still matches", async () => {
    const calls = replay({ id: creds.pageId, has_whatsapp_business_number: true, whatsapp_number: pageNumber });
    const result = await review("page");
    expect(result).toMatchObject({ kind: "review", review: {
      whatsappNumber: null, blockers: expect.arrayContaining([expect.objectContaining({ reason: "REVIEW_WHATSAPP_CHOOSE" })]),
    } });
    expect(calls).toEqual([]);
    expect(db.writes).toEqual([]);
  });

  it("continues to verify a legacy full number by exact equality", async () => {
    replay({ id: creds.pageId, has_whatsapp_business_number: true, whatsapp_number: pageNumber });
    const result = await review(undefined, undefined, pageNumber);
    expect(result).toMatchObject({ kind: "review", review: { whatsappNumber: pageNumber, whatsappNumberSource: "page" } });
    expect(db.writes).toEqual([]);
  });

  it("does not let a stale managed Page-link binding authorize a business number", async () => {
    db.managed = true;
    db.bound = [pageNumber];
    db.sources[pageNumber] = "page_link";
    const tape = recorded.tape.map((entry) => entry.path.includes(waba) ? {
      ...entry, body: { data: [{ id: "123", phone_numbers: { data: [{ display_phone_number: pageNumber }] } }] },
    } : entry);
    replay({ id: creds.pageId }, false, tape);
    const result = await review("business", choiceId(actor.businessId, "business", pageNumber));
    expect(result).toMatchObject({ kind: "review", review: { whatsappNumber: null } });
    expect(db.writes).toEqual([]);
  });

  it("preserves the reviewed source for the final create check", async () => {
    replay({ id: creds.pageId, has_whatsapp_business_number: true, whatsapp_number: pageNumber });
    const result = await review("page", choiceId(actor.businessId, "page", pageNumber));
    expect(result).toMatchObject({ kind: "review", review: { whatsappNumber: pageNumber, whatsappNumberSource: "page" } });
  });
});
