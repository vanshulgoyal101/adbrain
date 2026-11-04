import { writeFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import recorded from "./fixtures/planner/groq-website.json";
import { draftDtoSchema } from "@/lib/campaign/connect-contracts";
import { PLANNER_PROMPT_VERSION } from "@/lib/campaign/planner";
import { prepareCampaignReview, type PreflightLoaders } from "@/lib/campaign/preflight-service";

// #2599 (CTO, #2595 item 5): a website plan through the real route and real runPlanner, replaying Groq's real reply
// to this exact prompt (recorded free, no Meta call). Only the LLM transport, auth, rate limit and data reads are stubbed.
const mocks = vi.hoisted(() => ({ complete: vi.fn(), meta: vi.fn(), inserted: vi.fn(), prompts: [] as unknown[], metaReads: [] as string[] }));

const business = {
  id: "816aaafb-7ebc-4ad7-bbda-001beff172f8", name: "Cedar Ridge Chiropractic", vertical: "chiropractic clinic",
  description: "Chiropractic care in Austin.", target_audience: null,
  locations: ["Austin, Texas", "Round Rock", "Cedar Park"], offers: ["$49 new-patient exam"], website: "https://cedarridgechiro.com",
};
const creativeId = "e3d165a9-bbf8-47f7-8c61-e69dbb8ee3d1";
// #2688: website plans are internal-only, so this is a confirmed team account.
const teamUser = { id: "user-1", email: "team@adbrain.vanshul.com", email_confirmed_at: "2026-10-01T00:00:00Z" };

vi.mock("@/lib/llm", async (importOriginal) => ({ ...await importOriginal<typeof import("@/lib/llm")>(), complete: mocks.complete }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: teamUser } }) },
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ gt: async () => ({ data: [], error: null }) }) }) }),
      insert: (row: Record<string, unknown>) => (mocks.inserted(row), {
        select: () => ({ single: async () => ({ data: { id: "d123d123-d123-4123-8123-d123d123d123", ...row }, error: null }) }),
      }),
    }),
  }),
}));
vi.mock("@/lib/security/rate-limit", () => ({ rateLimitResponse: async () => null }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/lib/llm/persist", () => ({ configuredMonthlyTokenLimit: () => 1_000_000, monthlyTokenUsage: async () => 0, persistLLMUsage: vi.fn() }));
vi.mock("@/lib/supabase/queries", () => ({
  getPrimaryBusiness: async () => business,
  getApprovedCreatives: async () => [{ id: creativeId, angle: "value", headline: "Your Spine, Back in Line", image_url: "https://example.com/ad.png",
    primary_text: "A $49 new-patient exam. Book on our website.", cta: "Book Now" }],
  getActiveInstructionsText: async () => "",
  getPerformanceContext: async () => "",
}));
vi.mock("@/lib/meta/connection-access", () => ({
  ConnectionAccessError: class ConnectionAccessError extends Error { code = "UNAVAILABLE"; },
  requireOwnedBusiness: async () => ({ businessId: business.id, userId: "user-1" }),
  withMetaConnection: mocks.meta,
}));

const goal = "Get more people to book a new-patient exam on our website";
// The owner's pick for the question Groq really asked on turn one.
const answers = [{ questionId: "budget", topic: "budget", question: "What daily budget would you like to start with?", answer: "₹300" }];
type Turn = { messages: unknown; text: string };
const [questionsTurn, planTurn] = recorded.turns as Turn[];
let body: Record<string, unknown>;
async function plan() {
  const { POST } = await import("@/app/api/campaigns/plan/route");
  const response = await POST(new Request("http://localhost/api/campaigns/plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
  return { status: response.status, body: await response.json() };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prompts.length = 0;
  mocks.metaReads.length = 0;
  // Any Meta read other than the interest lookup (e.g. lead forms) throws, so the plan would fail.
  const meta = new Proxy({}, { get: (_target, name: string) => {
    mocks.metaReads.push(name);
    if (name !== "resolveAudienceInterests") throw new Error(`unexpected Meta read: ${name}`);
    return async (names: string[]) => ({ interests: names.map((interestName, index) => ({ id: `600${index}`, name: interestName })), unresolved: [] });
  } });
  mocks.meta.mockImplementation(async (_actor: unknown, _options: unknown, run: (client: unknown, connection: unknown) => unknown) => run(meta, {}));
  // The planner appends retries to the same array, so keep a copy of each prompt as sent.
  mocks.complete.mockImplementation(async (messages: unknown) => {
    mocks.prompts.push(structuredClone(messages));
    const turn = body.answers ? planTurn : questionsTurn;
    return { text: turn.text, provider: "groq", model: recorded.model, usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } };
  });
});

const capture = (name: string) => process.env.CAPTURE_PLANNER_PROMPT && writeFileSync(`${process.env.CAPTURE_PLANNER_PROMPT}-${name}.json`, JSON.stringify(mocks.prompts[0]));

describe("core: a website plan with Groq's real replies (#2599)", () => {
  it("asks the owner a question on turn one, never for a lead form", async () => {
    body = { goal, destination: "website" };
    const { status, body: result } = await plan();
    capture("questions");
    expect(recorded.promptVersion).toBe(PLANNER_PROMPT_VERSION);
    expect(mocks.prompts[0], "planner prompt changed: re-record tests/core/fixtures/planner/groq-website.json").toEqual(questionsTurn.messages);
    expect(JSON.stringify(mocks.prompts[0])).toContain("For website, set lead_form_id=null");
    expect(status).toBe(200);
    expect(result.ready).toBe(false);
    expect(result.questions.map((question: { topic: string }) => question.topic)).toEqual(["budget"]);
    expect(JSON.stringify(result.questions)).not.toMatch(/lead form|instant form/i);
    expect(mocks.inserted).not.toHaveBeenCalled();
    expect(mocks.metaReads).toEqual([]);
  });

  it("saves a ready website draft from the answers, with no lead form and only the interest lookup on Meta", async () => {
    body = { goal, destination: "website", answers };
    const { status, body: result } = await plan();
    capture("plan");
    expect(mocks.prompts[0], "planner prompt changed: re-record tests/core/fixtures/planner/groq-website.json").toEqual(planTurn.messages);
    expect(status).toBe(200);
    expect(result.ready).toBe(true);
    expect(result.draft.input).toMatchObject({ destination: "website", leadFormId: null, creativeIds: [creativeId], dailyBudgetRupees: 300 });
    expect(result.draft.input).not.toHaveProperty("websiteGoal");
    expect(mocks.prompts).toHaveLength(1);
    expect(mocks.inserted).toHaveBeenCalledOnce();
    expect(mocks.metaReads).toEqual(["resolveAudienceInterests"]);
  });

  it.each(["leads", "sales"] as const)("saves the chosen %s goal and keeps Review closed", async (websiteGoal) => {
    body = { goal, destination: "website", websiteGoal, answers };
    const { status, body: result } = await plan();
    expect(status).toBe(200);
    expect(mocks.prompts[0]).toEqual(planTurn.messages);
    const draft = draftDtoSchema.parse(result.draft);
    expect(draft.input).toMatchObject({ destination: "website", websiteGoal, leadFormId: null, dailyBudgetRupees: 300 });
    expect(mocks.inserted).toHaveBeenCalledWith(expect.objectContaining({
      input: expect.objectContaining({ destination: "website", websiteGoal, dailyBudgetRupees: 300 }),
    }));

    const read = vi.fn(async () => { throw new Error("Review read a provider before the conversion gate"); });
    const loaders: PreflightLoaders = {
      findDraft: async () => ({
        id: draft.draftId, businessId: business.id, ownerId: "user-1", version: draft.version,
        input: draft.input, expiresAt: draft.expiresAt, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      }),
      findCreatives: read,
      findForm: read,
      getConnection: read,
      resolveGeo: read,
      hash: () => { throw new Error("Review hashed a closed conversion goal"); },
    };
    expect(await prepareCampaignReview(loaders, {
      actor: { businessId: business.id, userId: "user-1" }, draftId: draft.draftId,
      requestedDraftVersion: draft.version, now: new Date().toISOString(), websiteOpen: () => true,
    })).toEqual({ kind: "website_closed" });
    expect(read).not.toHaveBeenCalled();
  });

  it("preserves an explicitly chosen visits goal", async () => {
    body = { goal, destination: "website", websiteGoal: "visits", answers };
    const { status, body: result } = await plan();
    expect(status).toBe(200);
    expect(result.draft.input).toMatchObject({ destination: "website", websiteGoal: "visits", dailyBudgetRupees: 300 });
  });

  it.each([
    { destination: "website", websiteGoal: "unknown" },
    { destination: "website", websiteGoal: null },
    { destination: "whatsapp", websiteGoal: "sales" },
    { destination: "instant_form", websiteGoal: "leads" },
    { websiteGoal: "sales" },
  ])("rejects a website goal that does not match the destination: %o", async (selection) => {
    body = { goal, ...selection, answers };
    expect((await plan()).status).toBe(400);
    expect(mocks.complete).not.toHaveBeenCalled();
    expect(mocks.meta).not.toHaveBeenCalled();
    expect(mocks.inserted).not.toHaveBeenCalled();
  });

  it("rejects a goal that conflicts with the audience draft", async () => {
    const audienceDraft = {
      businessId: business.id, name: "Website leads", goal, mode: "manual", creativeIds: [creativeId],
      dailyBudgetRupees: 300, leadFormId: null, destination: "website", websiteGoal: "leads", targeting: {}, abTest: false,
    };
    body = { goal, audienceDraft, websiteGoal: "sales" };
    expect((await plan()).status).toBe(400);
    expect(mocks.complete).not.toHaveBeenCalled();
    expect(mocks.meta).not.toHaveBeenCalled();
    expect(mocks.inserted).not.toHaveBeenCalled();
  });

  it.each([
    { destination: "whatsapp", requestedGoal: "leads" },
    { destination: "instant_form", requestedGoal: undefined },
  ])("rejects a non-website destination that conflicts with a website audience goal: %o", async ({ destination, requestedGoal }) => {
    const audienceDraft = {
      businessId: business.id, name: "Website leads", goal, mode: "manual", creativeIds: [creativeId],
      dailyBudgetRupees: 300, leadFormId: null, destination: "website", websiteGoal: "leads", targeting: {}, abTest: false,
    };
    body = { goal, audienceDraft, destination, ...(requestedGoal ? { websiteGoal: requestedGoal } : {}), answers };
    expect((await plan()).status).toBe(400);
    expect(mocks.complete).not.toHaveBeenCalled();
    expect(mocks.meta).not.toHaveBeenCalled();
    expect(mocks.inserted).not.toHaveBeenCalled();
  });

  it.each([
    { savedGoal: "leads", requestedGoal: "leads" },
    { savedGoal: undefined, requestedGoal: "visits" },
  ])("accepts an audience draft with an equivalent goal: %o", async ({ savedGoal, requestedGoal }) => {
    const audienceDraft = {
      businessId: business.id, name: "Website draft", goal, mode: "manual", creativeIds: [creativeId],
      dailyBudgetRupees: 300, leadFormId: null, destination: "website",
      ...(savedGoal ? { websiteGoal: savedGoal } : {}), targeting: {}, abTest: false,
    };
    body = { goal, audienceDraft, websiteGoal: requestedGoal, answers };
    const { status, body: result } = await plan();
    expect(status).toBe(200);
    expect(result).toMatchObject({ ready: true, targeting: expect.any(Object) });
    expect(mocks.inserted).not.toHaveBeenCalled();
  });
});
