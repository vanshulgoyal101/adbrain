import { beforeEach, describe, expect, it, vi } from "vitest";

// #2032: Home's meter saves one Brand fact to its existing column, under the owner's own session (RLS).
const mocks = vi.hoisted(() => ({ getUser: vi.fn(), current: vi.fn(), update: vi.fn(), written: vi.fn(), logEvent: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logEvent: mocks.logEvent }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: mocks.getUser },
    from: () => ({
      select: () => ({ eq: () => ({ single: mocks.current }) }),
      update: (payload: unknown) => { mocks.update(payload); return { eq: () => ({ select: () => ({ single: mocks.written }) }) }; },
    }),
  }),
}));

import { saveBrandFact } from "@/app/(app)/brand/actions";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
  mocks.current.mockResolvedValue({ data: { offers: ["Best service", "Diwali deal"], usps: ["Own team"] }, error: null });
  mocks.written.mockResolvedValue({ data: { id: "b1" }, error: null });
});

describe("saveBrandFact (#2032)", () => {
  it("replaces only the first offer, the one Create leads with", async () => {
    expect(await saveBrandFact("b1", "offer", "  Free site survey ")).toEqual({ ok: true });
    expect(mocks.update).toHaveBeenCalledWith({ offers: ["Free site survey", "Diwali deal"] });
  });

  it("adds proof and why as new #1966 lines, keeping the old ones", async () => {
    await saveBrandFact("b1", "proof", "200 homes installed in Mohali");
    expect(mocks.update).toHaveBeenCalledWith({ usps: ["Own team", "200 homes installed in Mohali"] });
  });

  it("saves the audience to target_audience", async () => {
    await saveBrandFact("b1", "audience", "Families moving into a new flat");
    expect(mocks.update).toHaveBeenCalledWith({ target_audience: "Families moving into a new flat" });
  });

  it("refuses blanks, unfilled #1966 blanks, unknown facts and a signed-out user without writing", async () => {
    expect(await saveBrandFact("b1", "why", "   ")).toMatchObject({ ok: false });
    expect(await saveBrandFact("b1", "proof", "{n} homes installed in Mohali")).toEqual({ ok: false, error: "Fill in each blank, using only what is true for your business." });
    expect(await saveBrandFact("b1", "description" as never, "x")).toMatchObject({ ok: false });
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    expect(await saveBrandFact("b1", "audience", "Homeowners")).toMatchObject({ ok: false });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  // #2231: the scoreboard's Brand clock stops on the first save flagged usable; this save can add the last fact.
  it("flags whether the saved Brand is now usable, for the scoreboard's Brand clock", async () => {
    const row = { id: "b1", name: "Sun Solar", vertical: "Solar installer", phone: "+919876543210", locations: ["Mohali"] };
    mocks.written.mockResolvedValue({ data: { ...row, offers: ["Free site survey"] }, error: null });
    await saveBrandFact("b1", "offer", "Free site survey");
    expect(mocks.logEvent).toHaveBeenLastCalledWith(expect.objectContaining({ action: "business.update", eventAttributes: { brandUsable: true } }));
    mocks.written.mockResolvedValue({ data: { ...row, phone: null, offers: ["Free site survey"] }, error: null });
    await saveBrandFact("b1", "audience", "Homeowners");
    expect(mocks.logEvent).toHaveBeenLastCalledWith(expect.objectContaining({ eventAttributes: { brandUsable: false } }));
  });

  it("says so in plain words when the write fails", async () => {
    mocks.written.mockResolvedValue({ data: null, error: { message: "permission denied for table businesses" } });
    expect(await saveBrandFact("b1", "audience", "Homeowners")).toEqual({ ok: false, error: "Your business details weren't saved. Check your connection and try again." });
  });
});
