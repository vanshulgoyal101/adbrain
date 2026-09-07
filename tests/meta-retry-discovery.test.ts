import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), discover: vi.fn(), result: vi.fn(), failed: vi.fn(), get: vi.fn(), decrypt: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/meta/connection-repository", () => ({ getConnectionAttempt: mocks.get, markAttemptDiscoveryResult: mocks.result, markAttemptFailed: mocks.failed }));
vi.mock("@/lib/meta/oauth", () => ({ discoverMetaAssets: mocks.discover }));
vi.mock("@/lib/meta/token-store", () => ({ fromPostgresBytea: (value: string) => value, decryptMetaToken: mocks.decrypt }));
import { retryConnectionDiscovery } from "@/lib/meta/retry-discovery";
beforeEach(() => {
  vi.resetAllMocks();
  mocks.rpc.mockImplementation(async (name: string) => ({ data: name === "meta_attempt_retry_claim" ? true : name === "meta_attempt_get" ? [{ token_id: "token", business_id: "business", status: "discovering" }] : [{ id: "token", business_id: "business" }], error: null }));
  mocks.decrypt.mockReturnValue("fixture-token");
  mocks.discover.mockResolvedValue({ complete: false, adAccounts: [], pages: [], relationshipPairs: [] });
  mocks.get.mockResolvedValue({ state: "action_required" });
});
it("actually repeats read-only discovery and retains incomplete evidence", async () => {
  await retryConnectionDiscovery("attempt", "owner", 2);
  expect(mocks.discover).toHaveBeenCalledWith("fixture-token");
  expect(mocks.result).toHaveBeenCalledWith("attempt", expect.objectContaining({ complete: false, candidates: [] }), "action_required", "DISCOVERY_INCOMPLETE");
});
it("does not read provider credentials after a lost retry claim", async () => {
  mocks.rpc.mockResolvedValue({ data: false });
  expect(await retryConnectionDiscovery("attempt", "owner", 2)).toBeNull();
  expect(mocks.decrypt).not.toHaveBeenCalled();
});
it("turns provider failures into a retryable result instead of leaving discovering", async () => {
  mocks.discover.mockRejectedValue(new Error("network"));
  await retryConnectionDiscovery("attempt", "owner", 2);
  expect(mocks.failed).toHaveBeenCalledWith("attempt", "DISCOVERY_INCOMPLETE");
});