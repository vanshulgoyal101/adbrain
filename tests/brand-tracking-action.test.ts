import { beforeEach, describe, expect, it, vi } from "vitest";
import * as brandActions from "@/app/(app)/brand/actions";
import type { ReviewTracking } from "@/lib/campaign/website-tracking";

const deps = vi.hoisted(() => ({
  getUser: vi.fn(),
  getPrimaryBusiness: vi.fn(),
  isInternalUser: vi.fn(),
  readTrackingStatusForBusiness: vi.fn(),
}));

vi.mock("@/lib/observability/logger", () => ({
  observeAction: (_name: string, handler: () => Promise<unknown>) => handler(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: deps.getUser } }),
}));
vi.mock("@/lib/supabase/queries", () => ({ getPrimaryBusiness: deps.getPrimaryBusiness }));
vi.mock("@/lib/internal-accounts", () => ({ isInternalUser: deps.isInternalUser }));
vi.mock("@/lib/meta/credentials", () => ({
  readTrackingStatusForBusiness: deps.readTrackingStatusForBusiness,
}));

const tracking: ReviewTracking = {
  pixelId: "101",
  status: {
    state: "ready", unreadable: null, pixelId: "101",
    pixels: [{ id: "101", name: "Shop", lastFiredAt: null, unavailable: false }],
    window: { since: "2026-10-28T00:00:00Z", until: "2026-11-04T00:00:00Z" },
    lastSeenAt: null, counts: { Lead: 2, Purchase: 1 }, totalEvents: 3,
  },
};

function refreshAction() {
  const action: unknown = Reflect.get(brandActions, "refreshBrandTracking");
  expect(action).toBeTypeOf("function");
  return typeof action === "function" ? action as (pixelId: string | null) => Promise<ReviewTracking | null> : null;
}

describe("refreshBrandTracking", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    deps.getUser.mockResolvedValue({ data: { user: { id: "team-user" } } });
    deps.getPrimaryBusiness.mockResolvedValue({ id: "business-1", website: "https://shop.example" });
    deps.isInternalUser.mockReturnValue(true);
    deps.readTrackingStatusForBusiness.mockResolvedValue(tracking.status);
  });

  it("does not read tracking without an internal user", async () => {
    deps.getUser.mockResolvedValue({ data: { user: null } });
    const action = refreshAction();
    if (!action) return;

    await expect(action("101")).resolves.toBeNull();
    expect(deps.isInternalUser).not.toHaveBeenCalled();
    expect(deps.readTrackingStatusForBusiness).not.toHaveBeenCalled();
  });

  it("reads only the current website business and selected account pixel", async () => {
    const action = refreshAction();
    if (!action) return;

    await expect(action("101")).resolves.toEqual(tracking);
    expect(deps.getPrimaryBusiness).toHaveBeenCalledExactlyOnceWith();
    expect(deps.readTrackingStatusForBusiness).toHaveBeenCalledExactlyOnceWith("business-1", "101");
  });

  it("rejects malformed pixel identifiers without reading Meta", async () => {
    const action = refreshAction();
    if (!action) return;

    await expect(action("not-a-pixel")).resolves.toBeNull();
    expect(deps.readTrackingStatusForBusiness).not.toHaveBeenCalled();
  });

  it("does not read tracking when the current business has no website", async () => {
    deps.getPrimaryBusiness.mockResolvedValue({ id: "business-1", website: null });
    const action = refreshAction();
    if (!action) return;

    await expect(action("101")).resolves.toBeNull();
    expect(deps.readTrackingStatusForBusiness).not.toHaveBeenCalled();
  });
});
