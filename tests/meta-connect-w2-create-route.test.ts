import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runPreflight } from "@/lib/campaign/preflight";
import type { DraftInput } from "@/lib/campaign/connect-contracts";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  requireOwnedBusiness: vi.fn(),
  getConnectionStatus: vi.fn(),
  withMetaConnection: vi.fn(),
  rpc: vi.fn(),
  metaClientForBusiness: vi.fn(),
  draftRow: null as Record<string, unknown> | null,
  existingOperation: null as Record<string, unknown> | null,
}));

const businessId = "b123b123-b123-4123-8123-b123b123b123";
const userId = "a123a123-a123-4123-8123-a123a123a123";
const draftId = "d123d123-d123-4123-8123-d123d123d123";
const creativeId = "c123c123-c123-4123-8123-c123c123c123";
const operationId = "f123f123-f123-4123-8123-f123f123f123";
const connectionGeneration = 4;
const idempotencyKey = "idem-1234";

const draftInput: DraftInput = {
  businessId,
  name: "Local leads",
  goal: "Generate qualified leads",
  mode: "manual",
  creativeIds: [creativeId],
  dailyBudgetRupees: 500,
  leadFormId: "form-1",
  targeting: {
    location: {
      mode: "manual",
      included: [{ key: "jaipur", name: "Jaipur", type: "city" }],
      excluded: [],
    },
    age: { mode: "manual", min: 25, max: 55 },
  },
  abTest: false,
};

function draftRow(overrides: Record<string, unknown> = {}) {
  return {
    id: draftId,
    business_id: businessId,
    owner_id: userId,
    version: 1,
    input: draftInput,
    expires_at: "2099-09-14T10:00:00.000Z",
    created_at: "2026-09-07T10:00:00.000Z",
    updated_at: "2026-09-07T10:00:00.000Z",
    ...overrides,
  };
}

function operationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: operationId,
    business_id: businessId,
    draft_id: draftId,
    campaign_id: null,
    draft_version: 1,
    connection_generation: connectionGeneration,
    kind: "campaign_create",
    idempotency_key: idempotencyKey,
    request_hash: requestHash(),
    state: "running",
    phase: "campaign",
    lease_until: "2099-09-07T10:01:00.000Z",
    attempt_count: 1,
    payload: {},
    result: null,
    external_ids: [],
    sanitized_error: null,
    created_at: "2026-09-07T10:00:00.000Z",
    updated_at: "2026-09-07T10:00:00.000Z",
    ...overrides,
  };
}

function requestHash(): string {
  const planHash = reviewPlanHash();
  return createHash("sha256").update(JSON.stringify({
    businessId,
    draftId,
    draftVersion: 1,
    planHash,
    connectionGeneration,
    idempotencyKey,
  })).digest("hex");
}

function reviewPlanHash(): string {
  let payload = "";
  runPreflight({
    draft: draftInput,
    draftId,
    draftVersion: 1,
    connection: {
      generation: connectionGeneration,
      selected: {
        metaBusinessId: null,
        adAccountId: "act_1",
        accountName: "Account",
        pageId: "page_1",
        pageName: "Page",
        currency: "INR",
        timezoneName: "Asia/Kolkata",
      },
      canCreatePaused: true,
    },
    creatives: [{ id: creativeId, businessId, approved: true, imageUrl: "https://example.com/ad.png", headline: "Headline" }],
    form: { id: "form-1", businessId, active: true },
    geo: { resolvedAreaLabel: "Jaipur", unresolvedNames: [], explicitlyNationwide: false },
    hash: (value) => { payload = value; return "0".repeat(64); },
  });
  return createHash("sha256").update(payload).digest("hex");
}

function post(body: unknown): Request {
  return new Request("http://localhost/api/campaigns/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function operationSuccessRow() {
  return operationRow({
    state: "succeeded",
    phase: "complete",
    campaign_id: "11111111-1111-4111-8111-111111111111",
    lease_until: null,
    external_ids: ["meta-campaign-1", "meta-adset-1", "meta-ad-1"],
  });
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: mocks.getUser },
    from: (table: string) => {
      if (table === "campaign_drafts") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({ maybeSingle: async () => ({ data: mocks.draftRow ?? draftRow(), error: null }) }),
              }),
            }),
          }),
        };
      }
      if (table === "campaign_operations") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                  eq: () => ({ maybeSingle: async () => ({ data: mocks.existingOperation, error: null }) }),
              }),
            }),
          }),
          update: () => ({
            eq: () => ({
              eq: () => ({
                select: () => ({ maybeSingle: async () => ({ data: operationRow({ state: "needs_reconciliation", phase: "reconcile", lease_until: null, sanitized_error: "unknown outcome" }), error: null }) }),
              }),
            }),
          }),
        };
      }
      if (table === "creatives") {
        const creativeData = { data: [{ id: creativeId, business_id: businessId, status: "approved", image_url: "https://example.com/ad.png", headline: "Headline", primary_text: "Message", cta: "Learn More" }], error: null };
        type CreativeResult = { data: typeof creativeData.data; error: null };
        type CreativeQuery = Promise<CreativeResult> & { eq: () => CreativeQuery };
        const creativeResult = (): CreativeQuery => ({
          eq: () => creativeResult(),
          then: (onfulfilled, onrejected) => Promise.resolve(creativeData).then(onfulfilled, onrejected),
        } as CreativeQuery);
        return {
          select: () => ({
            in: () => creativeResult(),
          }),
        };
      }
      if (table === "businesses") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { website: "https://example.com", locations: ["Jaipur"] }, error: null }) }) }),
        };
      }
      if (table === "campaigns") {
        return {
          insert: () => ({ select: () => ({ single: async () => ({ data: { id: "11111111-1111-4111-8111-111111111111" }, error: null }) }) }),
        };
      }
      return {};
    },
    rpc: mocks.rpc,
  }),
}));

vi.mock("@/lib/supabase/admin", async () => {
  const { createClient } = await import("@/lib/supabase/server");
  const client = await createClient();
  return { createAdminClient: vi.fn(() => client) };
});

vi.mock("@/lib/meta/connection-access", () => ({
  ConnectionAccessError: class ConnectionAccessError extends Error { code = "UNAVAILABLE"; },
  requireOwnedBusiness: mocks.requireOwnedBusiness,
  getConnectionStatus: mocks.getConnectionStatus,
  withMetaConnection: mocks.withMetaConnection,
}));
vi.mock("@/lib/meta/credentials", () => ({ metaClientForBusiness: mocks.metaClientForBusiness }));
vi.mock("@/lib/audit", () => ({ logEvent: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.draftRow = null;
  mocks.existingOperation = null;
  mocks.getUser.mockResolvedValue({ data: { user: { id: userId } } });
  mocks.requireOwnedBusiness.mockResolvedValue({ businessId, userId });
  mocks.getConnectionStatus.mockResolvedValue({
    generation: connectionGeneration,
    selected: { metaBusinessId: null, adAccountId: "act_1", accountName: "Account", pageId: "page_1", pageName: "Page", currency: "INR", timezoneName: "Asia/Kolkata" },
    capabilities: { canCreatePaused: { state: "available", blockers: [] } },
  });
  mocks.withMetaConnection.mockImplementation(async (_context, _options, execute) =>
      execute({
        listLeadForms: vi.fn().mockResolvedValue([{ id: "form-1", name: "Leads", status: "ACTIVE" }]),
        resolveGeoTargeting: vi.fn().mockResolvedValue({ targeting: {}, matched: [{ label: "Jaipur" }], unresolved: [] }),
        createLeadCampaign: vi.fn().mockImplementation(async (params: { onCheckpoint?: (event: { phase: "campaign" | "adset" | "creative" | "ad"; externalId: string }) => Promise<void> }) => {
          await params.onCheckpoint?.({ phase: "campaign", externalId: "meta-campaign-1" });
          await params.onCheckpoint?.({ phase: "adset", externalId: "meta-adset-1" });
          await params.onCheckpoint?.({ phase: "ad", externalId: "meta-ad-1" });
          return { campaignId: "meta-campaign-1", adSetId: "meta-adset-1", adSetIds: ["meta-adset-1"], adIds: ["meta-ad-1"], destination: "instant_form" };
        }),
      }, { generation: connectionGeneration, selected: { metaBusinessId: null, adAccountId: "act_1", accountName: "Account", pageId: "page_1", pageName: "Page", currency: "INR", timezoneName: "Asia/Kolkata" }, capabilities: { canCreatePaused: { state: "available", blockers: [] } } }),
  );
  mocks.rpc.mockImplementation(async (name: string, args: { p_operation_id: string }) => {
    if (name === "claim_campaign_operation") return { data: [operationRow({ id: args.p_operation_id })], error: null };
    if (name === "checkpoint_campaign_operation") return { data: [operationRow()], error: null };
    if (name === "finish_campaign_operation") return { data: [operationSuccessRow()], error: null };
    return { data: [], error: null };
  });
});

describe("durable campaign create route", () => {
  it("claims, checkpoints, saves a bound paused campaign, and finishes", async () => {
    const { POST } = await import("@/app/api/campaigns/create/route");
    const response = await POST(post({ businessId, draftId, draftVersion: 1, planHash: reviewPlanHash(), connectionGeneration, idempotencyKey }));
    const body = await response.json();
    console.log("durable trace", body, mocks.rpc.mock.calls.map(([name]) => name), mocks.withMetaConnection.mock.calls.length);

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data).toMatchObject({ state: "succeeded", campaignId: "11111111-1111-4111-8111-111111111111" });
    expect(mocks.rpc).toHaveBeenCalledWith("claim_campaign_operation", expect.any(Object));
    expect(mocks.rpc).toHaveBeenCalledWith("finish_campaign_operation", expect.any(Object));
    expect(mocks.metaClientForBusiness).not.toHaveBeenCalled();
  });

  it("replays a succeeded idempotency key without another Meta mutation", async () => {
    mocks.existingOperation = operationSuccessRow();
    const { POST } = await import("@/app/api/campaigns/create/route");
    const response = await POST(post({ businessId, draftId, draftVersion: 1, planHash: reviewPlanHash(), connectionGeneration, idempotencyKey }));

    expect(response.status).toBe(200);
    expect(mocks.withMetaConnection).not.toHaveBeenCalled();
  });

  it("rejects a stale draft before operation claim", async () => {
    mocks.draftRow = draftRow({ version: 2 });
    const { POST } = await import("@/app/api/campaigns/create/route");
    const response = await POST(post({ businessId, draftId, draftVersion: 1, planHash: reviewPlanHash(), connectionGeneration, idempotencyKey }));

    expect(response.status).toBe(409);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.withMetaConnection).not.toHaveBeenCalled();
  });

  it("returns reconciliation instead of false success when checkpointing loses the lease", async () => {
    mocks.rpc.mockImplementation(async (name: string, args: { p_operation_id: string }) => {
      if (name === "claim_campaign_operation") return { data: [operationRow({ id: args.p_operation_id })], error: null };
      if (name === "checkpoint_campaign_operation") return { data: [], error: null };
      return { data: [], error: null };
    });
    const { POST } = await import("@/app/api/campaigns/create/route");
    const response = await POST(post({ businessId, draftId, draftVersion: 1, planHash: reviewPlanHash(), connectionGeneration, idempotencyKey }));
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(body.data.state).toBe("needs_reconciliation");
    expect(mocks.withMetaConnection).toHaveBeenCalled();
  });
});
