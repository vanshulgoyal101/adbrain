import { describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { graphClient, runManagedProvisioning, type RunnerDeps } from "@/lib/meta/managed-provision-runner";

// #521 wiring (CTO decision 4): one run per business, serialized by the ledger lease before any Meta call.
const business = "11111111-1111-4111-8111-111111111111";

function deps(overrides: Partial<RunnerDeps> = {}) {
  const calls: string[] = [];
  const base: RunnerDeps = {
    config: { parentToken: "parent-token", parentBusinessId: "9000000000001", appId: "2286157145462990", appSecret: "app-secret" },
    claim: vi.fn(async () => true),
    release: vi.fn(async () => true),
    businessName: async () => "Solaride Mohali",
    customerToken: async () => "customer-token",
    store: { get: async () => ({ business_id: business, state: "page_linked", page_id: "111", child_business_id: null, ad_account_id: null, step_keys: {} }), update: async () => {}, event: async () => {} },
    manager: { appId: "", save: async () => "t", load: async () => null, remove: async () => {} },
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
    const noParent = deps({ config: { parentToken: "", parentBusinessId: "9000000000001", appId: "1", appSecret: "s" } }).deps;
    expect(await runManagedProvisioning({ businessId: business, customerTokenId: "tok" }, noParent)).toEqual({ ok: false, code: "NOT_CONFIGURED", retryable: false });
    expect(noParent.claim).not.toHaveBeenCalled();

    const reauth = deps({ customerToken: async () => null }).deps;
    expect(await runManagedProvisioning({ businessId: business, customerTokenId: "tok" }, reauth)).toEqual({ ok: false, code: "CUSTOMER_REAUTH_REQUIRED", retryable: false });
    expect(reauth.provision).not.toHaveBeenCalled();
    expect(reauth.release).toHaveBeenCalledOnce();

    const noToken = deps().deps;
    expect(await runManagedProvisioning({ businessId: business, customerTokenId: null }, noToken)).toEqual({ ok: false, code: "CUSTOMER_REAUTH_REQUIRED", retryable: false });
  });

  it("needs the app secret: Meta rejects the child-token mint without appsecret_proof (Reviewer, #577)", async () => {
    const d = deps({ config: { parentToken: "parent-token", parentBusinessId: "9000000000001", appId: "1", appSecret: "" } }).deps;
    expect(await runManagedProvisioning({ businessId: business, customerTokenId: "tok" }, d)).toEqual({ ok: false, code: "NOT_CONFIGURED", retryable: false });
    expect(d.claim).not.toHaveBeenCalled();
  });

  it("says the Page isn't linked when there is no ledger row, instead of 'already setting up'", async () => {
    const d = deps({ store: { get: async () => null, update: async () => {}, event: async () => {} }, claim: vi.fn(async () => false) }).deps;
    expect(await runManagedProvisioning({ businessId: business, customerTokenId: "tok" }, d)).toEqual({ ok: false, code: "PAGE_NOT_LINKED", retryable: false });
    expect(d.claim).not.toHaveBeenCalled();
  });
});

describe("graphClient (#521)", () => {
  it("signs every call with appsecret_proof for the token actually used, in the form or the query", async () => {
    const sent: { url: string; body?: string; auth?: string }[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      sent.push({ url: String(url), body: init?.body ? String(init.body) : undefined, auth: (init?.headers as Record<string, string>).Authorization });
      return Response.json({ id: "1" });
    }) as unknown as typeof fetch;
    const graph = graphClient("app-secret", fetchImpl);
    await graph.post("7000000000001/access_token", { id: "7000000000001" }, "parent-token");
    await graph.get("me?fields=id", "child-token");
    const proof = (token: string) => createHmac("sha256", "app-secret").update(token).digest("hex");
    expect(new URLSearchParams(sent[0].body).get("appsecret_proof")).toBe(proof("parent-token"));
    expect(new URL(sent[1].url).searchParams.get("appsecret_proof")).toBe(proof("child-token"));
    expect(new URL(sent[1].url).searchParams.get("fields")).toBe("id");
    expect(sent.map((s) => s.auth)).toEqual(["Bearer parent-token", "Bearer child-token"]);
    expect(sent.map((s) => s.url + (s.body ?? "")).join(" ")).not.toMatch(/parent-token|child-token/);
  });
});
