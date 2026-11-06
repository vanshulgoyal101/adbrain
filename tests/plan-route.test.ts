import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ owned: vi.fn(), readPlan: vi.fn(), ensurePayLink: vi.fn(), enabled: vi.fn(), rateLimit: vi.fn() }));
vi.mock("@/lib/meta/connection-access", async (importOriginal) => ({ ...(await importOriginal<object>()), requireOwnedBusiness: mocks.owned }));
vi.mock("@/lib/security/rate-limit", () => ({ rateLimitResponse: mocks.rateLimit }));
vi.mock("@/lib/payments/production-config", () => ({ getProductionPaymentConfig: () => ({ origin: "https://adbrain.vanshul.com" }) }));
vi.mock("@/lib/plan/store", async (importOriginal) => ({
  ...(await importOriginal<object>()), readPlan: mocks.readPlan, ensurePayLink: mocks.ensurePayLink, isPlanBillingEnabled: mocks.enabled,
}));

import { GET, POST } from "@/app/api/payments/plan/route";
import { ConnectionAccessError } from "@/lib/meta/connection-access";
import { PlanNotDueError } from "@/lib/plan/store";

const businessId = "55555555-5555-4555-8555-555555555555";
const origin = "https://adbrain.vanshul.com";
const get = () => GET(new Request(`${origin}/api/payments/plan?businessId=${businessId}`));
const post = (body: unknown = { businessId }, from = origin) => POST(new Request(`${origin}/api/payments/plan`, {
  method: "POST", headers: { "Content-Type": "application/json", origin: from }, body: JSON.stringify(body),
}));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.owned.mockResolvedValue({ businessId, userId: "owner" });
  mocks.rateLimit.mockResolvedValue(null);
  mocks.enabled.mockReturnValue(true);
  mocks.readPlan.mockResolvedValue({ status: { state: "unpaid", since: "2026-11-10T09:00:00.000Z" }, payUrl: "https://rzp.io/i/a" });
  mocks.ensurePayLink.mockResolvedValue("https://rzp.io/i/a");
});

describe("/api/payments/plan (#718)", () => {
  it("returns the owner's plan and link, and nothing while plan billing is off", async () => {
    expect(await (await get()).json()).toEqual({ plan: { state: "unpaid", since: "2026-11-10T09:00:00.000Z" }, payUrl: "https://rzp.io/i/a" });
    expect(mocks.owned).toHaveBeenCalledWith(businessId);
    mocks.enabled.mockReturnValue(false);
    expect(await (await get()).json()).toEqual({ plan: null, payUrl: null });
    expect(mocks.readPlan).toHaveBeenCalledTimes(1);
  });

  it("refuses another owner's business before reading anything", async () => {
    mocks.owned.mockRejectedValue(new ConnectionAccessError("FORBIDDEN", "No."));
    expect((await get()).status).toBe(403);
    expect((await post()).status).toBe(403);
    expect(mocks.readPlan).not.toHaveBeenCalled();
    expect(mocks.ensurePayLink).not.toHaveBeenCalled();
  });

  it("opens the month's link for a same-origin owner, and says when nothing is due", async () => {
    expect(await (await post()).json()).toEqual({ payUrl: "https://rzp.io/i/a" });
    expect((await post({ businessId }, "https://evil.example")).status).toBe(403);
    expect((await post({ businessId, extra: 1 })).status).toBe(400);
    mocks.ensurePayLink.mockRejectedValue(new PlanNotDueError());
    expect((await post()).status).toBe(409);
    mocks.enabled.mockReturnValue(false);
    expect((await post()).status).toBe(404);
  });
});
