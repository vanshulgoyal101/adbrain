import { afterEach, describe, expect, it, vi } from "vitest";
import tape from "./fixtures/meta/account-funding-live-runs.json";
import { MetaClient } from "@/lib/meta/client";
import { committedWords, freeRoomPaise, fundingShortfall } from "@/lib/campaign/funding-check";

// #1058/#1094: Solaride's real account, recorded read-only by `scripts/record-meta-funding-fixtures.ts --live-runs`
// (Oct 27, 18:00Z) while the lever-2 WhatsApp arm ran with its total limit raised to ₹450: Meta's room was
// ₹584.87, but ₹450 of it was already promised to that run, so a new ₹250 run must not pass.
type Exchange = { method: string; path: string; status: number; body: Record<string, unknown> };
const recorded = tape.tape as Exchange[];
// The tape is scrubbed (#1094, QA): its ids, the ad account's included, are stable fakes.
const creds = { adAccountId: tape.adAccountId, pageId: "900000000000000099", accessToken: "test-token" };
const adSetsBody = recorded[1].body as { data: Array<Record<string, string>> };

function replay(adSets: Record<string, unknown> = adSetsBody) {
  const sent: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    url.searchParams.delete("access_token");
    const call = `${init?.method ?? "GET"} ${url.pathname.replace("/v26.0/", "")}${url.search}`;
    sent.push(call);
    const exchange = recorded.find(item => call === `GET ${item.path}`);
    if (!exchange) throw new Error(`Unrecorded Graph call: ${call}`);
    return Response.json(exchange === recorded[1] ? adSets : exchange.body, { status: exchange.status });
  });
  return sent;
}

async function read(adSets?: Record<string, unknown>) {
  const meta = new MetaClient(creds);
  replay(adSets);
  const [funding, committed] = await Promise.all([meta.readAccountFunding(), meta.readLiveCappedRuns()]);
  return { ...funding, committed };
}

afterEach(() => vi.restoreAllMocks());

describe("core: activation funding counts the account's other live capped runs (#1058)", () => {
  it("reads the running capped runs' remaining budget with one read-only GET", async () => {
    const sent = replay();
    await expect(new MetaClient(creds).readLiveCappedRuns()).resolves.toEqual({ runs: 1, remainingPaise: 45_000, uncapped: { adSets: 0, dailyPaise: 0 } });
    expect(sent).toEqual([`GET ${recorded[1].path}`]);
    expect(decodeURIComponent(sent[0])).toContain('effective_status=["ACTIVE","IN_PROCESS","WITH_ISSUES"]');
  });

  it("refuses a new ₹250 run that Meta's room alone would let through, and says why", async () => {
    const account = await read();
    expect(account.roomPaise).toBe(58_487);
    expect(freeRoomPaise(account)).toBe(13_487);
    const short = fundingShortfall({ mode: "operator", neededPaise: 25_000, account });
    expect(short).toEqual({ kind: "short", roomPaise: 13_487, neededPaise: 25_000, committed: { runs: 1, remainingPaise: 45_000, uncapped: { adSets: 0, dailyPaise: 0 } } });
    expect(committedWords(short?.kind === "short" ? short.committed : undefined)).toBe(" after ₹450 for your 1 other live run");
    // Before #1058 the same reads passed: ₹584.87 ≥ ₹250.
    expect(fundingShortfall({ mode: "operator", neededPaise: 25_000, account: { ...account, committed: undefined } })).toBeNull();
  });

  it("lets the run through when the other runs leave room, counting only what they can still spend", async () => {
    const [whatsapp] = adSetsBody.data;
    const account = await read({ ...adSetsBody, data: [{ ...whatsapp, budget_remaining: "4000" }, { id: "900000000000000003", effective_status: "ACTIVE", lifetime_budget: "25000", budget_remaining: "25000", daily_budget: "0" }] });
    expect(account.committed).toEqual({ runs: 2, remainingPaise: 29_000, uncapped: { adSets: 0, dailyPaise: 0 } });
    expect(fundingShortfall({ mode: "own", neededPaise: 25_000, account })).toBeNull();
    expect(committedWords(account.committed)).toBe(" after ₹290 for your 2 other live runs");
  });

  // #1094: raising this run's own cap leaves its ad set out; its unspent cap is part of what the raise needs.
  it("leaves out the ad sets being edited", async () => {
    replay();
    await expect(new MetaClient(creds).readLiveCappedRuns([adSetsBody.data[0].id])).resolves.toEqual({ runs: 0, remainingPaise: 0, uncapped: { adSets: 0, dailyPaise: 0 } });
  });

  // QA on #1083: an ad set Meta is still processing (right after a launch or a raise) or has flagged keeps its budget.
  it("counts ad sets Meta is processing or has flagged, and only states that can still spend", async () => {
    const sent = replay({ ...adSetsBody, data: [
      ...adSetsBody.data,
      { id: "900000000000000004", effective_status: "IN_PROCESS", lifetime_budget: "25000", budget_remaining: "25000", daily_budget: "0" },
      { id: "900000000000000005", effective_status: "WITH_ISSUES", lifetime_budget: "10000", budget_remaining: "6000", daily_budget: "0" },
      { id: "900000000000000006", effective_status: "PAUSED", lifetime_budget: "90000", budget_remaining: "90000", daily_budget: "0" },
    ] });
    await expect(new MetaClient(creds).readLiveCappedRuns()).resolves.toEqual({ runs: 3, remainingPaise: 76_000, uncapped: { adSets: 0, dailyPaise: 0 } });
    expect(decodeURIComponent(sent[0])).toContain('effective_status=["ACTIVE","IN_PROCESS","WITH_ISSUES"]');
  });

  it("names daily-budget ad sets without subtracting them, and says nothing with no other live ad set", async () => {
    const account = await read({ ...adSetsBody, data: [{ id: "1", effective_status: "ACTIVE", lifetime_budget: "0", budget_remaining: "0", daily_budget: "20000" }, { id: "2", effective_status: "ACTIVE" }] });
    expect(account.committed).toEqual({ runs: 0, remainingPaise: 0, uncapped: { adSets: 1, dailyPaise: 20_000 } });
    expect(freeRoomPaise(account)).toBe(58_487);
    expect(committedWords(account.committed)).toBe(" (₹200 a day also runs on 1 uncapped ad set)");
    expect(committedWords({ runs: 0, remainingPaise: 0, uncapped: { adSets: 0, dailyPaise: 0 } })).toBe("");
  });

  it("fails closed on a listing it can't verify", async () => {
    for (const adSets of [
      { ...adSetsBody, paging: { next: "https://graph.facebook.com/v26.0/next" } },
      { ...adSetsBody, data: [{ ...adSetsBody.data[0], budget_remaining: "12.5" }] },
      { ...adSetsBody, data: [{ ...adSetsBody.data[0], daily_budget: "-1" }] },
      { ...adSetsBody, data: [{ lifetime_budget: "25000", budget_remaining: "25000" }] },
      { paging: {} },
    ]) {
      replay(adSets);
      await expect(new MetaClient(creds).readLiveCappedRuns()).rejects.toThrow(/funding could not be verified/);
      vi.restoreAllMocks();
    }
  });
});
