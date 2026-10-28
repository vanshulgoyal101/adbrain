import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  tables: {} as Record<string, unknown>, rpc: vi.fn(), getUserById: vi.fn(), fundingMode: vi.fn(),
  createPlanLink: vi.fn(), findPlanLink: vi.fn(), fetchPlanLink: vi.fn(),
}));
function query(table: string) {
  const result = { data: mocks.tables[table], error: null };
  const chain: Record<string, unknown> = {};
  for (const name of ["select", "eq", "not", "order", "limit"]) chain[name] = () => chain;
  chain.maybeSingle = async () => result;
  chain.then = (resolve: (value: unknown) => void) => resolve(result);
  return chain;
}
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: query, rpc: mocks.rpc, auth: { admin: { getUserById: mocks.getUserById } } }) }));
vi.mock("@/lib/payments/operator-funding", () => ({ fundingMode: mocks.fundingMode }));
vi.mock("@/lib/payments/razorpay-production", () => ({ createProductionPaymentClient: () => ({ createPlanLink: mocks.createPlanLink, findPlanLink: mocks.findPlanLink, fetchPlanLink: mocks.fetchPlanLink }) }));

import { ensurePayLink, planContact, PlanNotDueError, readPlan } from "@/lib/plan/store";

const businessId = "55555555-5555-4555-8555-555555555555";
const periodId = "44444444-4444-4444-8444-444444444444";
const owner = { id: "owner", email: "owner@example.com", email_confirmed_at: "2026-01-01T00:00:00Z" };
const now = new Date("2026-11-08T00:00:00Z");

beforeEach(() => {
  vi.resetAllMocks();
  mocks.tables = { businesses: { owner_id: "owner", phone: "98765 43210" }, campaigns: [{ launched_at: "2026-10-10T09:00:00.000Z" }], plan_periods: [] };
  mocks.fundingMode.mockResolvedValue("own");
  mocks.getUserById.mockResolvedValue({ data: { user: owner }, error: null });
  mocks.rpc.mockImplementation(async (name: string) => ({ data: name === "plan_period_open" ? { periodId, linkId: null, shortUrl: null } : true, error: null }));
  mocks.createPlanLink.mockResolvedValue({ id: "plink_A", shortUrl: "https://rzp.io/i/a" });
});

describe("plan store (#718)", () => {
  it("reads the free month from the first Go live and offers payment in its last week", async () => {
    await expect(readPlan(businessId, now)).resolves.toEqual({ status: { state: "free", until: "2026-11-10T09:00:00.000Z", dueSoon: true }, payUrl: null });
  });

  it("exempts managed or operator businesses and the team's own accounts", async () => {
    mocks.fundingMode.mockResolvedValue("managed");
    expect((await readPlan(businessId, now)).status).toEqual({ state: "exempt" });
    mocks.fundingMode.mockResolvedValue("own");
    mocks.getUserById.mockResolvedValue({ data: { user: { ...owner, email: "qa@adbrain.vanshul.com" } }, error: null });
    expect((await readPlan(businessId, now)).status).toEqual({ state: "exempt" });
  });

  it("makes the month's link once, for the owner's email and Indian number, and returns it", async () => {
    await expect(ensurePayLink(businessId, now)).resolves.toBe("https://rzp.io/i/a");
    expect(mocks.createPlanLink).toHaveBeenCalledWith({ periodId, businessId, email: "owner@example.com", phone: "+919876543210", expireBy: now.getTime() / 1000 + 30 * 86_400 });
    expect(mocks.rpc).toHaveBeenCalledWith("plan_period_set_link", { p_period_id: periodId, p_link_id: "plink_A", p_short_url: "https://rzp.io/i/a" });
  });

  it("reuses an open month's link without asking Razorpay again", async () => {
    mocks.tables.plan_periods = [{ state: "open", starts_at: null, ends_at: null, paid_at: null, short_url: "https://rzp.io/i/open" }];
    await expect(ensurePayLink(businessId, now)).resolves.toBe("https://rzp.io/i/open");
    expect(mocks.createPlanLink).not.toHaveBeenCalled();
  });

  it("after a raced or failed create, uses the link Razorpay already has for the month instead of making a second", async () => {
    mocks.createPlanLink.mockRejectedValue(new Error("reference_id already exists"));
    mocks.findPlanLink.mockResolvedValue({ id: "plink_First", shortUrl: "https://rzp.io/i/first" });
    await expect(ensurePayLink(businessId, now)).resolves.toBe("https://rzp.io/i/first");
    expect(mocks.findPlanLink).toHaveBeenCalledWith(periodId);
    mocks.findPlanLink.mockResolvedValue(null);
    await expect(ensurePayLink(businessId, now)).rejects.toThrow("reference_id already exists");
  });

  it("refuses to make a link before anything is due", async () => {
    await expect(ensurePayLink(businessId, new Date("2026-10-20T00:00:00Z"))).rejects.toBeInstanceOf(PlanNotDueError);
    mocks.tables.campaigns = [];
    await expect(ensurePayLink(businessId, now)).rejects.toBeInstanceOf(PlanNotDueError);
    expect(mocks.createPlanLink).not.toHaveBeenCalled();
  });

  // #1583 (Reviewer): a lost payment_link.expired/paid webhook must not leave the owner with a dead Pay link while
  // the gate blocks new ads. Past its lifetime, the open month's link is re-read from Razorpay and settled.
  describe("an open month whose link has outlived its 30 days (#1583)", () => {
    const stale = { state: "open", starts_at: null, ends_at: null, paid_at: null, short_url: "https://rzp.io/i/old", payment_link_id: "plink_Old", created_at: "2026-10-01T00:00:00Z" };
    const link = (status: string, paymentId: string | null = null) => ({ id: "plink_Old", status, amountPaise: 99900, referenceId: periodId, paymentId });
    beforeEach(() => {
      mocks.tables.plan_periods = [{ ...stale }];
      mocks.rpc.mockImplementation(async (name: string) => {
        if (name === "plan_period_expire") { mocks.tables.plan_periods = [{ ...stale, state: "expired" }]; return { data: true, error: null }; }
        if (name === "plan_period_paid") return { data: "paid", error: null };
        return { data: name === "plan_period_open" ? { periodId, linkId: null, shortUrl: null } : true, error: null };
      });
    });

    it("expires it when Razorpay says expired, then makes this month's fresh link", async () => {
      mocks.fetchPlanLink.mockResolvedValue(link("expired"));
      await expect(ensurePayLink(businessId, now)).resolves.toBe("https://rzp.io/i/a");
      expect(mocks.fetchPlanLink).toHaveBeenCalledWith("plink_Old");
      expect(mocks.rpc).toHaveBeenCalledWith("plan_period_expire", { p_link_id: "plink_Old" });
      expect(mocks.createPlanLink).toHaveBeenCalledOnce();
    });

    it("settles the month when Razorpay says it was paid, and never expires a paid link", async () => {
      mocks.fetchPlanLink.mockResolvedValue(link("paid", "pay_Lost"));
      await readPlan(businessId, now);
      expect(mocks.rpc).toHaveBeenCalledWith("plan_period_paid", expect.objectContaining({ p_link_id: "plink_Old", p_payment_id: "pay_Lost" }));
      expect(mocks.rpc).not.toHaveBeenCalledWith("plan_period_expire", expect.anything());
    });

    it("leaves a link Razorpay still has open alone", async () => {
      mocks.fetchPlanLink.mockResolvedValue(link("created"));
      await expect(ensurePayLink(businessId, now)).resolves.toBe("https://rzp.io/i/old");
      expect(mocks.rpc).not.toHaveBeenCalledWith("plan_period_expire", expect.anything());
      expect(mocks.createPlanLink).not.toHaveBeenCalled();
    });

    it("doesn't ask Razorpay about a link inside its 30 days, and a failed check keeps the old answer", async () => {
      mocks.tables.plan_periods = [{ ...stale, created_at: "2026-10-20T00:00:00Z" }];
      await expect(ensurePayLink(businessId, now)).resolves.toBe("https://rzp.io/i/old");
      expect(mocks.fetchPlanLink).not.toHaveBeenCalled();
      mocks.tables.plan_periods = [{ ...stale }];
      mocks.fetchPlanLink.mockRejectedValue(new Error("Razorpay down"));
      await expect(ensurePayLink(businessId, now)).resolves.toBe("https://rzp.io/i/old");
    });
  });

  it("formats Indian numbers for Razorpay and drops anything else", () => {
    expect(["9876543210", "+91 98765 43210", "919876543210", "12345", null].map(planContact)).toEqual(["+919876543210", "+919876543210", "+919876543210", null, null]);
  });
});
