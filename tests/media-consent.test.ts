import { describe, expect, it, vi } from "vitest";
import { hasCurrentMediaConsent, MEDIA_TERMS_VERSION, needsPeopleConsent, recordMediaConsent } from "@/lib/media/consent";

// #784: the rights gate for the owner's own photos and videos (append-only `media_consents`).
function store(rows: { terms_version: string; people_confirmed: boolean }[], error: unknown = null) {
  const filters: string[] = [];
  const rpc = vi.fn(async () => ({ data: null, error: null as unknown }));
  const query = {
    select: () => query,
    eq: (key: string, value: string) => { filters.push(`${key}=${value}`); return query; },
    order: () => query,
    limit: async () => ({ data: rows.filter((row) => row.terms_version === MEDIA_TERMS_VERSION), error }),
  };
  return { database: { from: () => query, rpc } as never, filters, rpc };
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

  it("records through the owner-checked function, and refuses a missing tick before calling it", async () => {
    const { database, rpc } = store([]);
    await recordMediaConsent(database, { id: "b1", vertical: "dental clinic" }, { rights: true, people: true });
    expect(rpc).toHaveBeenCalledWith("media_consent_record", { p_business_id: "b1", p_terms_version: MEDIA_TERMS_VERSION, p_people_confirmed: true });
    await expect(recordMediaConsent(database, { id: "b1" }, { rights: false, people: false })).rejects.toThrow("own these photos");
    await expect(recordMediaConsent(database, { id: "b1", vertical: "salon" }, { rights: true, people: false })).rejects.toThrow("everyone recognisable");
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
