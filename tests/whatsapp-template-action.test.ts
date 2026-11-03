import { beforeEach, describe, expect, it, vi } from "vitest";

const locale = vi.hoisted(() => ({ value: undefined as string | undefined }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (name: string) => name === "adbrain_lang" && locale.value ? { value: locale.value } : undefined }) }));
const state = vi.hoisted(() => ({ user: { id: "owner-1" } as { id: string } | null, updates: [] as unknown[], business: { offers: ["Free solar site survey"], usps: [], description: "Rooftop solar", vertical: "solar energy" } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logEvent: vi.fn() }));
vi.mock("@/lib/observability/logger", () => ({ observeAction: (_name: string, run: () => unknown) => run() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: state.business, error: null }) }) }),
      update: (value: unknown) => { state.updates.push(value); return { eq: () => ({ select: () => ({ maybeSingle: async () => ({ data: { id: "b1" }, error: null }) }) }) }; },
    }),
  }),
}));
import { saveWhatsAppTemplate } from "@/app/(app)/brand/whatsapp-template-actions";

const solaride = { greeting: "Hi! Thanks for messaging Solaride. This is your first step in getting free electricity.", opening: { kind: "prefill", prefill: "Can I get more info on this", callButton: true }, language: "en" };
beforeEach(() => { state.user = { id: "owner-1" }; state.updates = []; locale.value = undefined; });

describe("saveWhatsAppTemplate (#840)", () => {
  it("saves Solaride's message and clears it on reset", async () => {
    expect(await saveWhatsAppTemplate({ businessId: "b1", template: solaride })).toEqual({ ok: true });
    expect(await saveWhatsAppTemplate({ businessId: "b1", template: null })).toEqual({ ok: true });
    expect(state.updates).toEqual([{ whatsapp_template: solaride }, { whatsapp_template: null }]);
  });

  it("blocks a guaranteed subsidy in the welcome or a question, and links or numbers in questions", async () => {
    const welcome = await saveWhatsAppTemplate({ businessId: "b1", template: { ...solaride, greeting: "Guaranteed subsidy on every rooftop!" } });
    expect(welcome).toMatchObject({ ok: false, field: "greeting" });
    const question = await saveWhatsAppTemplate({ businessId: "b1", template: { ...solaride, opening: { kind: "ice_breakers", questions: ["Guaranteed subsidy?"] } } });
    expect(question).toMatchObject({ ok: false, field: "questions" });
    expect(await saveWhatsAppTemplate({ businessId: "b1", template: { ...solaride, opening: { kind: "ice_breakers", questions: ["Call +91 98765 43210"] } } })).toMatchObject({ ok: false, field: "questions", error: expect.stringContaining("links or phone numbers") });
    expect(await saveWhatsAppTemplate({ businessId: "b1", template: { ...solaride, opening: { kind: "ice_breakers", questions: ["x".repeat(41)] } } })).toMatchObject({ ok: false, field: "questions" });
    expect(state.updates).toEqual([]);
  });

  it("needs a signed-in owner", async () => {
    state.user = null;
    expect(await saveWhatsAppTemplate({ businessId: "b1", template: solaride })).toMatchObject({ ok: false });
    expect(state.updates).toEqual([]);
  });
});

describe("saveWhatsAppTemplate in the owner's language (#1438)", () => {
  it("says its own refusals in Hindi and keeps them English by default", async () => {
    const tooLong = { ...solaride, opening: { kind: "ice_breakers", questions: ["x".repeat(41)] } };
    expect(await saveWhatsAppTemplate({ businessId: "b1", template: tooLong })).toEqual({ ok: false, field: "questions", error: "Use 1 to 3 different questions of up to 40 characters." });
    locale.value = "hi";
    expect(await saveWhatsAppTemplate({ businessId: "b1", template: tooLong })).toEqual({ ok: false, field: "questions", error: "1 से 3 अलग-अलग सवाल लिखें, हर सवाल 40 अक्षरों तक।" });
    state.user = null;
    expect(await saveWhatsAppTemplate({ businessId: "b1", template: solaride })).toEqual({ ok: false, error: "सेव करने के लिए फिर से साइन इन करें।" });
  });
});
