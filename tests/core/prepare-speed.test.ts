import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import geoTape from "./fixtures/meta/geo-tricity.json";
import prepareTape from "./fixtures/meta/prepare.json";
import formTape from "./fixtures/meta/lead-form.json";

// geo-tricity.json: real Graph geo searches recorded read-only from Solaride's account on
// 2026-10-23 with the previous one-at-a-time resolver (paging links, which embed the token,
// were dropped). prepare.json: the recorded Solaride Page token and lead-form reads (#271).
import { MetaClient } from "@/lib/meta/client";
import { cachedLeadForms, resetLeadFormCache } from "@/lib/meta/lead-form-cache";
import type { ConnectionDTO } from "@/lib/meta/connect-contracts";

type Exchange = { method: string; path: string; status: number; body: unknown };

const creds = { adAccountId: "act_9000000000000001", pageId: "900000000000002", accessToken: "test-token" };

function replay(tape: Exchange[]) {
  const sent: string[] = [];
  let inFlight = 0;
  const peak = { inFlight: 0 };
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    url.searchParams.delete("access_token");
    const call = `${init?.method ?? "GET"} ${url.pathname.replace("/v26.0/", "")}${url.search}`;
    sent.push(call);
    const exchange = tape.find(entry => `${entry.method} ${entry.path}` === call);
    if (!exchange) throw new Error(`Unrecorded Graph call: ${call}`);
    peak.inFlight = Math.max(peak.inFlight, ++inFlight);
    await new Promise(resolve => setTimeout(resolve, 5));
    inFlight--;
    return Response.json(exchange.body, { status: exchange.status });
  });
  return { sent, peak };
}

afterEach(() => vi.restoreAllMocks());

describe("core: Prepare speed keeps every result (#271)", () => {
  it("searches all locations at once and resolves them exactly as the one-at-a-time resolver did", async () => {
    const { sent, peak } = replay(geoTape as Exchange[]);
    const geo = await new MetaClient(creds).resolveGeoTargeting(["Chandigarh", "Mohali", "Panchkula", "Zzqx Nowhereville"], { cityScope: "city_only", preferCountry: "IN" });
    expect(geo).toEqual({
      targeting: { cities: [{ key: "1021145" }, { key: "1035473" }, { key: "2676092" }] },
      matched: [
        { name: "Chandigarh", type: "city", key: "1021145", label: "Chandigarh, India, Chandigarh" },
        { name: "Mohali", type: "city", key: "1035473", label: "Mohali, India, Punjab region" },
        { name: "Panchkula", type: "city", key: "2676092", label: "Panchkula, India, Haryana" },
      ],
      unresolved: ["Zzqx Nowhereville"],
    });
    expect(sent).toHaveLength(4);
    expect(peak.inFlight).toBe(4);
  });

  describe("lead-form cache", () => {
    const connection = (overrides: Partial<ConnectionDTO> = {}) => ({
      businessId: "00000000-0000-4000-8000-0000000000b1", generation: 3,
      selected: { pageId: creds.pageId }, ...overrides,
    }) as ConnectionDTO;

    beforeEach(() => {
      resetLeadFormCache();
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-23T19:00:00Z"));
    });
    afterEach(() => vi.useRealTimers());

    it("serves a repeat read from cache for ten minutes per business, Page and connection", async () => {
      const { sent } = replay(prepareTape as Exchange[]);
      const formReads = () => sent.filter(call => call.includes("/leadgen_forms")).length;
      const meta = new MetaClient(creds);
      const first = await cachedLeadForms(meta, connection());
      expect(first.length).toBeGreaterThan(0);
      expect(formReads()).toBe(1);

      expect(await cachedLeadForms(meta, connection())).toEqual(first);
      expect(formReads()).toBe(1);

      await cachedLeadForms(meta, connection(), { fresh: true });
      await cachedLeadForms(meta, connection({ generation: 4 }));
      await cachedLeadForms(meta, connection({ businessId: "00000000-0000-4000-8000-0000000000b2" }));
      expect(formReads()).toBe(4);

      vi.setSystemTime(new Date("2026-10-23T19:10:01Z"));
      await cachedLeadForms(meta, connection());
      expect(formReads()).toBe(5);
      expect(sent.every(call => call.startsWith("GET "))).toBe(true);
    });
  });

  // lead-form.json: real single-object reads recorded 2026-10-24 (an active Solaride form, a
  // campaign ID, an unknown ID). Archived and other-Page cases edit the active body.
  describe("preflight form check reads one form fresh", () => {
    const ACTIVE = "2531491190682703";
    const objectPath = `${ACTIVE}?fields=id%2Cname%2Cstatus%2Cpage`;
    const withActiveBody = (edit: (body: Record<string, unknown>) => Record<string, unknown>) =>
      (formTape as Exchange[]).map(entry => entry.path === objectPath
        ? { ...entry, body: edit(entry.body as Record<string, unknown>) } : entry);

    it("accepts an active form on the connected Page with one object read, not the form list", async () => {
      const { sent } = replay(formTape as Exchange[]);
      const form = await new MetaClient(creds).readActiveLeadForm(ACTIVE);
      expect(form).toEqual({ id: ACTIVE, name: "Solaride | Free Survey | CHD-PKL | Homeowners | Sep 2026", status: "ACTIVE" });
      expect(sent).toEqual([`GET ${creds.pageId}?fields=access_token`, `GET ${objectPath}`]);
    });

    it("refuses an archived form and a form on another Page", async () => {
      replay(withActiveBody(body => ({ ...body, status: "ARCHIVED" })));
      expect(await new MetaClient(creds).readActiveLeadForm(ACTIVE)).toBeNull();
      vi.restoreAllMocks();
      replay(withActiveBody(body => ({ ...body, page: { id: "100000000000001", name: "Other" } })));
      expect(await new MetaClient(creds).readActiveLeadForm(ACTIVE)).toBeNull();
    });

    it("refuses objects that are not readable forms, and never calls Meta for a malformed ID", async () => {
      const { sent } = replay(formTape as Exchange[]);
      const meta = new MetaClient(creds);
      expect(await meta.readActiveLeadForm("120253678786150526")).toBeNull();
      expect(await meta.readActiveLeadForm("9999999999999999")).toBeNull();
      expect(await meta.readActiveLeadForm("123/leadgen_forms")).toBeNull();
      expect(sent.filter(call => !call.includes("access_token"))).toHaveLength(2);
    });
  });
});
