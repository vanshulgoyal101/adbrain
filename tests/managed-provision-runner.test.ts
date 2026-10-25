import { describe, expect, it, vi } from "vitest";
import { runManagedProvisioning, type RunnerDeps } from "@/lib/meta/managed-provision-runner";

// #521 wiring (CTO decision 4): one run per business, serialized by the ledger lease before any Meta call.
const business = "11111111-1111-4111-8111-111111111111";

function deps(overrides: Partial<RunnerDeps> = {}) {
  const calls: string[] = [];
  const base: RunnerDeps = {
    config: { parentToken: "parent-token", parentBusinessId: "9000000000001", appId: "2286157145462990" },
    claim: vi.fn(async () => true),
    release: vi.fn(async () => true),
    businessName: async () => "Solaride Mohali",
    customerToken: async () => "customer-token",
    store: { get: async () => null, update: async () => {}, event: async () => {} },
    manager: { appId: "", save: async () => "t", load: async () => null },
    graph: { get: async (path) => { calls.push(`GET ${path}`); throw new Error("no"); }, post: async (path) => { calls.push(`POST ${path}`); throw new Error("no"); } },
    provision: vi.fn(async () => ({ ok: true as const, state: "ad_account_created", childBusinessId: "7", adAccountId: "act_8" })),
  };
  return { deps: { ...base, ...overrides }, calls };
}

describe("runManagedProvisioning (#521)", () => {
  it("runs provisioning inside the business's lease and releases it", async () => {
    const { deps: d } = deps();
    expect(await runManagedProvisioning({ businessId: business, customerTokenId: "tok" }, d)).toMatchObject({ ok: true });
    expect(d.claim).toHaveBeenCalledOnce();
    expect(d.provision).toHaveBeenCalledWith(expect.objectContaining({ businessId: business, businessName: "Solaride Mohali", parentBusinessId: "9000000000001",
      tokens: { customer: "customer-token", parent: "parent-token" } }));
    const lease = vi.mocked(d.claim).mock.calls[0][0];
    expect(d.release).toHaveBeenCalledWith(lease);
  });

  it("does nothing while another run holds the lease", async () => {
    const { deps: d } = deps({ claim: vi.fn(async () => false) });
    expect(await runManagedProvisioning({ businessId: business, customerTokenId: "tok" }, d)).toEqual({ ok: false, code: "PROVISIONING_IN_PROGRESS", retryable: true });
    expect(d.provision).not.toHaveBeenCalled();
    expect(d.release).not.toHaveBeenCalled();
  });

  it("releases the lease when provisioning throws", async () => {
    const { deps: d } = deps({ provision: vi.fn(async () => { throw new Error("store down"); }) });
    await expect(runManagedProvisioning({ businessId: business, customerTokenId: "tok" }, d)).rejects.toThrow("store down");
    expect(d.release).toHaveBeenCalledOnce();
  });

  it("stops before any Meta call without the parent token, or when the customer must reconnect", async () => {
    const noParent = deps({ config: { parentToken: "", parentBusinessId: "9000000000001", appId: "1" } }).deps;
    expect(await runManagedProvisioning({ businessId: business, customerTokenId: "tok" }, noParent)).toEqual({ ok: false, code: "NOT_CONFIGURED", retryable: false });
    expect(noParent.claim).not.toHaveBeenCalled();

    const reauth = deps({ customerToken: async () => null }).deps;
    expect(await runManagedProvisioning({ businessId: business, customerTokenId: "tok" }, reauth)).toEqual({ ok: false, code: "CUSTOMER_REAUTH_REQUIRED", retryable: false });
    expect(reauth.provision).not.toHaveBeenCalled();
    expect(reauth.release).toHaveBeenCalledOnce();

    const noToken = deps().deps;
    expect(await runManagedProvisioning({ businessId: business, customerTokenId: null }, noToken)).toEqual({ ok: false, code: "CUSTOMER_REAUTH_REQUIRED", retryable: false });
  });
});
