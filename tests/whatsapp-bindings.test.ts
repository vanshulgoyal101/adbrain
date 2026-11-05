import { beforeEach, describe, expect, it, vi } from "vitest";
import { boundWhatsAppNumbers, whatsappNumberForBusiness } from "@/lib/meta/whatsapp-bindings";
import type { MetaClient } from "@/lib/meta/client";

const db = vi.hoisted(() => ({ bound: [] as string[], sources: {} as Record<string, string>, managed: false, upserts: [] as unknown[] }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => table === "whatsapp_number_bindings"
          ? Promise.resolve({ data: db.bound.map((phone_e164) => ({ phone_e164, source: db.sources[phone_e164] ?? "owner_pick" })), error: null })
          : { maybeSingle: async () => ({ data: db.managed ? { business_id: "b" } : null, error: null }) },
      }),
      upsert: async (row: unknown) => { db.upserts.push(row); return { error: null }; },
    }),
  }),
}));

const page = "+919999991111", own = "+919999990874", other = "+919999994842";
// The client's candidate is still subject to the bindings enforced by whatsappNumberForBusiness.
const meta = {
  resolveWhatsAppNumberCandidate: async (requested: string | null) => {
    if (!requested || requested === page) return { number: page, source: "page" };
    return [own, other].includes(requested) ? { number: requested, source: "business" } : null;
  },
} as unknown as MetaClient;

beforeEach(() => { vi.restoreAllMocks(); db.bound = []; db.sources = {}; db.managed = false; db.upserts = []; });

describe("WhatsApp number bindings (#253)", () => {
  it("passes the Page's own number and already-bound numbers without writing", async () => {
    expect(await whatsappNumberForBusiness("b", meta, page)).toEqual({ number: page, source: "page" });
    db.bound = [own];
    expect(await whatsappNumberForBusiness("b", meta, own)).toEqual({ number: own, source: "business" });
    expect(db.upserts).toEqual([]);
  });

  it("resolves the selected source once without binding the Page's number", async () => {
    const resolve = vi.spyOn(meta, "resolveWhatsAppNumberCandidate");
    expect(await whatsappNumberForBusiness("b", meta, page, "page")).toEqual({ number: page, source: "page" });
    expect(resolve).toHaveBeenCalledOnce();
    expect(resolve).toHaveBeenCalledWith(page, "page");
    expect(db.upserts).toEqual([]);
  });

  it("binds the owner's chosen number from their own Meta business on first use", async () => {
    expect(await whatsappNumberForBusiness("b", meta, own)).toEqual({ number: own, source: "business" });
    expect(db.upserts).toEqual([{ business_id: "b", phone_e164: own, source: "owner_pick" }]);
  });

  it("never binds by pick for a managed (2-Tier) business: the parent's WABAs hold other customers' numbers", async () => {
    db.managed = true;
    expect(await whatsappNumberForBusiness("b", meta, other)).toBeNull();
    expect(db.upserts).toEqual([]);
  });

  it("only lets an embedded-signup binding authorize a managed business number, not an old owner pick or Page link", async () => {
    db.managed = true;
    db.bound = [own, other, page];
    db.sources = { [other]: "page_link", [page]: "embedded_signup" };
    expect(await whatsappNumberForBusiness("b", meta, own)).toBeNull();
    expect(await whatsappNumberForBusiness("b", meta, other)).toBeNull();
    expect(await boundWhatsAppNumbers("b")).toEqual([page]);
    expect(db.upserts).toEqual([]);
  });

  it("requires a fresh selection for a legacy masked number before making Meta or binding calls", async () => {
    const resolve = vi.spyOn(meta, "resolveWhatsAppNumberCandidate");
    expect(await whatsappNumberForBusiness("b", meta, "+91 ••••• 0874", "business")).toBeNull();
    expect(resolve).not.toHaveBeenCalled();
    expect(db.upserts).toEqual([]);
  });

  it("refuses a number that isn't on the ad account business's WABAs", async () => {
    expect(await whatsappNumberForBusiness("b", meta, "+919876543210")).toBeNull();
    expect(db.upserts).toEqual([]);
  });
});
