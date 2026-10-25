import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// #521: start provisioning for the caller's own managed business. Off unless MANAGED_ACCOUNTS_ENABLED.
const state = vi.hoisted(() => ({
  owned: { ok: true, attempt: { businessId: "b1", userId: "u1", snapshot: {}, tokenId: "tok-1" } } as unknown,
  result: { ok: true, state: "ad_account_created", childBusinessId: "7", adAccountId: "act_8" } as unknown,
  runs: [] as unknown[],
}));
vi.mock("@/lib/meta/managed-attempt", async () => ({
  ownedManagedAttempt: async () => state.owned,
  managedFail: (status: number, code: string, message: string) => Response.json({ ok: false, error: { code, message } }, { status }),
}));
vi.mock("@/lib/meta/managed-provision-runner", () => ({
  runnerDeps: (businessId: string, userId: string) => ({ businessId, userId }),
  runManagedProvisioning: async (input: unknown, deps: unknown) => { state.runs.push({ input, deps }); return state.result; },
}));

const attemptId = "11111111-1111-4111-8111-111111111111";
const post = (body: unknown) => new NextRequest("http://localhost/api/meta/managed/provision", { method: "POST", body: JSON.stringify(body) });

beforeEach(() => {
  state.owned = { ok: true, attempt: { businessId: "b1", userId: "u1", snapshot: {}, tokenId: "tok-1" } };
  state.result = { ok: true, state: "ad_account_created", childBusinessId: "7", adAccountId: "act_8" };
  state.runs = [];
});

describe("POST /api/meta/managed/provision (#521)", () => {
  it("provisions the caller's own business with that attempt's token", async () => {
    const { POST } = await import("@/app/api/meta/managed/provision/route");
    const response = await POST(post({ attemptId }));
    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual({ state: "ad_account_created", adAccountId: "act_8" });
    expect(state.runs).toEqual([{ input: expect.objectContaining({ businessId: "b1", customerTokenId: "tok-1" }), deps: { businessId: "b1", userId: "u1" } }]);
  });

  it("refuses without a valid attempt the caller owns, and never runs", async () => {
    const { POST } = await import("@/app/api/meta/managed/provision/route");
    expect((await POST(post({ attemptId: "nope" }))).status).toBe(400);
    state.owned = { ok: false, response: Response.json({ ok: false }, { status: 404 }) };
    expect((await POST(post({ attemptId }))).status).toBe(404);
    expect(state.runs).toEqual([]);
  });

  it.each([
    ["PROVISIONING_IN_PROGRESS", true, 409, /already setting up/i],
    ["CUSTOMER_REAUTH_REQUIRED", false, 409, /Connect Facebook again/i],
    ["PAGE_ADMIN_REQUIRED", false, 409, /admin of your Facebook Page/i],
    ["META_BUSY", true, 503, /Facebook is busy/i],
    ["NOT_CONFIGURED", false, 503, /aren't available yet/i],
  ])("explains %s to the owner", async (code, retryable, status, message) => {
    state.result = { ok: false, code, retryable };
    const { POST } = await import("@/app/api/meta/managed/provision/route");
    const response = await POST(post({ attemptId }));
    expect(response.status).toBe(status);
    const body = await response.json();
    expect(body.error.code).toBe(code);
    expect(body.error.message).toMatch(message);
  });
});
