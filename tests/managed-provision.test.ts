import { describe, expect, it } from "vitest";
import { beforeEach } from "vitest";
import { MANAGER_SCOPE, metaVertical, provisionManagedAccount, type ManagerTokens, type ProvisionGraph, type ProvisionStore } from "@/lib/meta/managed-provision";
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

function meta(options: { children?: { id: string; child_business_external_id?: string }[]; accounts?: { id: string; name: string }[]; failChildWith?: object; loseChildResponse?: boolean; assigned?: { id: string; tasks?: string[] }[]; failGrantWith?: object; pageAssigned?: { id: string; tasks?: string[] }[]; failPageGrantWith?: object } = {}) {
  const children = [...(options.children ?? [])];
  const accounts = [...(options.accounts ?? [])];
  const assigned = [...(options.assigned ?? [])];
  const pageAssigned = [...(options.pageAssigned ?? [])];
  const calls: { method: string; path: string; form?: Record<string, string>; token: string }[] = [];
  const graph: ProvisionGraph = {
    get: async (path, token) => {
      calls.push({ method: "GET", path, token });
      if (path.startsWith(`${PARENT}/owned_businesses`)) return (children.length ? { data: children } : recordedLookup.body) as never;
      if (path.includes("/owned_ad_accounts")) return { data: accounts } as never;
      if (path.startsWith("act_8000000000001/assigned_users")) return { data: assigned } as never;
      if (path.startsWith("111/assigned_users")) return { data: pageAssigned } as never;
      if (path.startsWith("me?")) return { id: "6100000000009" } as never;
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
      if (path === "7000000000001/access_token") return { access_token: "child-token" } as never;
      if (path === "act_8000000000001/assigned_users") {
        if (options.failGrantWith) throw options.failGrantWith;
        assigned.push({ id: form.user, tasks: JSON.parse(form.tasks) });
        return { success: true } as never;
      }
      if (path === "111/assigned_users") {
        if (options.failPageGrantWith) throw options.failPageGrantWith;
        pageAssigned.push({ id: form.user, tasks: JSON.parse(form.tasks) });
        return { success: true } as never;
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
const vault = new Map<string, string>();
const saved: { token: string; userId: string }[] = [];
const removed: string[] = [];
const manager: ManagerTokens = {
  appId: "2286157145462990",
  save: async (token, userId) => { saved.push({ token, userId }); const id = `00000000-0000-4000-8000-00000000000${saved.length}`; vault.set(id, token); return id; },
  load: async (tokenId) => vault.get(tokenId) ?? null,
  remove: async (tokenId) => { removed.push(tokenId); vault.delete(tokenId); },
};
const run = (store: ProvisionStore, graph: ProvisionGraph) =>
  provisionManagedAccount({ businessId: business, businessName: "Solaride Mohali", vertical: "ENERGY_AND_UTILITIES", parentBusinessId: PARENT, store, graph, tokens, manager, requestId: "r1" });
beforeEach(() => { vault.clear(); saved.length = 0; removed.length = 0; });

describe("provisionManagedAccount (#521)", () => {
  it("creates the child business with the customer's Page, then its INR ad account, recording each step", async () => {
    const db = ledger({ business_id: business, state: "page_linked", page_id: "111" });
    const { graph, calls } = meta();
    expect(await run(db.store, graph)).toEqual({ ok: true, state: "ad_account_created", childBusinessId: "7000000000001", adAccountId: "act_8000000000001" });
    const child = calls.find((c) => c.method === "POST" && c.path.endsWith("/owned_businesses"))!;
    expect(child.token).toBe("customer-token");
    // #2358: Meta requires `vertical` on a new business (its owned_businesses reference omits it).
    expect(child.form).toMatchObject({ name: "Solaride Mohali", vertical: "ENERGY_AND_UTILITIES", shared_page_id: "111", child_business_external_id: business, timezone_id: "71" });
    expect(JSON.parse(child.form!.page_permitted_tasks)).toEqual(["ADVERTISE", "ANALYZE", "MESSAGING"]);
    const account = calls.find((c) => c.path === "7000000000001/adaccount")!;
    expect(account.token).toBe("parent-token");
    expect(account.form).toMatchObject({ currency: "INR", timezone_id: "71", end_advertiser: "111", media_agency: "NONE", partner: "NONE" });
    expect(db.row()).toMatchObject({ state: "ad_account_created", child_business_id: "7000000000001", ad_account_id: "act_8000000000001" });
    expect(db.events.map((e) => [e.step, e.outcome, e.meta_object_id])).toEqual([
      ["child_business", "started", undefined], ["child_business", "succeeded", "7000000000001"],
      ["ad_account", "started", undefined], ["ad_account", "succeeded", "act_8000000000001"],
      ["ad_account", "succeeded", "6100000000009"], ["ad_account", "succeeded", "act_8000000000001"], ["ad_account", "succeeded", "111"],
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
    expect(calls.filter((c) => c.method === "POST" && c.path.endsWith("/adaccount"))).toEqual([]);
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

  // Meta's setup-cbm: "Add the System User as an Admin to the New Ad Account" (assigned_users).
  it("assigns the managing system user to the new ad account, once", async () => {
    const db = ledger({ business_id: business, state: "page_linked", page_id: "111" });
    const { graph, calls } = meta();
    expect(await run(db.store, graph)).toMatchObject({ ok: true });
    const grant = calls.find((c) => c.method === "POST" && c.path === "act_8000000000001/assigned_users")!;
    expect(grant.form).toEqual({ user: "6100000000009", tasks: JSON.stringify(["MANAGE", "ADVERTISE", "ANALYZE"]), business: "7000000000001" });
    expect(grant.token).toBe("child-token");
    expect(calls.find((c) => c.method === "GET" && c.path.startsWith("act_8000000000001/assigned_users"))!.path).toContain("business=7000000000001");
    expect(db.row()).toMatchObject({ step_keys: expect.objectContaining({ grant: `grant:${business}` }) });

    const again = meta({ assigned: [{ id: "6100000000009", tasks: ["MANAGE", "ADVERTISE", "ANALYZE"] }],
      pageAssigned: [{ id: "6100000000009", tasks: ["ADVERTISE", "ANALYZE", "MESSAGING", "MODERATE"] }] });
    vault.set("00000000-0000-4000-8000-000000000009", "child-token");
    const db2 = ledger({ business_id: business, state: "failed", page_id: "111", child_business_id: "7000000000001", ad_account_id: "act_8000000000001",
      manager_user_id: "6100000000009", manager_token_id: "00000000-0000-4000-8000-000000000009", step_keys: { child_business: "x", ad_account: "y", manager: "z", manager_scope: MANAGER_SCOPE } });
    expect(await run(db2.store, again.graph)).toMatchObject({ ok: true, state: "ad_account_created" });
    expect(again.calls.filter((c) => c.method === "POST")).toEqual([]);
  });

  it("a failed grant keeps the ad account and retries only the grant", async () => {
    const db = ledger({ business_id: business, state: "page_linked", page_id: "111" });
    const failing = meta({ failGrantWith: Object.assign(new Error("busy"), { status: 500, code: 2 }) });
    expect(await run(db.store, failing.graph)).toMatchObject({ ok: false, code: "META_BUSY", retryable: true });
    expect(db.row()).toMatchObject({ state: "failed", ad_account_id: "act_8000000000001", last_error: "META_BUSY" });
    expect(db.events.at(-1)).toMatchObject({ step: "ad_account", outcome: "failed", error_code: "META_BUSY" });

    const retry = meta({ accounts: [{ id: "act_8000000000001", name: "x" }] });
    expect(await run(db.store, retry.graph)).toMatchObject({ ok: true, state: "ad_account_created" });
    expect(retry.calls.filter((c) => c.method === "POST").map((c) => c.path)).toEqual(["act_8000000000001/assigned_users", "111/assigned_users"]);
  });

  it("refuses, and creates nothing, when a child unexpectedly has several ad accounts (QA #527 T3)", async () => {
    const db = ledger({ business_id: business, state: "failed", page_id: "111", child_business_id: "7000000000001" });
    const { graph, calls } = meta({ accounts: [{ id: "act_1", name: "a" }, { id: "act_2", name: "b" }] });
    expect(await run(db.store, graph)).toEqual({ ok: false, code: "AD_ACCOUNT_AMBIGUOUS", retryable: false });
    expect(calls.filter((c) => c.method === "POST")).toEqual([]);
    expect(db.row()).toMatchObject({ state: "failed", last_error: "AD_ACCOUNT_AMBIGUOUS", ad_account_id: null });
  });

  // CTO decision 1 (#521): each child's own system user manages its ad account (Meta's setup-cbm).
  it("mints the child's system-user token with the parent token, stores it encrypted, and grants with it", async () => {
    const db = ledger({ business_id: business, state: "page_linked", page_id: "111" });
    const { graph, calls } = meta();
    expect(await run(db.store, graph)).toMatchObject({ ok: true });
    const mint = calls.find((c) => c.path === "7000000000001/access_token")!;
    expect(mint).toMatchObject({ method: "POST", token: "parent-token", form: { id: "7000000000001", app_id: "2286157145462990", scope: MANAGER_SCOPE } });
    expect(MANAGER_SCOPE.split(",")).toEqual(expect.arrayContaining(["ads_management", "pages_read_engagement", "pages_manage_ads", "leads_retrieval"]));
    // Meta's guide reads the system user from /me with the child token (no ambiguity if the customer adds others).
    expect(calls.find((c) => c.path.startsWith("me?"))!.token).toBe("child-token");
    expect(saved).toEqual([{ token: "child-token", userId: "6100000000009" }]);
    expect(db.row()).toMatchObject({ manager_user_id: "6100000000009", manager_token_id: "00000000-0000-4000-8000-000000000001" });
    expect(JSON.stringify(db.row())).not.toContain("child-token");
    expect(JSON.stringify(db.events)).not.toContain("child-token");
  });

  it("reuses the stored manager on resume, and mints again only if its token is gone", async () => {
    const stored = { business_id: business, state: "failed", page_id: "111", child_business_id: "7000000000001", ad_account_id: "act_8000000000001",
      manager_user_id: "6100000000009", manager_token_id: "00000000-0000-4000-8000-000000000009", step_keys: { child_business: "x", ad_account: "y", manager: "z", manager_scope: MANAGER_SCOPE } };
    vault.set("00000000-0000-4000-8000-000000000009", "child-token");
    const reuse = meta();
    expect(await run(ledger(stored).store, reuse.graph)).toMatchObject({ ok: true });
    expect(reuse.calls.filter((c) => c.path.endsWith("/access_token"))).toEqual([]);

    vault.clear();
    const gone = meta();
    const db = ledger(stored);
    expect(await run(db.store, gone.graph)).toMatchObject({ ok: true });
    expect(gone.calls.filter((c) => c.path.endsWith("/access_token"))).toHaveLength(1);
    expect(db.row()).toMatchObject({ manager_token_id: "00000000-0000-4000-8000-000000000001" });
    // The replaced (revoked or expired) token's encrypted row is deleted once the new reference is written.
    expect(removed).toEqual(["00000000-0000-4000-8000-000000000009"]);
  });

  it("deletes a just-saved token when the ledger can't reference it (no orphaned secrets)", async () => {
    const db = ledger({ business_id: business, state: "ad_account_created", page_id: "111", child_business_id: "7000000000001", ad_account_id: "act_8000000000001", step_keys: { child_business: "x", ad_account: "y" } });
    const update = db.store.update;
    db.store.update = async (values) => { if ("manager_token_id" in values) throw new Error("store down"); return update(values); };
    const { graph } = meta();
    expect(await run(db.store, graph)).toMatchObject({ ok: false });
    expect(removed).toEqual(["00000000-0000-4000-8000-000000000001"]);
  });

  // #624: campaigns run on the child token, so its system user needs the Page the customer shared.
  it("assigns the shared Page to the child's system user, once, with only the shared tasks", async () => {
    const db = ledger({ business_id: business, state: "page_linked", page_id: "111" });
    const { graph, calls } = meta();
    expect(await run(db.store, graph)).toMatchObject({ ok: true });
    const grant = calls.find((c) => c.method === "POST" && c.path === "111/assigned_users")!;
    expect(grant).toMatchObject({ token: "child-token", form: { user: "6100000000009", tasks: JSON.stringify(["ADVERTISE", "ANALYZE", "MESSAGING"]), business: "7000000000001" } });
    expect(db.row()).toMatchObject({ step_keys: expect.objectContaining({ page_grant: `page:${business}`, manager_scope: MANAGER_SCOPE }) });
    const again = meta({ accounts: [{ id: "act_8000000000001", name: "x" }] });
    expect(await run(db.store, again.graph)).toMatchObject({ ok: true });
    expect(again.calls.filter((c) => c.method === "POST")).toEqual([]);
  });

  it("a failed Page grant keeps everything before it and retries only the Page grant", async () => {
    const db = ledger({ business_id: business, state: "page_linked", page_id: "111" });
    const failing = meta({ failPageGrantWith: Object.assign(new Error("busy"), { status: 500, code: 2 }) });
    expect(await run(db.store, failing.graph)).toMatchObject({ ok: false, code: "META_BUSY", retryable: true });
    expect(db.row()).toMatchObject({ state: "failed", ad_account_id: "act_8000000000001", step_keys: expect.objectContaining({ grant: `grant:${business}` }) });
    const retry = meta({ accounts: [{ id: "act_8000000000001", name: "x" }] });
    expect(await run(db.store, retry.graph)).toMatchObject({ ok: true });
    expect(retry.calls.filter((c) => c.method === "POST").map((c) => c.path)).toEqual(["111/assigned_users"]);
  });

  it("mints again when the stored token predates the Page scope (#624)", async () => {
    vault.set("00000000-0000-4000-8000-000000000009", "old-child-token");
    const db = ledger({ business_id: business, state: "failed", page_id: "111", child_business_id: "7000000000001", ad_account_id: "act_8000000000001",
      manager_user_id: "6100000000009", manager_token_id: "00000000-0000-4000-8000-000000000009", step_keys: { child_business: "x", ad_account: "y", manager: "z", grant: "g" } });
    const { graph, calls } = meta();
    expect(await run(db.store, graph)).toMatchObject({ ok: true });
    expect(calls.find((c) => c.path.endsWith("/access_token"))!.form).toMatchObject({ scope: MANAGER_SCOPE });
    expect(removed).toEqual(["00000000-0000-4000-8000-000000000009"]);
    expect(JSON.stringify(calls)).not.toContain("old-child-token");
  });

  // Reviewer on #643: the Page grant writes no state, and a set-up account is repaired in place.
  it("the Page grant writes only its step key, and a failed set-up row still resumes to ad_account_created", async () => {
    vault.set("00000000-0000-4000-8000-000000000009", "child-token");
    const db = ledger({ business_id: business, state: "failed", page_id: "111", child_business_id: "7000000000001", ad_account_id: "act_8000000000001",
      manager_user_id: "6100000000009", manager_token_id: "00000000-0000-4000-8000-000000000009",
      step_keys: { child_business: "x", ad_account: "y", manager: "z", manager_scope: MANAGER_SCOPE, grant: "g" } });
    const writes: Record<string, unknown>[] = [];
    const update = db.store.update;
    db.store.update = async (values) => { writes.push(values); return update(values); };
    const { graph } = meta();
    expect(await run(db.store, graph)).toMatchObject({ ok: true, state: "ad_account_created" });
    const pageWrite = writes.find((values) => (values.step_keys as Record<string, string> | undefined)?.page_grant)!;
    expect(pageWrite).not.toHaveProperty("state");
    expect(db.row()).toMatchObject({ state: "ad_account_created", last_error: null });
  });

  it.each(["funded", "whatsapp_linked", "ready"])("repairs a %s account in place: re-mints the old-scope token and grants the Page, keeping its state", async (state) => {
    vault.set("00000000-0000-4000-8000-000000000009", "old-child-token");
    const db = ledger({ business_id: business, state, page_id: "111", child_business_id: "7000000000001", ad_account_id: "act_8000000000001",
      manager_user_id: "6100000000009", manager_token_id: "00000000-0000-4000-8000-000000000009",
      step_keys: { child_business: "x", ad_account: "y", manager: "z", grant: "g" } });
    const { graph, calls } = meta();
    expect(await run(db.store, graph)).toEqual({ ok: true, state, childBusinessId: "7000000000001", adAccountId: "act_8000000000001" });
    expect(calls.filter((c) => c.method === "POST").map((c) => c.path)).toEqual(["7000000000001/access_token", "111/assigned_users"]);
    expect(db.row()).toMatchObject({ state, manager_token_id: "00000000-0000-4000-8000-000000000001",
      step_keys: expect.objectContaining({ manager_scope: MANAGER_SCOPE, page_grant: `page:${business}` }) });
  });

  it("a failed repair keeps a ready account ready and records the error; retrying finishes it", async () => {
    vault.set("00000000-0000-4000-8000-000000000009", "child-token");
    const db = ledger({ business_id: business, state: "ready", page_id: "111", child_business_id: "7000000000001", ad_account_id: "act_8000000000001",
      manager_user_id: "6100000000009", manager_token_id: "00000000-0000-4000-8000-000000000009",
      step_keys: { child_business: "x", ad_account: "y", manager: "z", manager_scope: MANAGER_SCOPE, grant: "g" } });
    const failing = meta({ failPageGrantWith: Object.assign(new Error("busy"), { status: 500, code: 2 }) });
    expect(await run(db.store, failing.graph)).toMatchObject({ ok: false, code: "META_BUSY", retryable: true });
    expect(db.row()).toMatchObject({ state: "ready", last_error: "META_BUSY" });
    const retry = meta();
    expect(await run(db.store, retry.graph)).toMatchObject({ ok: true, state: "ready" });
    expect(db.row()).toMatchObject({ state: "ready", last_error: null });
  });

  it("still refuses an account that is offboarding or has no ad account", async () => {
    for (const row of [{ state: "offboarding", child_business_id: "7000000000001", ad_account_id: "act_8000000000001" }, { state: "ready", child_business_id: null, ad_account_id: null }]) {
      const { graph, calls } = meta();
      expect(await run(ledger({ business_id: business, page_id: "111", ...row }).store, graph)).toEqual({ ok: false, code: "PAGE_NOT_LINKED", retryable: false });
      expect(calls).toEqual([]);
    }
  });
});

describe("metaVertical (#2358)", () => {
  it("maps the Brand's category to Meta's business vertical enum, OTHER when unsure", () => {
    expect(metaVertical("Rooftop solar installer")).toBe("ENERGY_AND_UTILITIES");
    expect(metaVertical("IELTS coaching")).toBe("EDUCATION");
    expect(metaVertical("Study abroad consultant")).toBe("EDUCATION");
    expect(metaVertical("Modular kitchens and interiors")).toBe("PROFESSIONAL_SERVICES");
    expect(metaVertical("Bakery")).toBe("OTHER");
    expect(metaVertical(null)).toBe("OTHER");
  });
});
