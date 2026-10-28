import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ secret: "cron-secret" as string | undefined, enabled: vi.fn(), readPlan: vi.fn(), ensurePayLink: vi.fn(), rows: [] as { business_id: string }[] }));
vi.mock("@/lib/env", () => ({ getEnv: () => ({ CRON_SECRET: mocks.secret }) }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: () => ({ select: () => ({ not: () => ({ limit: async () => ({ data: mocks.rows, error: null }) }) }) }) }),
}));
vi.mock("@/lib/plan/store", async (importOriginal) => ({
  ...(await importOriginal<object>()), isPlanBillingEnabled: mocks.enabled, readPlan: mocks.readPlan, ensurePayLink: mocks.ensurePayLink,
}));

import { GET } from "@/app/api/cron/plan-links/route";

const call = (auth = `Bearer ${mocks.secret}`) => GET(new Request("http://localhost/api/cron/plan-links", { headers: { authorization: auth } }));
const plan = (status: unknown, payUrl: string | null = null) => ({ status, payUrl });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.secret = "cron-secret";
  mocks.enabled.mockReturnValue(true);
  mocks.rows = [{ business_id: "due" }, { business_id: "due" }, { business_id: "linked" }, { business_id: "early" }, { business_id: "exempt" }, { business_id: "unpaid" }];
  mocks.readPlan.mockImplementation(async (id: string) => ({
    due: plan({ state: "free", until: "2026-11-10T09:00:00.000Z", dueSoon: true }),
    linked: plan({ state: "paid", until: "2026-12-10T09:00:00.000Z", dueSoon: true }, "https://rzp.io/i/l"),
    early: plan({ state: "paid", until: "2026-12-10T09:00:00.000Z", dueSoon: false }),
    exempt: plan({ state: "exempt" }),
    unpaid: plan({ state: "unpaid", since: "2026-11-01T00:00:00.000Z" }),
  })[id]);
  mocks.ensurePayLink.mockResolvedValue("https://rzp.io/i/new");
});

describe("plan link cron (#718)", () => {
  it("needs the cron secret", async () => {
    expect((await call("Bearer wrong")).status).toBe(401);
    mocks.secret = undefined;
    expect((await call()).status).toBe(404);
    expect(mocks.readPlan).not.toHaveBeenCalled();
  });

  it("does nothing while plan billing is off", async () => {
    mocks.enabled.mockReturnValue(false);
    expect(await (await call()).json()).toEqual({ ok: true, enabled: false, checked: 0, created: 0, failed: 0 });
    expect(mocks.readPlan).not.toHaveBeenCalled();
  });

  it("makes a link only for live businesses due within a week or unpaid that don't have one, once each", async () => {
    expect(await (await call()).json()).toEqual({ ok: true, enabled: true, checked: 5, created: 2, failed: 0 });
    expect(mocks.ensurePayLink.mock.calls.map(([id]) => id)).toEqual(["due", "unpaid"]);
  });

  it("keeps going when one business fails, and reports it", async () => {
    mocks.ensurePayLink.mockImplementation(async (id: string) => { if (id === "due") throw new Error("razorpay down"); return "https://rzp.io/i/x"; });
    const response = await call();
    expect(await response.json()).toEqual({ ok: false, enabled: true, checked: 5, created: 1, failed: 1 });
    expect(mocks.ensurePayLink).toHaveBeenCalledWith("unpaid");
  });
});
