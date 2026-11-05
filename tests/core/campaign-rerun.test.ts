import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bestCreativeId, rerunPrefill } from "@/lib/campaign/rerun";
import { targetingInputSchema, type DraftInput } from "@/lib/campaign/connect-contracts";
import { emptyAudienceEdit, preparedAudienceForm, withPreparedAudienceForm } from "@/lib/campaign/editor-targeting";
import type { StoredAdResult } from "@/lib/campaign/ad-results-store";

// #1050 "Run this again": a campaign that worked is copied into New campaign, Best ad first. Nothing is
// created and nothing goes to Meta; the owner still reviews and sends it paused.
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const draft: DraftInput = {
  businessId: "44444444-4444-4444-8444-444444444444", name: "Solaride — leads", goal: "Free site surveys in Mohali",
  mode: "manual", creativeIds: [A, B, C], dailyBudgetRupees: 300, leadFormId: null, destination: "whatsapp",
  whatsappLanguage: "hinglish", whatsappMessage: { greeting: "Namaste!", opening: { kind: "prefill", prefill: "Free site survey", callButton: false }, language: "hinglish" },
  targeting: { location: { includedNames: ["Mohali", "Panchkula"], excludedNames: ["Shimla"] } } as DraftInput["targeting"], abTest: false,
};
const campaign = { name: "Solaride — leads", creative_ids: [A, B, C], daily_budget: 300, destination: "whatsapp" };
const row = (id: string, conversations: number, spendRupees: number): StoredAdResult => ({
  meta_ad_id: id, ad_name: `Ad ${id}`, effective_status: "ACTIVE", delivered: true, impressions: 1000, link_clicks: 20,
  conversations, leads: 0, spend_paise: spendRupees * 100, synced_at: "2026-10-27T10:00:00.000Z",
});

describe("core: Run this again (#1050)", () => {
  it("copies the launch draft (destination, WhatsApp message, areas, exclusions, budget) with the Best ad first", () => {
    const prefill = rerunPrefill({ campaign, draft, approvedIds: [A, B, C], bestCreativeId: C });
    expect(prefill).toEqual({
      name: "Solaride — leads (again)", goal: "Free site surveys in Mohali", creativeIds: [C, A, B], dailyBudgetRupees: 300,
      destination: "whatsapp", leadFormId: null, whatsappNumber: undefined, whatsappLanguage: "hinglish",
      whatsappMessage: draft.whatsappMessage, targeting: draft.targeting, abTest: false, dropped: 0, source: "draft",
    });
    // A copy of a copy doesn't pile up "(again)".
    expect(rerunPrefill({ campaign, draft: { ...draft, name: "Solaride — leads (again)" }, approvedIds: [A], bestCreativeId: null })).toMatchObject({ name: "Solaride — leads (again)" });
    expect(rerunPrefill({ campaign, draft: { ...draft, name: "x".repeat(120) }, approvedIds: [A], bestCreativeId: null })).toMatchObject({ name: expect.stringMatching(/^x{112} \(again\)$/) });
  });

  it("preserves the selected WhatsApp identity when copying a draft", () => {
    const chosen: DraftInput = { ...draft, whatsappNumber: "+91 ••••• 4842", whatsappNumberSource: "business", whatsappNumberChoiceId: "a".repeat(64) };
    expect(rerunPrefill({ campaign, draft: chosen, approvedIds: [A], bestCreativeId: null })).toMatchObject({
      whatsappNumber: "+91 ••••• 4842", whatsappNumberSource: "business", whatsappNumberChoiceId: "a".repeat(64),
    });
  });

  it("starts the next run with the Call now button off, keeping the rest of the message (#1174)", () => {
    // CEO on #1174: runs with Call on got 3.8% chats, with it off 8.2%; a copy is the next run, never the live one.
    const withCall: DraftInput = { ...draft, whatsappMessage: { greeting: "Namaste!", opening: { kind: "prefill", prefill: "Free site survey", callButton: true }, language: "hinglish" } };
    expect(rerunPrefill({ campaign, draft: withCall, approvedIds: [A], bestCreativeId: null })).toMatchObject({
      whatsappMessage: { greeting: "Namaste!", opening: { kind: "prefill", prefill: "Free site survey", callButton: false }, language: "hinglish" },
    });
    expect(withCall.whatsappMessage?.opening).toMatchObject({ callButton: true });
    const questions: DraftInput = { ...draft, whatsappMessage: { greeting: "Namaste!", opening: { kind: "ice_breakers", questions: ["Price?"] }, language: "en" } };
    expect(rerunPrefill({ campaign, draft: questions, approvedIds: [A], bestCreativeId: null })).toMatchObject({ whatsappMessage: questions.whatsappMessage });
  });

  it("a run that sent the Brand's saved Call-on message starts the next run with that message, Call off (#1174)", () => {
    const saved = { greeting: "Namaste!", opening: { kind: "prefill", prefill: "Free site survey", callButton: true }, language: "hinglish" };
    const off = { ...saved, opening: { ...saved.opening, callButton: false } };
    const usedSaved: DraftInput = { ...draft, whatsappMessage: undefined };
    expect(rerunPrefill({ campaign, draft: usedSaved, approvedIds: [A], bestCreativeId: null, savedMessage: saved })).toMatchObject({ whatsappMessage: off });
    expect(rerunPrefill({ campaign, draft: null, approvedIds: [A], bestCreativeId: null, savedMessage: saved })).toMatchObject({ source: "campaign", whatsappMessage: off });
    // A saved message with Call off, or none, stays the Brand's: the next run keeps following it.
    expect(rerunPrefill({ campaign, draft: usedSaved, approvedIds: [A], bestCreativeId: null, savedMessage: off })).not.toMatchObject({ whatsappMessage: expect.anything() });
    expect(rerunPrefill({ campaign, draft: usedSaved, approvedIds: [A], bestCreativeId: null, savedMessage: null })).not.toMatchObject({ whatsappMessage: expect.anything() });
    // A form run never picks up a WhatsApp message.
    expect(rerunPrefill({ campaign, draft: { ...usedSaved, destination: "instant_form" }, approvedIds: [A], bestCreativeId: null, savedMessage: saved })).not.toMatchObject({ whatsappMessage: expect.anything() });
  });

  it("copies an old lead-form draft saved before destinations existed as a form campaign (#1216)", () => {
    const old = { ...draft, destination: undefined, leadFormId: "900000000000216", whatsappMessage: undefined, whatsappLanguage: undefined };
    expect(rerunPrefill({ campaign: { ...campaign, destination: "instant_form" }, draft: old, approvedIds: [A], bestCreativeId: null }))
      .toMatchObject({ destination: "instant_form", leadFormId: "900000000000216", source: "draft" });
  });

  it("leaves out ads that are no longer approved, and says how many", () => {
    expect(rerunPrefill({ campaign, draft, approvedIds: [A, C], bestCreativeId: B })).toMatchObject({ creativeIds: [A, C], dropped: 1 });
    expect(rerunPrefill({ campaign, draft, approvedIds: [], bestCreativeId: A })).toEqual({ error: expect.stringMatching(/None of this campaign's ads is approved anymore/) });
    expect(rerunPrefill({ campaign: { ...campaign, creative_ids: [] }, draft: null, approvedIds: [], bestCreativeId: null })).toEqual({ error: expect.stringMatching(/no AdBrain ads to copy/) });
  });

  it("an ended or synced campaign without its draft falls back to its own ads, budget and destination", () => {
    expect(rerunPrefill({ campaign: { name: null, creative_ids: [B, A], daily_budget: 450, destination: "instant_form" }, draft: null, approvedIds: [A, B], bestCreativeId: A }))
      .toEqual({ name: "Campaign (again)", goal: "", creativeIds: [A, B], dailyBudgetRupees: 450, destination: "instant_form", leadFormId: null, abTest: false, dropped: 0, source: "campaign" });
    expect(rerunPrefill({ campaign: { name: "Old", creative_ids: [A], daily_budget: null, destination: "mixed" }, draft: null, approvedIds: [A], bestCreativeId: null }))
      .toMatchObject({ dailyBudgetRupees: 300, destination: undefined });
  });

  // #773 (CEO, Nov 2): Edit audience on a running campaign saves the change for its next run; the copy starts with it.
  it("starts the copy with the audience change saved while the campaign ran", () => {
    const prepared = { ...emptyAudienceEdit, included: [{ key: "1029599", name: "Mohali", type: "city" }], excluded: [{ key: "1743", name: "Rajasthan", type: "region" }],
      cityScope: "radius" as const, radiusKm: 15, ageMin: 30, ageMax: 60, gender: "women" as const };
    const targeting = { gender: "all", location: { mode: "ai", included: [{ key: "2295", name: "Delhi", type: "city" }], excluded: [{ key: "1743", name: "Rajasthan", type: "region" }, { key: "6", name: "Goa", type: "region" }], cityScope: "city_only", includedNames: ["Delhi NCR"], excludedNames: ["Shimla"] }, age: { mode: "ai", min: 25, max: 55 } } as DraftInput["targeting"];
    const prefill = rerunPrefill({ campaign: { ...campaign, prepared }, draft: { ...draft, targeting }, approvedIds: [A], bestCreativeId: null });
    expect(prefill).toMatchObject({ source: "draft", targeting: {
      gender: "women",
      location: {
        mode: "manual", included: [{ key: "1029599", name: "Mohali", type: "city", radiusKm: 15 }], cityScope: "radius", radiusKm: 15, excludedNames: ["Shimla"],
        excluded: [{ key: "1743", name: "Rajasthan", type: "region", radiusKm: 15 }, { key: "6", name: "Goa", type: "region", radiusKm: 15 }],
      },
      age: { mode: "manual", min: 30, max: 60 },
    } });
    expect((prefill as { targeting: DraftInput["targeting"] }).targeting.location).not.toHaveProperty("includedNames");
    // Only what the owner set changes; without a saved change the draft's targeting is kept as it was.
    expect(rerunPrefill({ campaign: { ...campaign, prepared: { ...emptyAudienceEdit, gender: "men" } }, draft: { ...draft, targeting }, approvedIds: [A], bestCreativeId: null }))
      .toMatchObject({ targeting: { gender: "men", location: { mode: "ai", included: [{ key: "2295" }], includedNames: ["Delhi NCR"] }, age: { mode: "ai", min: 25, max: 55 } } });
    expect(rerunPrefill({ campaign: { ...campaign, prepared: null }, draft: { ...draft, targeting }, approvedIds: [A], bestCreativeId: null })).toMatchObject({ targeting });
    expect(rerunPrefill({ campaign: { ...campaign, prepared: { ...emptyAudienceEdit, ageMin: 30, ageMax: 60 } }, draft: null, approvedIds: [A], bestCreativeId: null }))
      .toMatchObject({ source: "campaign", targeting: { age: { mode: "manual", min: 30, max: 60 } } });
    // A paused edit allows 1 km, the composer 5 km: the copy's draft must still save.
    const near = rerunPrefill({ campaign: { ...campaign, prepared: { ...prepared, radiusKm: 3 } }, draft: null, approvedIds: [A], bestCreativeId: null });
    expect(targetingInputSchema.safeParse((near as { targeting: unknown }).targeting).success).toBe(true);
    expect(near).toMatchObject({ targeting: { location: { radiusKm: 5, included: [{ radiusKm: 5 }] } } });
  });

  it("a running Save's form reaches the page row, so a second edit starts from the first", () => {
    const form = { ...emptyAudienceEdit, included: [{ key: "2295", name: "Delhi", type: "city" as const }] };
    const row = withPreparedAudienceForm({ id: "c-1", raw: { metaResult: { campaignId: "1" } } }, form);
    expect(row.raw).toMatchObject({ metaResult: { campaignId: "1" } });
    expect(preparedAudienceForm(row.raw)).toEqual(form);
    expect(preparedAudienceForm(withPreparedAudienceForm({ raw: null }, form).raw)).toEqual(form);
    // A paused Save applied the change in Meta and the server cleared it; reopening must not offer it again.
    expect(withPreparedAudienceForm(row, null).raw).toEqual({ metaResult: { campaignId: "1" } });
  });

  it("finds the Best ad's creative through the launch's ad links (#783's rule: 5+ results, 30% cheaper)", () => {
    const rows = [row("901", 8, 400), row("902", 3, 450), row("903", 0, 120)];
    const links = [{ meta_ad_id: "901", creative_id: B }, { meta_ad_id: "902", creative_id: A }, { meta_ad_id: "903", creative_id: null }];
    expect(bestCreativeId(rows, links, "whatsapp")).toBe(B);
    expect(bestCreativeId(rows, links, "instant_form")).toBeNull();
    expect(bestCreativeId(rows, [], "whatsapp")).toBeNull();
  });
});

const state = vi.hoisted(() => ({
  user: { id: "u1" } as { id: string } | null,
  tables: {} as Record<string, unknown>,
  filters: [] as string[],
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    from: (table: string) => {
      const result = () => ({ data: state.tables[table] ?? null, error: null });
      const query = {
        select: () => query,
        eq: (key: string, value: unknown) => { state.filters.push(`${table}.${key}=${value}`); return query; },
        in: (key: string) => { state.filters.push(`${table}.${key} in`); return query; },
        is: () => query,
        order: () => query,
        limit: () => Object.assign(Promise.resolve(result()), query),
        maybeSingle: async () => result(),
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve),
      };
      return query;
    },
  }),
}));

const call = async () => {
  const { GET } = await import("@/app/api/campaigns/[id]/rerun/route");
  const response = await GET(new Request("http://localhost/api/campaigns/c1/rerun"), { params: Promise.resolve({ id: "c1" }) });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
};

beforeEach(() => {
  state.user = { id: "u1" };
  state.filters = [];
  state.tables = {
    campaigns: { id: "c1", business_id: "b1", ...campaign },
    campaign_operations: { draft_id: "d1" },
    campaign_drafts: { input: draft },
    creatives: [{ id: A }, { id: B }, { id: C }],
    ad_results: [row("901", 8, 400), row("902", 3, 450)],
    campaign_ads: [{ meta_ad_id: "901", creative_id: B }, { meta_ad_id: "902", creative_id: A }],
  };
});
afterEach(() => vi.unstubAllEnvs());

describe("GET /api/campaigns/[id]/rerun (#1050)", () => {
  it("needs a session and the owner's own campaign", async () => {
    state.user = null;
    expect((await call()).status).toBe(401);
    state.user = { id: "u1" };
    state.tables.campaigns = null;
    expect((await call()).status).toBe(404);
  });

  it("returns the draft's prefill, Best first once per-ad results are on, reading only approved ads of this business", async () => {
    expect((await call()).body).toMatchObject({ ok: true, prefill: { creativeIds: [A, B, C], source: "draft", destination: "whatsapp" } });
    vi.stubEnv("AD_RESULTS_ENABLED", "true");
    const { status, body } = await call();
    expect(status).toBe(200);
    expect(body).toMatchObject({ prefill: { creativeIds: [B, A, C], name: "Solaride — leads (again)" } });
    expect(state.filters).toEqual(expect.arrayContaining(["campaign_operations.campaign_id=c1", "campaign_operations.state=succeeded", "campaign_drafts.id=d1", "creatives.business_id=b1", "creatives.status=approved"]));
  });

  it("falls back to the campaign row without a launch draft, and refuses when no ad is approved", async () => {
    state.tables.campaign_operations = null;
    expect((await call()).body).toMatchObject({ prefill: { source: "campaign", creativeIds: [A, B, C] } });
    state.tables.creatives = [];
    const { status, body } = await call();
    expect(status).toBe(409);
    expect(body).toMatchObject({ error: expect.stringMatching(/approved anymore/) });
  });

  it("reads the Brand's saved message only for a WhatsApp run without its own, and turns its Call button off (#1174)", async () => {
    state.tables.businesses = { whatsapp_template: { greeting: "Hi", opening: { kind: "prefill", prefill: "Price?", callButton: true }, language: "en" } };
    expect((await call()).body).toMatchObject({ prefill: { whatsappMessage: draft.whatsappMessage } });
    expect(state.filters).not.toContain("businesses.id=b1");
    state.tables.campaign_drafts = { input: { ...draft, whatsappMessage: undefined } };
    expect((await call()).body).toMatchObject({ prefill: { whatsappMessage: { greeting: "Hi", opening: { kind: "prefill", prefill: "Price?", callButton: false } } } });
    expect(state.filters).toContain("businesses.id=b1");
  });
});
