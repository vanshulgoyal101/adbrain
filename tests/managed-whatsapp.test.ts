import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkManagedWhatsApp } from "@/lib/meta/managed-whatsapp";

const m = vi.hoisted(() => ({
  account: null as unknown, token: "parent-token" as string | null, pageNumber: null as string | null,
  updateError: null as null | { code: string }, writes: [] as [string, string, unknown][],
}));
vi.mock("@/lib/meta/managed-account", () => ({
  getManagedAccount: async () => m.account,
  managedCredentials: (account: { ad_account_id: string | null; page_id: string | null }) =>
    account.ad_account_id && account.page_id && m.token ? { adAccountId: account.ad_account_id, pageId: account.page_id, accessToken: m.token } : null,
}));
vi.mock("@/lib/meta/client", () => ({ MetaClient: class { getWhatsAppNumber = async () => m.pageNumber; } }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      update: (row: unknown) => ({ eq: async () => { m.writes.push([table, "update", row]); return { error: m.updateError }; } }),
      upsert: async (row: unknown) => { m.writes.push([table, "upsert", row]); return { error: null }; },
      insert: async (row: unknown) => { m.writes.push([table, "insert", row]); return { error: null }; },
    }),
  }),
}));

const ready = { business_id: "b", state: "funded", page_id: "7101", child_business_id: "7201", ad_account_id: "act_7301", funding_state: "card_attached", generation: 1 };
beforeEach(() => { m.account = ready; m.token = "parent-token"; m.pageNumber = null; m.updateError = null; m.writes = []; });

describe("Page-linked WhatsApp for managed customers (#524 v1)", () => {
  it("waits for the child ad account before it can read the Page with the parent token", async () => {
    m.account = { ...ready, state: "page_linked", child_business_id: null, ad_account_id: null };
    expect(await checkManagedWhatsApp("b")).toEqual({ status: "waiting_setup" });
    expect(m.writes).toEqual([]);
  });

  it("says so when the Page has no linked WhatsApp yet, and writes nothing", async () => {
    expect(await checkManagedWhatsApp("b")).toEqual({ status: "not_linked" });
    expect(m.writes).toEqual([]);
  });

  it("records the Page's number on the ledger, binds it as page_link, and moves funded → whatsapp_linked", async () => {
    m.pageNumber = "+919999990874";
    expect(await checkManagedWhatsApp("b")).toEqual({ status: "linked", masked: "+91 ••••• 0874" });
    expect(m.writes).toEqual([
      ["managed_meta_accounts", "update", { whatsapp_number_e164: "+919999990874", state: "whatsapp_linked" }],
      ["whatsapp_number_bindings", "upsert", { business_id: "b", phone_e164: "+919999990874", source: "page_link" }],
      ["managed_meta_account_events", "insert", { business_id: "b", step: "whatsapp", outcome: "succeeded", meta_object_id: "7101" }],
    ]);
  });

  it("records the number without skipping ahead of funding", async () => {
    m.account = { ...ready, state: "ad_account_created", funding_state: "none" };
    m.pageNumber = "+919999990874";
    await checkManagedWhatsApp("b");
    expect(m.writes[0]).toEqual(["managed_meta_accounts", "update", { whatsapp_number_e164: "+919999990874" }]);
  });

  it("refuses a number another customer already uses, without binding it", async () => {
    m.pageNumber = "+919999990874";
    m.updateError = { code: "23505" };
    expect(await checkManagedWhatsApp("b")).toEqual({ status: "taken" });
    expect(m.writes.map(([table]) => table)).toEqual(["managed_meta_accounts"]);
  });
});
