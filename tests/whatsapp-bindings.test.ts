import { beforeEach, describe, expect, it, vi } from "vitest";
import { whatsappNumberForBusiness } from "@/lib/meta/whatsapp-bindings";
import type { MetaClient } from "@/lib/meta/client";

const db = vi.hoisted(() => ({ bound: [] as string[], managed: false, upserts: [] as unknown[] }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => table === "whatsapp_number_bindings"
          ? Promise.resolve({ data: db.bound.map((phone_e164) => ({ phone_e164 })), error: null })
          : { maybeSingle: async () => ({ data: db.managed ? { business_id: "b" } : null, error: null }) },
      }),
      upsert: async (row: unknown) => { db.upserts.push(row); return { error: null }; },
    }),
  }),
}));

const page = "+919999991111", own = "+919999990874", other = "+919999994842";
// The client's own rule: the Page's number, or a requested number that is in `bound` and on the ad account business's WABAs.
const meta = {
  getWhatsAppNumber: async (requested: string | null, bound: readonly string[] = []) => {
    if (!requested || requested === page) return page;
    return [own, other].includes(requested) && bound.includes(requested) ? requested : null;
  },
  whatsappNumbers: async () => ({ page, business: [own, other] }),
} as unknown as MetaClient;

beforeEach(() => { db.bound = []; db.managed = false; db.upserts = []; });

describe("WhatsApp number bindings (#253)", () => {
  it("passes the Page's own number and already-bound numbers without writing", async () => {
    expect(await whatsappNumberForBusiness("b", meta, page)).toBe(page);
    db.bound = [own];
    expect(await whatsappNumberForBusiness("b", meta, own)).toBe(own);
    expect(db.upserts).toEqual([]);
  });

  it("binds the owner's chosen number from their own Meta business on first use", async () => {
    expect(await whatsappNumberForBusiness("b", meta, own)).toBe(own);
    expect(db.upserts).toEqual([{ business_id: "b", phone_e164: own, source: "owner_pick" }]);
  });

  it("never binds by pick for a managed (2-Tier) business: the parent's WABAs hold other customers' numbers", async () => {
    db.managed = true;
    expect(await whatsappNumberForBusiness("b", meta, other)).toBeNull();
    expect(db.upserts).toEqual([]);
  });

  it("refuses a number that isn't on the ad account business's WABAs", async () => {
    expect(await whatsappNumberForBusiness("b", meta, "+919876543210")).toBeNull();
    expect(db.upserts).toEqual([]);
  });
});
