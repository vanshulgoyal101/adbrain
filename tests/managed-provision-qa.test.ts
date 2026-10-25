import { describe, expect, it } from "vitest";
import { provisionManagedAccount, type ProvisionGraph, type ProvisionStore } from "@/lib/meta/managed-provision";

// QA red tests for #527 T3 (never create twice) against the merged #521 provisioning.
const PARENT = "9000000000001";
const business = "11111111-1111-4111-8111-111111111111";
const OURS = "7000000000777";

function ledger(row: Record<string, unknown>) {
  let current: Record<string, unknown> = { child_business_id: null, ad_account_id: null, step_keys: {}, last_error: null, ...row };
  const store: ProvisionStore = {
    get: async () => current as never,
    update: async (values) => { current = { ...current, ...values }; },
    event: async () => {},
  };
  return { store, row: () => current };
}

type Child = { id: string; child_business_external_id?: string };

function meta(options: { pages?: Child[][]; accounts?: { id: string; name: string }[] }) {
  const pages = options.pages ?? [[]];
  const posts: string[] = [];
  const graph: ProvisionGraph = {
    get: async (path) => {
      if (path.startsWith(`${PARENT}/owned_businesses`) || path.includes(`/${PARENT}/owned_businesses`)) {
        // A filtered lookup by our external id may answer directly.
        if (path.includes(business)) return { data: pages.flat().filter((child) => child.child_business_external_id === business) } as never;
        const index = Number(/after=CURSOR(\d+)/.exec(path)?.[1] ?? 0);
        const next = index + 1 < pages.length ? `CURSOR${index + 1}` : undefined;
        return { data: pages[index], ...(next ? { paging: { cursors: { after: next }, next: `https://graph.facebook.com/v21.0/${PARENT}/owned_businesses?fields=id,child_business_external_id&limit=200&after=${next}` } } : {}) } as never;
      }
      if (path.includes("/owned_ad_accounts")) return { data: options.accounts ?? [] } as never;
      if (path.includes("/assigned_users")) return { data: [] } as never;
      if (path.startsWith("me?")) return { id: "6100000000009" } as never;
      throw new Error(`unexpected GET ${path}`);
    },
    post: async (path, form) => {
      posts.push(path);
      if (path === `${PARENT}/owned_businesses`) return { id: "7000000000999" } as never;
      if (path.endsWith("/adaccount")) return { id: `act_8000000000999`, name: form.name } as never;
      if (path.endsWith("/assigned_users")) return { success: true } as never;
      if (path.endsWith("/access_token")) return { access_token: "child-token" } as never;
      throw new Error(`unexpected POST ${path}`);
    },
  };
  return { graph, posts };
}

const tokens = { customer: "customer-token", parent: "parent-token" };
const run = (store: ProvisionStore, graph: ProvisionGraph, businessName = "Solaride Mohali") =>
  provisionManagedAccount({ businessId: business, businessName, parentBusinessId: PARENT, store, graph, tokens, manager: { appId: "2286157145462990", save: async () => "00000000-0000-4000-8000-000000000001", load: async () => null, remove: async () => {} }, requestId: "r1" });

const others = (count: number, from = 0): Child[] =>
  Array.from({ length: count }, (_, i) => ({ id: String(7100000000000 + from + i), child_business_external_id: `other-${from + i}` }));

describe("QA #527 T3: provisioning never creates twice (#521)", () => {
  it("finds this customer's child beyond the first page of 200 children instead of creating another", async () => {
    const db = ledger({ business_id: business, state: "failed", page_id: "111" });
    const { graph, posts } = meta({ pages: [others(200), [...others(10, 200), { id: OURS, child_business_external_id: business }]], accounts: [] });
    const result = await run(db.store, graph);
    expect(posts.filter((path) => path.endsWith("/owned_businesses"))).toEqual([]);
    expect(result).toMatchObject({ ok: true, childBusinessId: OURS });
  });

  it("refuses to create a child when Meta's answer doesn't say which customer each child belongs to", async () => {
    // If Meta leaves out child_business_external_id, a lost response can't be found: stop rather than duplicate.
    const db = ledger({ business_id: business, state: "failed", page_id: "111" });
    const { graph, posts } = meta({ pages: [[{ id: OURS }, { id: "7000000000778" }]] });
    const result = await run(db.store, graph);
    expect(posts.filter((path) => path.endsWith("/owned_businesses"))).toEqual([]);
    expect(result).toMatchObject({ ok: false });
  });

  it("adopts the child's existing ad account after the business was renamed, instead of making a second", async () => {
    // Run 1 made the ad account but its response was lost; the owner then renamed the business.
    const db = ledger({ business_id: business, state: "failed", page_id: "111", child_business_id: OURS });
    const { graph, posts } = meta({ accounts: [{ id: "act_8000000000777", name: `AdBrain ${business.slice(0, 8)} Solaride Mohali` }] });
    const result = await run(db.store, graph, "Solaride Solar Mohali");
    expect(posts.filter((path) => path.endsWith("/adaccount"))).toEqual([]);
    expect(result).toMatchObject({ ok: true, adAccountId: "act_8000000000777" });
  });
});
