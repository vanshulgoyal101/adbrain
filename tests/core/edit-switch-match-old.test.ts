import { afterEach, describe, expect, it, vi } from "vitest";
import dailyTape from "./fixtures/meta/edit-audience-match-old-daily.json";
import lifetimeTape from "./fixtures/meta/edit-audience-match-old-lifetime.json";
import { MetaClient } from "@/lib/meta/client";

// #1479: Graph answers recorded by scripts/record-meta-edit-audience.ts (match-old) on a PAUSED instant-form test
// campaign (deleted afterwards, ₹0, nothing turned on). The old ad set's budget and end date changed while its PAUSED
// copy waited; the switch (paused campaign) writes them onto the copy (#1146), reads them back, then archives the old one.
// - daily:    A ₹200/day → ₹250/day with an end date; copy B still ₹200/day with none
// - lifetime: capped C ₹5,000 → ₹6,000 and a day later; copy D still ₹5,000 and the old end date

type Exchange = { method: string; path: string; form?: Record<string, string> | null; status: number; body: unknown };
type Sent = { method: string; path: string; form: Record<string, string> };

const creds = { adAccountId: "act_9000000000000001", pageId: "900000000000002", accessToken: "test-token" };
const CAMPAIGN = "900000000000000005";
const DAILY = { from: "900000000000000006", to: "900000000000000003", ads: ["900000000000000004"] };
const LIFETIME = { from: "900000000000000009", to: "900000000000000007", ads: ["900000000000000008"] };

function replay(tape: Exchange[]) {
  const pending = [...tape];
  const sent: Sent[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    url.searchParams.delete("access_token");
    const method = init?.method ?? "GET";
    const path = url.pathname.replace("/v26.0/", "") + url.search;
    const form = init?.body instanceof URLSearchParams ? Object.fromEntries([...init.body].filter(([key]) => key !== "access_token")) : {};
    sent.push({ method, path, form });
    const index = pending.findIndex(exchange => exchange.method === method && exchange.path === path);
    if (index < 0) throw new Error(`Unrecorded Graph call: ${method} ${path}`);
    const [exchange] = pending.splice(index, 1);
    return Response.json(exchange.body, { status: exchange.status });
  });
  return { pending, sent };
}

const posts = (calls: Array<{ method: string; path: string; form?: Record<string, string> | null }>) =>
  calls.filter(call => call.method === "POST").map(call => ({ path: call.path, form: call.form }));

afterEach(() => vi.restoreAllMocks());

describe("core: a new-audience copy takes the old ad set's money as it is now (#1146, recorded #1479)", () => {
  it("writes the old ad set's changed daily budget and end date onto the copy, reads them back, then archives the old one", async () => {
    const { pending, sent } = replay(dailyTape as Exchange[]);
    const result = await new MetaClient(creds).switchAdSet(CAMPAIGN, { fromAdSetId: DAILY.from, toAdSetId: DAILY.to, toAdIds: DAILY.ads, running: false });
    expect(result).toEqual({ fromAdSetId: DAILY.from, adSetId: DAILY.to, adIds: DAILY.ads });
    expect(pending).toEqual([]);
    // Exactly the writes Meta accepted, in order: nothing is turned on and no lifetime budget appears.
    expect(posts(sent)).toEqual(posts(dailyTape as Exchange[]));
    expect(posts(sent)).toEqual([
      { path: DAILY.to, form: { daily_budget: "25000", end_time: "2026-11-09T19:10:50+0530" } },
      { path: DAILY.from, form: { status: "ARCHIVED" } },
    ]);
  });

  it("gives a capped copy what the old ad set has left of its raised total and its later end date", async () => {
    const { pending, sent } = replay(lifetimeTape as Exchange[]);
    const result = await new MetaClient(creds).switchAdSet(CAMPAIGN, { fromAdSetId: LIFETIME.from, toAdSetId: LIFETIME.to, toAdIds: LIFETIME.ads, running: false });
    expect(result).toEqual({ fromAdSetId: LIFETIME.from, adSetId: LIFETIME.to, adIds: LIFETIME.ads });
    expect(pending).toEqual([]);
    expect(posts(sent)).toEqual(posts(lifetimeTape as Exchange[]));
    expect(posts(sent)).toEqual([
      { path: LIFETIME.to, form: { lifetime_budget: "600000", end_time: "2026-11-10T19:13:18+0530" } },
      { path: LIFETIME.from, form: { status: "ARCHIVED" } },
    ]);
    // The capped run's remaining total is read again just before the write (it may have spent while the copy waited).
    expect(sent.filter(call => call.method === "GET" && call.path.startsWith(`${LIFETIME.from}?`))).toHaveLength(2);
  });

  it("stops, keeping the old ad set, when Meta's read-back doesn't show the copy's new budget", async () => {
    const tape = structuredClone(dailyTape) as Exchange[];
    const readBack = tape.findLast(exchange => exchange.method === "GET" && exchange.path.startsWith(`${DAILY.to}?`))!;
    (readBack.body as Record<string, string>).daily_budget = "20000";
    const { sent } = replay(tape);
    await expect(new MetaClient(creds).switchAdSet(CAMPAIGN, { fromAdSetId: DAILY.from, toAdSetId: DAILY.to, toAdIds: DAILY.ads, running: false }))
      .rejects.toThrow("did not confirm the new ad set's budget");
    expect(sent.some(call => call.method === "POST" && call.form.status === "ARCHIVED")).toBe(false);
  });
});
