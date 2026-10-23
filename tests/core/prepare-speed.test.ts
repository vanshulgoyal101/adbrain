import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import geoTape from "./fixtures/meta/geo-tricity.json";
import prepareTape from "./fixtures/meta/prepare.json";

// geo-tricity.json: real Graph geo searches recorded read-only from Solaride's account on
// 2026-10-23 with the previous one-at-a-time resolver (paging links, which embed the token,
// were dropped). prepare.json: the recorded Solaride Page token and lead-form reads (#271).
import { MetaClient } from "@/lib/meta/client";
import { cachedLeadForms, resetLeadFormCache } from "@/lib/meta/lead-form-cache";
import type { ConnectionDTO } from "@/lib/meta/connect-contracts";

type Exchange = { method: string; path: string; status: number; body: unknown };

const creds = { adAccountId: "act_2398686420592052", pageId: "885223068001054", accessToken: "test-token" };

function replay(tape: Exchange[]) {
  const sent: string[] = [];
  let inFlight = 0;
  const peak = { inFlight: 0 };
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    url.searchParams.delete("access_token");
    const call = `${init?.method ?? "GET"} ${url.pathname.replace("/v21.0/", "")}${url.search}`;
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
});
