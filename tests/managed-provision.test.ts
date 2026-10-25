import { describe, expect, it } from "vitest";
import { provisionManagedAccount, type ProvisionGraph, type ProvisionStore } from "@/lib/meta/managed-provision";
import recordedLookup from "./core/fixtures/meta/parent-owned-businesses.json";

// #521 (2-Tier). The child lookup uses Meta's recorded answer for Solaride (no children yet);
// the creates are PROVISIONAL (Meta's documented shapes) until App Review (#156) and Access
// Verification (#517) pass and they can be recorded.
const PARENT = "9000000000001";
const business = "11111111-1111-4111-8111-111111111111";

function ledger(row: Record<string, unknown>) {
  let current: Record<string, unknown> = { child_business_id: null, ad_account_id: null, step_keys: {}, last_error: null, ...row };
  const events: Record<string, unknown>[] = [];
  const store: ProvisionStore = {
    get: async () => current as never,
    update: async (values) => {
      if (current.child_business_id && values.child_business_id && values.child_business_id !== current.child_business_id) throw new Error("23514 fixed");
      current = { ...current, ...values };
    },
    event: async (event) => { events.push(event); },
  };
  return { store, events, row: () => current };
}

function meta(options: { children?: { id: string; child_business_external_id?: string }[]; accounts?: { id: string; name: string }[]; failChildWith?: object; loseChildResponse?: boolean } = {}) {
  const children = [...(options.children ?? [])];
  const accounts = [...(options.accounts ?? [])];
  const calls: { method: string; path: string; form?: Record<string, string>; token: string }[] = [];
  const graph: ProvisionGraph = {
    get: async (path, token) => {
      calls.push({ method: "GET", path, token });
      if (path.startsWith(`${PARENT}/owned_businesses`)) return (children.length ? { data: children } : recordedLookup.body) as never;
      if (path.includes("/owned_ad_accounts")) return { data: accounts } as never;
      throw new Error(`unexpected GET ${path}`);
    },
    post: async (path, form, token) => {
      calls.push({ method: "POST", path, form, token });
      if (path === `${PARENT}/owned_businesses`) {
        if (options.failChildWith) throw options.failChildWith;
        children.push({ id: "7000000000001", child_business_external_id: form.child_business_external_id });
        if (options.loseChildResponse) throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
        return { id: "7000000000001" } as never;
      }
      if (path === "7000000000001/adaccount") {
        accounts.push({ id: "act_8000000000001", name: form.name });
        return { id: "act_8000000000001", account_id: "8000000000001" } as never;
      }
      throw new Error(`unexpected POST ${path}`);
    },
  };
  return { graph, calls };
}

const tokens = { customer: "customer-token", parent: "parent-token" };
const run = (store: ProvisionStore, graph: ProvisionGraph) =>
  provisionManagedAccount({ businessId: business, businessName: "Solaride Mohali", parentBusinessId: PARENT, store, graph, tokens, requestId: "r1" });

describe("provisionManagedAccount (#521)", () => {
  it("creates the child business with the customer's Page, then its INR ad account, recording each step", async () => {
    const db = ledger({ business_id: business, state: "page_linked", page_id: "111" });
    const { graph, calls } = meta();
    expect(await run(db.store, graph)).toEqual({ ok: true, state: "ad_account_created", childBusinessId: "7000000000001", adAccountId: "act_8000000000001" });
    const child = calls.find((c) => c.method === "POST" && c.path.endsWith("/owned_businesses"))!;
    expect(child.token).toBe("customer-token");
    expect(child.form).toMatchObject({ name: "Solaride Mohali", shared_page_id: "111", child_business_external_id: business, timezone_id: "71" });
    expect(JSON.parse(child.form!.page_permitted_tasks)).toEqual(["ADVERTISE", "ANALYZE", "MESSAGING"]);
    const account = calls.find((c) => c.path === "7000000000001/adaccount")!;
    expect(account.token).toBe("parent-token");
    expect(account.form).toMatchObject({ currency: "INR", timezone_id: "71", end_advertiser: "111", media_agency: "NONE", partner: "NONE" });
    expect(db.row()).toMatchObject({ state: "ad_account_created", child_business_id: "7000000000001", ad_account_id: "act_8000000000001" });
    expect(db.events.map((e) => [e.step, e.outcome, e.meta_object_id])).toEqual([
      ["child_business", "started", undefined], ["child_business", "succeeded", "7000000000001"],
      ["ad_account", "started", undefined], ["ad_account", "succeeded", "act_8000000000001"],
    ]);
  });

  it("never creates twice: a lost response is found by its external id on the next run", async () => {
    const db = ledger({ business_id: business, state: "page_linked", page_id: "111" });
    const lost = meta({ loseChildResponse: true });
    expect(await run(db.store, lost.graph)).toMatchObject({ ok: false, code: "META_TIMEOUT", retryable: true });
    expect(db.row()).toMatchObject({ state: "failed", last_error: "META_TIMEOUT", child_business_id: null });

    const again = meta({ children: [{ id: "7000000000001", child_business_external_id: business }] });
    expect(await run(db.store, again.graph)).toMatchObject({ ok: true, state: "ad_account_created", childBusinessId: "7000000000001" });
    expect(again.calls.filter((c) => c.method === "POST" && c.path.endsWith("/owned_businesses"))).toEqual([]);
  });

  it("finds an ad account already made for this business instead of making another", async () => {
    const db = ledger({ business_id: business, state: "child_created", page_id: "111", child_business_id: "7000000000001" });
    const { graph, calls } = meta({ accounts: [{ id: "act_8000000000001", name: `AdBrain ${business.slice(0, 8)} Solaride Mohali` }] });
    expect(await run(db.store, graph)).toMatchObject({ ok: true, adAccountId: "act_8000000000001" });
    expect(calls.filter((c) => c.method === "POST")).toEqual([]);
  });

  it("turns Meta's 'you must be an admin of that Page' into an honest owner code", async () => {
    const db = ledger({ business_id: business, state: "page_linked", page_id: "111" });
    const { graph } = meta({ failChildWith: Object.assign(new Error("Invalid parameter"), { status: 400, code: 100, subcode: 1690138 }) });
    expect(await run(db.store, graph)).toEqual({ ok: false, code: "PAGE_ADMIN_REQUIRED", retryable: false });
    expect(db.row()).toMatchObject({ state: "failed", last_error: "PAGE_ADMIN_REQUIRED" });
    expect(db.events.at(-1)).toMatchObject({ step: "child_business", outcome: "failed", error_code: "PAGE_ADMIN_REQUIRED" });
  });

  it("does nothing until the Page is linked", async () => {
    const db = ledger({ business_id: business, state: "requested", page_id: null });
    const { graph, calls } = meta();
    expect(await run(db.store, graph)).toEqual({ ok: false, code: "PAGE_NOT_LINKED", retryable: false });
    expect(calls).toEqual([]);
  });
});
