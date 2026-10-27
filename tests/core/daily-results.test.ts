import { afterEach, describe, expect, it, vi } from "vitest";
import recorded from "./fixtures/meta/daily-results.json";
import { MetaClient } from "@/lib/meta/client";
import { adResultViews, saveAdResults, type StoredAdResult } from "@/lib/campaign/ad-results-store";
import { dailyResultsParams, dailyTotals, inDailyWindow, istYesterday } from "@/lib/alerts/daily-results";
import { deliverOwnerAlert, ownerAlertsConfig, type AlertStore } from "@/lib/alerts/sender";
import type { AdResult } from "@/lib/meta/insights";

// #1022: daily-results.json is Meta's real one-day per-ad read (Oct 26, IST) of Solaride's live
// English run, recorded by scripts/record-meta-daily-results.ts (GETs only, tokens dropped).
const creds = { adAccountId: "act_2398686420592052", pageId: "885223068001054", accessToken: "core-token" };

function replay() {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    expect(init?.method ?? "GET").toBe("GET");
    const url = new URL(String(input));
    url.searchParams.delete("access_token");
    const path = url.pathname.replace(/^\/v\d+\.\d+\//, "") + url.search;
    const exchange = recorded.tape.find((entry) => entry.path === path);
    if (!exchange) throw new Error(`Unrecorded Graph call: ${decodeURIComponent(path)}`);
    return Response.json(exchange.body, { status: exchange.status });
  });
}
const readDay = async () => { replay(); return new MetaClient(creds).getAdResults(recorded.campaignId, { day: recorded.day }); };

afterEach(() => vi.restoreAllMocks());

describe("core: the daily WhatsApp results line (#1022)", () => {
  it("reads one day of per-ad results from Meta and writes CPO's six parameters", async () => {
    const ads = await readDay();
    expect(ads).toHaveLength(6);
    const params = dailyResultsParams({ businessName: "Solaride", day: recorded.day, campaigns: [{ whatsapp: true, ads }] }, "en")!;
    const best = ads.find((ad) => ad.results === 1)!;
    expect(params).toEqual(["Solaride", "Mon 26 Oct", "112", "1", "₹112 each", `'${best.name}' (1 enquiry)`]);
    const hi = dailyResultsParams({ businessName: "Solaride", day: recorded.day, campaigns: [{ whatsapp: true, ads }] }, "hi")!;
    expect(hi[4]).toBe("₹112 प्रति पूछताछ");
    expect(hi[5]).toBe(`'${best.name}' (1 पूछताछ)`);
    for (const param of [...params, ...hi]) expect(param).not.toMatch(/[\n\t]/);
  });

  it("uses the same numbers as #783's per-ad card for that day", async () => {
    const ads = await readDay();
    const rows: StoredAdResult[] = [];
    await saveAdResults({ from: () => ({ upsert: async (values: Omit<StoredAdResult, "synced_at">[]) => { rows.push(...values.map((value) => ({ ...value, synced_at: "2026-10-27T03:30:00Z" }))); return { error: null }; } }) } as never,
      { businessId: "b1", campaignId: recorded.campaignId, ads });
    const card = adResultViews(rows, true).ads;
    const totals = dailyTotals([{ whatsapp: true, ads }]);
    expect(totals.enquiries).toBe(card.reduce((total, ad) => total + ad.results, 0));
    expect(totals.spend).toBeCloseTo(card.reduce((total, ad) => total + ad.spend, 0), 2);
  });

  it("takes yesterday in IST and sends only between 09:00 and 12:00 IST", () => {
    expect(istYesterday(new Date("2026-10-26T18:29:59Z"))).toBe("2026-10-25");
    expect(istYesterday(new Date("2026-10-26T18:30:00Z"))).toBe("2026-10-26");
    expect(istYesterday(new Date("2026-10-27T03:30:00Z"))).toBe("2026-10-26");
    expect(istYesterday(new Date("2026-11-01T00:00:00Z"))).toBe("2026-10-31");
    expect(inDailyWindow(new Date("2026-10-27T03:29:59Z"))).toBe(false);
    expect(inDailyWindow(new Date("2026-10-27T03:30:00Z"))).toBe(true);
    expect(inDailyWindow(new Date("2026-10-27T06:29:59Z"))).toBe(true);
    expect(inDailyWindow(new Date("2026-10-27T06:30:00Z"))).toBe(false);
  });

  it("with no enquiries says 'none yet' and names the ad with the most WhatsApp taps; an empty day sends nothing", async () => {
    const ads = (await readDay()).map((ad): AdResult => ({ ...ad, results: 0, costPerResult: null }));
    const params = dailyResultsParams({ businessName: "Solaride", day: recorded.day, campaigns: [{ whatsapp: true, ads }] }, "en")!;
    const most = [...ads].sort((left, right) => (right.whatsappOpens ?? 0) - (left.whatsappOpens ?? 0))[0];
    expect(params.slice(3)).toEqual(["0", "none yet", `'${most.name}' (${most.whatsappOpens} WhatsApp taps)`]);
    expect(dailyResultsParams({ businessName: "Solaride", day: recorded.day, campaigns: [{ whatsapp: true, ads }] }, "hi")![4]).toBe("अभी कोई नहीं");
    const idle = ads.map((ad) => ({ ...ad, spend: 0, whatsappOpens: 0, clicks: 0 }));
    expect(dailyResultsParams({ businessName: "Solaride", day: recorded.day, campaigns: [{ whatsapp: true, ads: idle }] }, "en")).toBeNull();
  });

  it("at the monthly cap the daily line is not sent (the claim refuses it; lead alerts are unaffected, see metadb)", async () => {
    const claim = vi.fn<AlertStore["claim"]>(async () => ({ claimed: false, reason: "cap" }));
    const settle = vi.fn<AlertStore["settle"]>();
    const fetchImpl = vi.fn<typeof fetch>();
    const config = ownerAlertsConfig({ OWNER_ALERTS_ENABLED: "true", ALERTS_WHATSAPP_PHONE_ID: "106540352242922", ALERTS_WHATSAPP_TOKEN: "t" });
    expect(await deliverOwnerAlert({ store: { claim, settle }, config, fetchImpl }, { businessId: "b1", kind: "daily", key: "2026-10-26", params: () => ["x"] }))
      .toEqual({ delivered: false, reason: "cap" });
    expect(claim).toHaveBeenCalledWith(expect.objectContaining({ kind: "daily", key: "2026-10-26", template: "adbrain_daily_results" }));
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
