import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => mocks }));

import { getConnectionAttempt } from "@/lib/meta/connection-repository";

const row = {
  id: "22222222-2222-4222-8222-222222222222",
  business_id: "11111111-1111-4111-8111-111111111111",
  intent: { kind: "setup" },
  expires_at: "2099-01-01T00:00:00.000Z",
  revision: 3,
  status: "action_required",
  discovery_complete: true,
  error_code: "SETUP_REQUIRED",
  discovered_assets: { kind: "asset_snapshot", complete: true, adAccounts: [], pages: [], candidates: [] },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rpc.mockResolvedValue({ data: [row], error: null });
  mocks.from.mockReturnValue({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) });
});

describe("saved attempt recovery response", () => {
  it("returns actionable blockers from the owned saved snapshot", async () => {
    const result = await getConnectionAttempt(row.id, "owner-id");
    expect(mocks.rpc).toHaveBeenCalledWith("meta_attempt_get", { p_attempt_id: row.id, p_user_id: "owner-id" });
    expect(result?.blockers).toHaveLength(2);
    expect(result?.blockers[0].message).toContain("No accessible ad account");
    expect(result?.blockers[1].message).toContain("No accessible Facebook Page");
    expect(result?.blockers[0].action).toMatchObject({ kind: "open_meta" });
  });

  it("returns no attempt when ownership lookup fails", async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    expect(await getConnectionAttempt(row.id, "other-owner")).toBeNull();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("rejects unknown stored states before querying connection details", async () => {
    mocks.rpc.mockResolvedValue({ data: [{ ...row, status: "unexpected" }], error: null });
    expect(await getConnectionAttempt(row.id, "owner-id")).toBeNull();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("replaces stale setup advice with reconnect guidance after expiry", async () => {
    mocks.rpc.mockResolvedValue({ data: [{ ...row, expires_at: "2000-01-01T00:00:00.000Z" }], error: null });
    expect(await getConnectionAttempt(row.id, "owner-id")).toMatchObject({ state: "expired", blockers: [{ code: "REAUTH_REQUIRED", action: { kind: "reconnect" } }] });
  });
});