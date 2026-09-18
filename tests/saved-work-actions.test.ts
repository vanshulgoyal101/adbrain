import { beforeEach, describe, expect, it, vi } from "vitest";
import { setCreativeStatus, deleteCreative } from "@/app/(app)/studio/actions";
import { saveInstruction, deleteInstruction } from "@/app/(app)/brand/instruction-actions";

const mocks = vi.hoisted(() => ({ result: vi.fn(), eq: vi.fn(), update: vi.fn(), remove: vi.fn(), log: vi.fn(), refresh: vi.fn(), getUser: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.refresh }));
vi.mock("@/lib/audit", () => ({ logEvent: mocks.log }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    const query = { eq: mocks.eq, update: mocks.update, delete: mocks.remove, select: () => query, single: mocks.result, maybeSingle: mocks.result };
    mocks.eq.mockReturnValue(query);
    mocks.update.mockReturnValue(query);
    mocks.remove.mockReturnValue(query);
    return { auth: { getUser: mocks.getUser }, from: () => query };
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.result.mockResolvedValue({ data: null, error: null });
  mocks.getUser.mockResolvedValue({ data: { user: { id: "owner" } } });
});

describe("saved-work mutation receipts", () => {
  const actions = [
    { name: "approve", run: () => setCreativeStatus("creative", "approved") },
    { name: "delete creative", run: () => deleteCreative("creative") },
    { name: "save instruction", run: () => saveInstruction({ id: "instruction", businessId: "business", title: "Rules", content: "Be factual", isActive: true }) },
    { name: "delete instruction", run: () => deleteInstruction("instruction", "business") },
  ];
  it.each(actions)("does not claim success for a missing or inaccessible row: $name", async ({ run }) => {
    expect(await run()).toMatchObject({ ok: false });
    expect(mocks.log).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it.each(actions)("reports database failure without refreshing: $name", async ({ run }) => {
    mocks.result.mockResolvedValue({ data: null, error: { message: "Write failed" } });
    expect(await run()).toEqual({ ok: false, error: "Write failed" });
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it.each(actions)("records success only after a returned mutation: $name", async ({ run }) => {
    mocks.result.mockResolvedValue({ data: { id: "saved", business_id: "business" }, error: null });
    expect(await run()).toEqual({ ok: true });
    expect(mocks.log).toHaveBeenCalledOnce();
    expect(mocks.refresh).toHaveBeenCalled();
  });
  it("scopes instruction deletes to the requested business", async () => {
    await deleteInstruction("instruction", "business");
    expect(mocks.eq).toHaveBeenCalledWith("business_id", "business");
  });
  it("rejects unauthenticated instruction deletion", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    expect(await deleteInstruction("instruction", "business")).toMatchObject({ ok: false });
    expect(mocks.remove).not.toHaveBeenCalled();
  });
  it("validates creative status at runtime", async () => {
    expect(await setCreativeStatus("creative", "invalid" as "approved")).toMatchObject({ ok: false });
    expect(mocks.update).not.toHaveBeenCalled();
  });
});