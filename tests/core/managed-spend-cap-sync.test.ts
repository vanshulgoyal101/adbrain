import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fundingTape from "./fixtures/meta/account-funding.json";
import syncTape from "./fixtures/meta/sync.json";
import pauseTape from "./fixtures/meta/pause.json";
import spendCapTape from "./fixtures/meta/managed-spend-cap.provisional.json";
import { requestBody } from "./replay";
import type { SpendCapState, SpendCapStore } from "@/lib/managed/spend-cap-store";

// #522 wiring: a managed customer's child ad account limit follows their balance through the real
// MetaClient on the parent token. Graph answers are Solaride's recordings (funding read, campaign
// list, verified pause; scripts/record-meta-core-fixtures.ts) and #534's provisional limit write.
// Derived from them, and marked where used: the funding read after a write, a zero-spend account,
// and one campaign listed ACTIVE so "stop" has something to pause. Only Supabase is stubbed.
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), campaignUpdates: [] as unknown[], getCustomerBalance: vi.fn(), confirmCustomerCampaign: vi.fn() }));
vi.mock("@/lib/payments/customer-balance", () => ({ getCustomerBalance: mocks.getCustomerBalance, confirmCustomerCampaign: mocks.confirmCustomerCampaign }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: mocks.rpc,
    from: (table: string) => {
      const filters: unknown[] = [];
      const query = {
        select: () => query,
        eq: (...filter: unknown[]) => { filters.push(filter); return query; },
        update: (values: unknown) => { mocks.campaignUpdates.push(values); return query; },
        maybeSingle: async () => ({ data: table === "managed_meta_accounts" ? LEDGER : null, error: null }),
        then: (resolve: (value: unknown) => void) => resolve(table === "campaigns" && filters.length === 3
          ? { data: [{ id: CAMPAIGN_ROW, meta_campaign_id: "120253646427440526" }], error: null } : { data: null, error: null }),
      };
      return query;
    },
  }),
}));

const BUSINESS = "6f0c2a10-5a43-4c55-9b1f-3f7a3f0c8c1f";
const OWNER = "8c1f4f0e-5a43-4c55-9b1f-3f7a3f0c2a10";
const CAMPAIGN_ROW = "0b8f4c1e-2d3a-4b5c-8d9e-0f1a2b3c4d5e";
const PARENT_TOKEN = "parent-system-user-token";
const ACCOUNT = "act_2398686420592052";
const LEDGER = { business_id: BUSINESS, state: "ready", child_business_id: "1158100643072999", ad_account_id: ACCOUNT,
  page_id: "885223068001054", funding_state: "card_attached", generation: 1 };
type Exchange = { method: string; path: string; form?: Record<string, string>; status: number; body: unknown };
const funding = (fundingTape as Exchange[])[0];
const fundingBody = funding.body as Record<string, unknown>;
const capWrite = (spendCapTape.exchanges as Exchange[])[0];

function replay(...exchanges: Exchange[]) {
  const pending = [...exchanges];
  const sent: string[] = [];
  const tokens = new Set<string>();
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    const form = new URLSearchParams(requestBody(init ?? undefined));
    tokens.add(url.searchParams.get("access_token") ?? form.get("access_token") ?? "none");
    url.searchParams.delete("access_token");
    form.delete("access_token");
    const method = init?.method ?? "GET";
    const path = url.pathname.replace("/v21.0/", "") + url.search;
    sent.push(`${method} ${path}${form.size ? ` ${form}` : ""}`);
    const index = pending.findIndex((exchange) => exchange.method === method && exchange.path === path
      && (!exchange.form || new URLSearchParams(exchange.form).toString() === form.toString()));
    if (index < 0) throw new Error(`Unrecorded Graph call: ${method} ${path} ${form}`);
    const [exchange] = pending.splice(index, 1);
    return Response.json(exchange.body, { status: exchange.status });
  });
  return { pending, sent, tokens };
}

function memoryStore(inputs: { mediaThisAccountPaise: number }) {
  let state: SpendCapState = { dirty: true, action: null, capPaise: null, roomPaise: null };
  const store: SpendCapStore & { state(): Promise<SpendCapState> } = {
    request: async () => true, begin: async () => true, abandon: async () => {},
    finish: async (_account, _token, decision) => { state = { dirty: false, ...decision }; return false; },
    inputs: async () => ({ ...inputs, mediaOtherAccountsPaise: 0, taxRateBps: 1800 }),
    state: async () => state,
  };
  return store;
}

beforeEach(() => {
  vi.resetModules();
  mocks.campaignUpdates.length = 0;
  mocks.rpc.mockResolvedValue({ data: null, error: null });
  for (const [name, value] of Object.entries({
    NEXT_PUBLIC_SUPABASE_URL: "https://core-test.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
    MANAGED_ACCOUNTS_ENABLED: "true", META_PARENT_SYSTEM_TOKEN: PARENT_TOKEN,
  })) vi.stubEnv(name, value);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("core: a managed customer's child ad account limit follows their balance (#522)", () => {
  it("sets the limit to what Meta spent plus the media the customer has left, in rupees, and reads it back", async () => {
    // ₹500 paid → ₹400 ad share → 33,898 media; Meta's recorded read: 4,237 spent under an older 88,983 limit.
    mocks.getCustomerBalance.mockResolvedValue({ advertisingAllocationPaise: 40_000, advertisingRefundedPaise: 0, held: false, reservations: [] });
    const { sent, pending, tokens } = replay(funding, { ...capWrite, path: ACCOUNT, form: { spend_cap: "338.98" } },
      // Derived: the recorded read with the new limit.
      { ...funding, body: { ...fundingBody, spend_cap: "33898" } });
    const store = memoryStore({ mediaThisAccountPaise: 4_237 });
    const { syncManagedSpendCap } = await import("@/lib/managed/spend-cap-wiring");
    expect(await syncManagedSpendCap({ businessId: BUSINESS, userId: OWNER }, store))
      .toMatchObject({ status: "applied", decision: { action: "set", capPaise: 33_898, roomPaise: 29_661 } });
    expect(sent).toEqual([`GET ${funding.path}`, `POST ${ACCOUNT} spend_cap=338.98`, `GET ${funding.path}`]);
    expect(pending).toEqual([]);
    expect([...tokens]).toEqual([PARENT_TOKEN]);
    expect(await store.state()).toEqual({ dirty: false, action: "set", capPaise: 33_898, roomPaise: 29_661 });
  });

  it("stops a held account with nothing spent: pauses its campaign on Meta first, then lowers the limit, then records it", async () => {
    mocks.getCustomerBalance.mockResolvedValue({ advertisingAllocationPaise: 40_000, advertisingRefundedPaise: 0, held: true,
      reservations: [{ campaignId: CAMPAIGN_ROW, reservationId: "a3c0d9a2-1f2b-4c3d-9e4f-5a6b7c8d9e0f", state: "active" }] });
    const listing = (syncTape as Exchange[])[0];
    const listed = listing.body as { data: Array<Record<string, unknown>> };
    const { sent, pending } = replay(
      { ...funding, body: { ...fundingBody, amount_spent: "0" } }, // Derived: nothing spent yet.
      { ...listing, body: { ...listed, data: listed.data.map((campaign, index) => index === 0 ? { ...campaign, status: "ACTIVE" } : campaign) } }, // Derived: one live.
      ...(pauseTape as Exchange[]),
      { ...capWrite, path: ACCOUNT, form: { spend_cap: "1.00" } },
      { ...funding, body: { ...fundingBody, spend_cap: "100", amount_spent: "0" } }, // Derived: the lowered limit.
    );
    const store = memoryStore({ mediaThisAccountPaise: 0 });
    const { syncManagedSpendCap } = await import("@/lib/managed/spend-cap-wiring");
    expect(await syncManagedSpendCap({ businessId: BUSINESS, userId: OWNER }, store)).toMatchObject({ decision: { action: "stop", reason: "held" } });
    const posts = sent.filter((call) => call.startsWith("POST"));
    expect(posts).toEqual(["POST 120253646427440526 status=PAUSED", `POST ${ACCOUNT} spend_cap=1.00`]);
    expect(pending).toEqual([]);
    expect(mocks.campaignUpdates).toEqual([{ status: "paused" }]);
    expect(mocks.confirmCustomerCampaign).toHaveBeenCalledWith({ businessId: BUSINESS, userId: OWNER }, CAMPAIGN_ROW, "a3c0d9a2-1f2b-4c3d-9e4f-5a6b7c8d9e0f", "paused");
    expect(await store.state()).toEqual({ dirty: false, action: "stop", capPaise: 100, roomPaise: 0 });
  });
});
