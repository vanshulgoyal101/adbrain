import { describe, expect, it, vi } from "vitest";
import { hasCurrentMediaConsent, MEDIA_TERMS_VERSION, needsPeopleConsent, recordMediaConsent } from "@/lib/media/consent";

// #784: the rights gate for the owner's own photos and videos (append-only `media_consents`).
type Row = { terms_version: string; people_confirmed: boolean; confirmed_at?: string; user_id?: string | null };
function store(rows: Row[], error: unknown = null, business: { transferred_at: string | null; owner_id?: string } | null = { transferred_at: null }) {
  const filters: string[] = [];
  const rpc = vi.fn(async () => ({ data: null, error: null as unknown }));
  const consents = {
    select: () => consents,
    eq: (key: string, value: string) => { filters.push(`${key}=${value}`); return consents; },
    order: () => consents,
    limit: async () => ({ data: rows.filter((row) => row.terms_version === MEDIA_TERMS_VERSION).map((row) => ({ confirmed_at: "2026-11-01T00:00:00Z", user_id: "owner-1", ...row })), error }),
  };
  const businesses = { select: () => businesses, eq: () => businesses, maybeSingle: async () => ({ data: business ? { owner_id: "owner-1", ...business } : null, error: null }) };
  return { database: { from: (table: string) => table === "businesses" ? businesses : consents, rpc } as never, filters, rpc };
}

describe("media consent (#784)", () => {
  it("asks clinics, salons and coaching about the people shown; solar and shops don't", () => {
    for (const vertical of ["chiropractic clinic", "dental clinic", "Bridal makeup salon", "IELTS coaching institute", "Yoga studio"]) expect(needsPeopleConsent(vertical), vertical).toBe(true);
    for (const vertical of ["solar energy", "pest control", "bakery", null]) expect(needsPeopleConsent(vertical), String(vertical)).toBe(false);
  });

  it("passes only on the current terms, with the people clause where it's needed", async () => {
    expect(await hasCurrentMediaConsent(store([]).database, { id: "b1", vertical: "solar energy" })).toBe(false);
    expect(await hasCurrentMediaConsent(store([{ terms_version: "2026-01-01", people_confirmed: true }]).database, { id: "b1" })).toBe(false);
    expect(await hasCurrentMediaConsent(store([{ terms_version: MEDIA_TERMS_VERSION, people_confirmed: false }]).database, { id: "b1", vertical: "solar energy" })).toBe(true);
    expect(await hasCurrentMediaConsent(store([{ terms_version: MEDIA_TERMS_VERSION, people_confirmed: false }]).database, { id: "b1", vertical: "dental clinic" })).toBe(false);
    const { database, filters } = store([{ terms_version: MEDIA_TERMS_VERSION, people_confirmed: true }]);
    expect(await hasCurrentMediaConsent(database, { id: "b1", vertical: "dental clinic" })).toBe(true);
    expect(filters).toEqual(["business_id=b1", `terms_version=${MEDIA_TERMS_VERSION}`]);
    await expect(hasCurrentMediaConsent(store([], { message: "down" }).database, { id: "b1" })).rejects.toThrow("could not be checked");
  });

  it("a handed-over business needs its new owner's confirmation, not the rep's from before the transfer (#1670)", async () => {
    const rep = { terms_version: MEDIA_TERMS_VERSION, people_confirmed: false, confirmed_at: "2026-11-01T10:00:00Z" };
    expect(await hasCurrentMediaConsent(store([rep], null, { transferred_at: "2026-11-02T09:00:00Z" }).database, { id: "b1" })).toBe(false);
    expect(await hasCurrentMediaConsent(store([{ ...rep, confirmed_at: "2026-11-02T09:05:00Z" }], null, { transferred_at: "2026-11-02T09:00:00Z" }).database, { id: "b1" })).toBe(true);
    expect(await hasCurrentMediaConsent(store([rep], null, { transferred_at: null }).database, { id: "b1" })).toBe(true);
    await expect(hasCurrentMediaConsent(store([rep], null, null).database, { id: "b1" })).rejects.toThrow("could not be checked");
  });

  it("records through the owner-checked function, and refuses a missing tick before calling it", async () => {
    const { database, rpc } = store([]);
    await recordMediaConsent(database, { id: "b1", vertical: "dental clinic" }, { rights: true, people: true });
    expect(rpc).toHaveBeenCalledWith("media_consent_record", { p_business_id: "b1", p_terms_version: MEDIA_TERMS_VERSION, p_people_confirmed: true });
    await expect(recordMediaConsent(database, { id: "b1" }, { rights: false, people: false })).rejects.toMatchObject({ ownerKey: "mediaRightsRequired", status: 400 });
    await expect(recordMediaConsent(database, { id: "b1", vertical: "salon" }, { rights: true, people: false })).rejects.toMatchObject({ ownerKey: "mediaPeopleRequired", status: 400 });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("refuses a previous owner's racing confirmation even when its timestamp is after hand-over", async () => {
    const business = { owner_id: "new-owner", transferred_at: "2026-11-02T09:00:00Z" };
    const raced = { terms_version: MEDIA_TERMS_VERSION, people_confirmed: true, confirmed_at: "2026-11-02T09:00:01Z", user_id: "previous-owner" };
    expect(await hasCurrentMediaConsent(store([raced], null, business).database, { id: "b1" })).toBe(false);
    expect(await hasCurrentMediaConsent(store([{ ...raced, user_id: null }], null, business).database, { id: "b1" })).toBe(false);
    expect(await hasCurrentMediaConsent(store([{ ...raced, user_id: "new-owner" }], null, business).database, { id: "b1" })).toBe(true);
  });
});
