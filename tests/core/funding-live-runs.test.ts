import { afterEach, describe, expect, it, vi } from "vitest";
import tape from "./fixtures/meta/account-funding-live-runs.json";
import { MetaClient } from "@/lib/meta/client";
import { committedWords, freeRoomPaise, fundingShortfall } from "@/lib/campaign/funding-check";

// #1058: Solaride's real account, recorded read-only by `scripts/record-meta-funding-fixtures.ts --live-runs`
// (Oct 27, 17:20Z) while both lever-2 arms ran with ₹250 total limits: Meta's room was ₹584.87, but ₹500 of it
// was already promised to those runs, so a third ₹250 run must not pass.
type Exchange = { method: string; path: string; status: number; body: Record<string, unknown> };
const recorded = tape as Exchange[];
const creds = { adAccountId: "act_2398686420592052", pageId: "885223068001054", accessToken: "test-token" };
const adSetsBody = recorded[1].body as { data: Array<Record<string, string>> };

function replay(adSets: Record<string, unknown> = adSetsBody) {
  const sent: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    url.searchParams.delete("access_token");
    const call = `${init?.method ?? "GET"} ${url.pathname.replace("/v21.0/", "")}${url.search}`;
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
    await expect(new MetaClient(creds).readLiveCappedRuns()).resolves.toEqual({ runs: 2, remainingPaise: 50_000 });
    expect(sent).toEqual([`GET ${recorded[1].path}`]);
    expect(sent[0]).toContain("effective_status=%5B%22ACTIVE%22%5D");
  });

  it("refuses a third ₹250 run that Meta's room alone would let through, and says why", async () => {
    const account = await read();
    expect(account.roomPaise).toBe(58_487);
    expect(freeRoomPaise(account)).toBe(8_487);
    const short = fundingShortfall({ mode: "operator", neededPaise: 25_000, account });
    expect(short).toEqual({ kind: "short", roomPaise: 8_487, neededPaise: 25_000, committed: { runs: 2, remainingPaise: 50_000 } });
    expect(committedWords(short?.kind === "short" ? short.committed : undefined)).toBe(" after ₹500.00 for your 2 other live runs");
    // Before #1058 the same reads passed: ₹584.87 ≥ ₹250.
    expect(fundingShortfall({ mode: "operator", neededPaise: 25_000, account: { ...account, committed: undefined } })).toBeNull();
  });

  it("lets the run through when the other runs leave room, counting only what they can still spend", async () => {
    const [first, second] = adSetsBody.data;
    const account = await read({ ...adSetsBody, data: [{ ...first, budget_remaining: "4000" }, second] });
    expect(account.committed).toEqual({ runs: 2, remainingPaise: 29_000 });
    expect(fundingShortfall({ mode: "own", neededPaise: 25_000, account })).toBeNull();
    expect(committedWords(account.committed)).toBe(" after ₹290.00 for your 2 other live runs");
  });

  it("ignores daily-budget ad sets and says nothing with no other live run", async () => {
    const account = await read({ ...adSetsBody, data: [{ id: "1", lifetime_budget: "0", budget_remaining: "0" }, { id: "2" }] });
    expect(account.committed).toEqual({ runs: 0, remainingPaise: 0 });
    expect(freeRoomPaise(account)).toBe(58_487);
    expect(committedWords(account.committed)).toBe("");
  });

  it("fails closed on a listing it can't verify", async () => {
    for (const adSets of [
      { ...adSetsBody, paging: { next: "https://graph.facebook.com/v21.0/next" } },
      { ...adSetsBody, data: [{ ...adSetsBody.data[0], budget_remaining: "12.5" }] },
      { ...adSetsBody, data: [{ lifetime_budget: "25000", budget_remaining: "25000" }] },
      { paging: {} },
    ]) {
      replay(adSets);
      await expect(new MetaClient(creds).readLiveCappedRuns()).rejects.toThrow(/funding could not be verified/);
      vi.restoreAllMocks();
    }
  });
});
