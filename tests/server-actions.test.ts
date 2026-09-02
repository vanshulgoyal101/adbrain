import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Server actions ("use server"): the mutation path behind the Brand Brain form,
 * the instruction editor and the Creative Studio. They own auth checks, input
 * shaping and cache invalidation, so all three are pinned here.
 */

const getUser = vi.fn();
const single = vi.fn();
const maybeSingle = vi.fn();
const update = vi.fn();
const insert = vi.fn();
const del = vi.fn();
const revalidatePath = vi.fn();
const logEvent = vi.fn();

/** Result of `await ...update().eq()` — studio actions await the eq() directly. */
let updateResult: { error: { message: string } | null } = { error: null };

vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/audit", () => ({ logEvent }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle }) }),
      insert: (payload: unknown) => {
        insert(payload);
        return { select: () => ({ single }) };
      },
      update: (payload: unknown) => {
        update(payload);
        return {
          // Chainable for `.eq().select().single()` and awaitable on its own.
          eq: () => ({
            select: () => ({ single }),
            then: (resolve: (v: typeof updateResult) => unknown) =>
              resolve(updateResult),
          }),
        };
      },
      delete: () => ({ eq: del }),
    }),
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  getUser.mockResolvedValue({ data: { user: { id: "u1", email: "o@x.com" } } });
  single.mockResolvedValue({ data: { id: "b1" }, error: null });
  maybeSingle.mockResolvedValue({ data: { business_id: "b1" } });
  del.mockResolvedValue({ error: null });
  updateResult = { error: null };
});

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

describe("saveBusiness", () => {
  it("refuses to save when signed out", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const { saveBusiness } = await import("@/app/(app)/brand/actions");
    await expect(
      saveBusiness({ ok: false }, form({ name: "Acme" })),
    ).resolves.toEqual({ ok: false, error: "Not authenticated." });
    expect(insert).not.toHaveBeenCalled();
  });

  it("requires a business name", async () => {
    const { saveBusiness } = await import("@/app/(app)/brand/actions");
    const res = await saveBusiness({ ok: false }, form({ name: "   " }));
    expect(res).toEqual({ ok: false, error: "Business name is required." });
  });

  it("creates a new business owned by the signed-in user", async () => {
    const { saveBusiness } = await import("@/app/(app)/brand/actions");
    const res = await saveBusiness({ ok: false }, form({ name: "Acme Solar" }));
    expect(res.ok).toBe(true);
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Acme Solar", owner_id: "u1" }),
    );
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "business.create" }),
    );
  });

  it("updates in place when an id is present", async () => {
    const { saveBusiness } = await import("@/app/(app)/brand/actions");
    await saveBusiness({ ok: false }, form({ id: "b1", name: "Acme Solar" }));
    expect(update).toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "business.update" }),
    );
  });

  it("splits languages and locations on commas or newlines", async () => {
    const { saveBusiness } = await import("@/app/(app)/brand/actions");
    await saveBusiness(
      { ok: false },
      form({
        name: "Acme",
        languages: "English, Hindi\nMarathi",
        locations: "Jaipur,Ajmer",
      }),
    );
    expect(insert.mock.calls[0][0]).toMatchObject({
      languages: ["English", "Hindi", "Marathi"],
      locations: ["Jaipur", "Ajmer"],
    });
  });

  it("keeps commas inside a USP or offer — they are one per line", async () => {
    const { saveBusiness } = await import("@/app/(app)/brand/actions");
    await saveBusiness(
      { ok: false },
      form({
        name: "Acme",
        usps: "Affordable, transparent pricing\n25-year warranty",
        offers: "Free site survey, no obligation",
      }),
    );
    expect(insert.mock.calls[0][0]).toMatchObject({
      usps: ["Affordable, transparent pricing", "25-year warranty"],
      offers: ["Free site survey, no obligation"],
    });
  });

  it("surfaces a database error instead of claiming success", async () => {
    single.mockResolvedValue({ data: null, error: { message: "duplicate key" } });
    const { saveBusiness } = await import("@/app/(app)/brand/actions");
    const res = await saveBusiness({ ok: false }, form({ name: "Acme" }));
    expect(res).toEqual({ ok: false, error: "duplicate key" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("refreshes every page that renders brand data", async () => {
    const { saveBusiness } = await import("@/app/(app)/brand/actions");
    await saveBusiness({ ok: false }, form({ name: "Acme" }));
    const paths = revalidatePath.mock.calls.map(([p]) => p);
    expect(paths).toEqual(
      expect.arrayContaining(["/brand", "/dashboard", "/studio"]),
    );
  });
});

describe("saveInstruction", () => {
  const base = {
    businessId: "b1",
    title: "Tone rules",
    content: "Be warm.",
    isActive: true,
  };

  it("refuses to save when signed out", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const { saveInstruction } = await import("@/app/(app)/brand/instruction-actions");
    await expect(saveInstruction(base)).resolves.toEqual({
      ok: false,
      error: "Not authenticated.",
    });
  });

  it("requires a title", async () => {
    const { saveInstruction } = await import("@/app/(app)/brand/instruction-actions");
    await expect(saveInstruction({ ...base, title: "  " })).resolves.toEqual({
      ok: false,
      error: "Title is required.",
    });
  });

  it("creates an instruction and records why", async () => {
    const { saveInstruction } = await import("@/app/(app)/brand/instruction-actions");
    const res = await saveInstruction(base);
    expect(res.ok).toBe(true);
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ business_id: "b1", title: "Tone rules", is_active: true }),
    );
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "instruction.create", reason: "Tone rules" }),
    );
  });

  it("updates an existing instruction", async () => {
    const { saveInstruction } = await import("@/app/(app)/brand/instruction-actions");
    await saveInstruction({ ...base, id: "i1" });
    expect(update).toHaveBeenCalled();
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "instruction.update" }),
    );
  });
});

describe("studio actions", () => {
  it("approves a creative and logs it against its business", async () => {
    const { setCreativeStatus } = await import("@/app/(app)/studio/actions");
    const res = await setCreativeStatus("c1", "approved");
    expect(res.ok).toBe(true);
    expect(update).toHaveBeenCalledWith({ status: "approved" });
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "creative.approve",
        businessId: "b1",
        entityId: "c1",
      }),
    );
  });

  it("unapproves with the matching audit action", async () => {
    const { setCreativeStatus } = await import("@/app/(app)/studio/actions");
    await setCreativeStatus("c1", "draft");
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "creative.unapprove" }),
    );
  });

  it("reports a failed status change and skips the audit entry", async () => {
    updateResult = { error: { message: "permission denied" } };
    const { setCreativeStatus } = await import("@/app/(app)/studio/actions");
    await expect(setCreativeStatus("c1", "approved")).resolves.toEqual({
      ok: false,
      error: "permission denied",
    });
    expect(logEvent).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("deletes a creative and refreshes the studio", async () => {
    const { deleteCreative } = await import("@/app/(app)/studio/actions");
    const res = await deleteCreative("c1");
    expect(res.ok).toBe(true);
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "creative.delete" }),
    );
    expect(revalidatePath.mock.calls.map(([p]) => p)).toEqual(
      expect.arrayContaining(["/studio", "/dashboard"]),
    );
  });

  it("reports a delete failure without revalidating", async () => {
    del.mockResolvedValue({ error: { message: "row locked" } });
    const { deleteCreative } = await import("@/app/(app)/studio/actions");
    await expect(deleteCreative("c1")).resolves.toEqual({
      ok: false,
      error: "row locked",
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
