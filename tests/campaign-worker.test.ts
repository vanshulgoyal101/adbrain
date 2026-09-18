import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCampaignRequestSchema } from "@/lib/campaign/connect-contracts";
import { runCampaignJob, runNextCampaignJob } from "@/lib/campaign/worker";
import type { Database } from "@/lib/types";

const mocks = vi.hoisted(() => ({ actor: vi.fn(), review: vi.fn(), execute: vi.fn(), checkpoint: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/meta/connection-access", () => ({ requireCampaignWorkerActor: mocks.actor }));
vi.mock("@/lib/campaign/preflight-runtime", () => ({ buildCampaignPreflightLoaders: () => ({}) }));
vi.mock("@/lib/campaign/preflight-service", () => ({ prepareCampaignReview: mocks.review }));
vi.mock("@/lib/campaign/create-service", () => ({ executeReviewedCampaign: mocks.execute }));
vi.mock("@/lib/campaign/operation-store", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/campaign/operation-store")>(),
  createOperationCheckpoint: () => ({ checkpoint: mocks.checkpoint }),
}));

const request = createCampaignRequestSchema.parse({
  businessId: "11111111-1111-4111-8111-111111111111", draftId: "22222222-2222-4222-8222-222222222222",
  draftVersion: 1, planHash: "a".repeat(64), connectionGeneration: 1, idempotencyKey: "worker-request-1234",
});
const row: Database["public"]["Tables"]["campaign_operations"]["Row"] = {
  id: "33333333-3333-4333-8333-333333333333", business_id: request.businessId, draft_id: request.draftId,
  campaign_id: null, draft_version: 1, connection_generation: 1, kind: "campaign_create",
  idempotency_key: request.idempotencyKey, request_hash: createHash("sha256").update(JSON.stringify(request)).digest("hex"),
  state: "running", phase: "campaign", lease_until: "2099-01-01T00:00:00Z", attempt_count: 1,
  payload: { execution: "worker", request }, result: null, external_ids: [], sanitized_error: null,
  created_at: "2026-09-19T00:00:00Z", updated_at: "2026-09-19T00:00:00Z",
};
const draft = {
  id: request.draftId, business_id: request.businessId, owner_id: "owner", version: 1,
  input: { businessId: request.businessId, name: "Campaign", goal: "Leads", mode: "manual", creativeIds: [], dailyBudgetRupees: 200, leadFormId: null, targeting: {}, abTest: false },
  expires_at: "2099-01-01T00:00:00Z", created_at: row.created_at, updated_at: row.updated_at,
};
const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: draft, error: null }) };
const database = { from: () => query, rpc: mocks.rpc } as unknown as Parameters<typeof runCampaignJob>[0];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.actor.mockResolvedValue({ businessId: request.businessId, userId: "owner" });
  mocks.review.mockResolvedValue({ kind: "review", review: { canCreatePaused: true, selected: {}, resolvedLocation: {}, planHash: request.planHash, connectionGeneration: 1 } });
  mocks.checkpoint.mockImplementation(async operation => operation);
  mocks.execute.mockResolvedValue({ kind: "succeeded", operation: { state: "succeeded" } });
  mocks.rpc.mockResolvedValue({ data: [], error: null });
});

describe("durable campaign worker", () => {
  it("revalidates ownership and review before invoking the shared service", async () => {
    expect((await runCampaignJob(database, row, new AbortController().signal)).kind).toBe("succeeded");
    expect(mocks.actor).toHaveBeenCalledWith(row.id);
    expect(mocks.review).toHaveBeenCalledOnce();
    expect(mocks.execute).toHaveBeenCalledWith(expect.objectContaining({ draft: expect.objectContaining({ id: request.draftId }), operation: expect.objectContaining({ operationId: row.id }) }));
  });
  it.each(["ownership", "review", "payload", "abort"])("never mutates Meta when %s validation fails", async failure => {
    const signal = new AbortController();
    if (failure === "ownership") mocks.actor.mockRejectedValue(new Error("owner changed"));
    if (failure === "review") mocks.review.mockResolvedValue({ kind: "stale" });
    if (failure === "abort") signal.abort();
    const job = failure === "payload" ? { ...row, request_hash: "incorrect" } : row;
    expect((await runCampaignJob(database, job, signal.signal)).kind).toBe("failed");
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.checkpoint).toHaveBeenCalledWith(expect.objectContaining({ state: "failed" }));
  });
  it("leaves an unexpected post-transmission failure for reconciliation instead of overwriting IDs", async () => {
    mocks.execute.mockRejectedValue(new Error("transport disappeared"));
    await expect(runCampaignJob(database, row, new AbortController().signal)).rejects.toThrow("transport disappeared");
    expect(mocks.checkpoint).not.toHaveBeenCalled();
  });
  it("treats an empty queue as idle and a queue outage as an error", async () => {
    expect(await runNextCampaignJob(database, new AbortController().signal)).toBe(false);
    mocks.rpc.mockResolvedValue({ data: null, error: {} });
    await expect(runNextCampaignJob(database, new AbortController().signal)).rejects.toThrow("unavailable");
  });
});