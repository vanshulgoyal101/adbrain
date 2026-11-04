import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fenceHeaderValue } from "../scripts/lib/smoke-fence.mjs";
import { issueDraftCapability } from "@/lib/security/smoke-fence-server";

vi.mock("@/lib/env", () => ({ getEnv: () => ({ TEST_SESSION_SECRET: "s".repeat(40) }) }));
const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  requireOwnedBusiness: vi.fn(),
  rpc: vi.fn(),
  activeRows: [] as unknown[],
  draftRow: null as Record<string, unknown> | null,
}));

const businessId = "b123b123-b123-4123-8123-b123b123b123";
const userId = "u123u123-u123-4123-8123-u123u123u123";
const draftId = "d123d123-d123-4123-8123-d123d123d123";

const input = {
  businessId,
  name: "Local leads",
  goal: "Generate leads",
  mode: "manual",
  creativeIds: [],
  dailyBudgetRupees: 0,
  leadFormId: null,
  targeting: {},
  abTest: false,
};

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: draftId,
    business_id: businessId,
    owner_id: userId,
    version: 1,
    input,
    expires_at: "2099-09-14T10:00:00.000Z",
    created_at: "2026-09-07T10:00:00.000Z",
    updated_at: "2026-09-07T10:00:00.000Z",
    ...overrides,
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: mocks.getUser },
    from: (table: string) => {
      if (table !== "campaign_drafts") return {};
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              gt: async () => ({ data: mocks.activeRows, error: null }),
              maybeSingle: async () => ({ data: mocks.draftRow, error: null }),
            }),
          }),
        }),
        insert: () => ({
          select: () => ({ single: async () => ({ data: mocks.draftRow, error: null }) }),
        }),
      };
    },
    rpc: mocks.rpc,
  }),
}));
vi.mock("@/lib/meta/connection-access", () => ({
  ConnectionAccessError: class ConnectionAccessError extends Error {
    code = "UNAVAILABLE";
  },
  requireOwnedBusiness: mocks.requireOwnedBusiness,
}));

function request(method: string, body?: unknown): Request {
  return new Request("http://localhost/api/campaign-drafts", {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: { id: userId } } });
  mocks.requireOwnedBusiness.mockResolvedValue({ businessId, userId });
  mocks.activeRows = [];
  mocks.draftRow = row();
  mocks.rpc.mockResolvedValue({ data: [row({ version: 2, input: { ...input, name: "Updated" } })], error: null });
});

describe("campaign draft HTTP routes", () => {
  it("POST returns a versioned owned draft DTO", async () => {
    const { POST } = await import("@/app/api/campaign-drafts/route");
    const response = await POST(request("POST", input));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data).toMatchObject({ draftId, version: 1, input });
    expect(mocks.requireOwnedBusiness).toHaveBeenCalledWith(businessId);
  });

  it("GET hides an expired owned draft", async () => {
    mocks.draftRow = row({ expires_at: "2020-01-01T00:00:00.000Z" });
    const { GET } = await import("@/app/api/campaign-drafts/[id]/route");
    const response = await GET(request("GET"), { params: Promise.resolve({ id: draftId }) });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  });

  it("PUT returns the atomic version conflict without overwriting", async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    const { PUT } = await import("@/app/api/campaign-drafts/[id]/route");
    const response = await PUT(
      request("PUT", { expectedVersion: 1, input: { ...input, name: "Stale tab" } }),
      { params: Promise.resolve({ id: draftId }) },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "update_campaign_draft_if_version",
      expect.objectContaining({ p_draft_id: draftId, p_expected_version: 1 }),
    );
  });

  it.each(["23503", "23001"])("DELETE keeps a draft that a campaign operation references (Postgres %s) with a 409", async code => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code, message: "violates foreign key constraint" } });
    const { DELETE } = await import("@/app/api/campaign-drafts/[id]/route");
    const response = await DELETE(
      new Request(`http://localhost/api/campaign-drafts/${draftId}?version=2`, { method: "DELETE" }),
      { params: Promise.resolve({ id: draftId }) },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ ok: false, error: { code: "CONFLICT", message: expect.stringMatching(/campaign operation/) } });
  });

  describe("draft-only smoke fence (#2861)", () => {
    const createdAt = "2026-09-07T10:00:00.000Z";
    beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-09-07T10:10:00.000Z")); });
    afterEach(() => { vi.useRealTimers(); });
    const fenced = (method: string, drafts?: string, body?: unknown) => new Request(`http://localhost/api/campaign-drafts/${draftId}?version=1`, {
      method,
      headers: { "Content-Type": "application/json", "x-adbrain-smoke-fence": drafts ? fenceHeaderValue(new Map(drafts.split(",").map((id) => [id, issueDraftCapability(new Request("http://localhost", { headers: { "x-adbrain-smoke-fence": "draft-only" } }), userId, id, createdAt)!]))) : "draft-only" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const params = { params: Promise.resolve({ id: draftId }) };

    it("refuses to update or delete a draft this run didn't create, before any write", async () => {
      const { PUT, DELETE } = await import("@/app/api/campaign-drafts/[id]/route");
      for (const response of [
        await PUT(fenced("PUT", undefined, { expectedVersion: 1, input }), params),
        await DELETE(fenced("DELETE", "00000000-0000-4000-8000-000000000000"), params),
        await DELETE(fenced("DELETE", "not-a-uuid"), params),
      ]) {
        expect(response.status).toBe(409);
        await expect(response.json()).resolves.toMatchObject({ ok: false, error: { code: "SMOKE_FENCE", effect: "existing_draft" } });
      }
      expect(mocks.rpc).not.toHaveBeenCalled();
    });

    it("lets the run update and delete the draft it created", async () => {
      const { PUT, DELETE } = await import("@/app/api/campaign-drafts/[id]/route");
      expect((await PUT(fenced("PUT", draftId, { expectedVersion: 1, input: { ...input, name: "Updated" } }), params)).status).toBe(200);
      mocks.rpc.mockResolvedValue({ data: [{ id: draftId }], error: null });
      expect((await DELETE(fenced("DELETE", draftId), params)).status).toBe(200);
      expect(mocks.rpc).toHaveBeenCalledTimes(2);
    });

    it("refuses a signed capability over a draft created before it (prior-run or pre-existing id)", async () => {
      const { DELETE } = await import("@/app/api/campaign-drafts/[id]/route");
      mocks.draftRow = row({ created_at: "2026-09-07T09:00:00.000Z" });
      const response = await DELETE(fenced("DELETE", draftId), params);
      expect(response.status).toBe(409);
      expect(mocks.rpc).not.toHaveBeenCalled();
    });

    it("refuses an existing draft named in an unsigned header (spoof)", async () => {
      const { DELETE } = await import("@/app/api/campaign-drafts/[id]/route");
      const spoof = new Request(`http://localhost/api/campaign-drafts/${draftId}?version=1`, { method: "DELETE", headers: { "x-adbrain-smoke-fence": `draft-only; drafts=${draftId}` } });
      expect((await DELETE(spoof, params)).status).toBe(409);
      expect(mocks.rpc).not.toHaveBeenCalled();
    });

    it("leaves a request without the header unchanged", async () => {
      const { DELETE } = await import("@/app/api/campaign-drafts/[id]/route");
      mocks.rpc.mockResolvedValue({ data: [{ id: draftId }], error: null });
      expect((await DELETE(new Request(`http://localhost/api/campaign-drafts/${draftId}?version=1`, { method: "DELETE" }), params)).status).toBe(200);
    });
  });
});
