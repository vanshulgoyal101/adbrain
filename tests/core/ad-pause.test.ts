import { afterEach, describe, expect, it, vi } from "vitest";
import recorded from "./fixtures/meta/ad-pause.json";
import { MetaClient } from "@/lib/meta/client";

// #1045: Meta's real answers for pausing one ad (scripts/record-meta-ad-pause.ts, scrubbed ids). The
// live ad was only validated (validate_only); the real write went to an ad that was already PAUSED.
type Exchange = { name: string; method: string; path: string; form: Record<string, string> | null; status: number; body: unknown };
const tape = recorded.tape as Exchange[];
const creds = { ...recorded.creds, accessToken: "core-token" };

function replay(name: string, edit: (exchange: Exchange) => Exchange = (exchange) => exchange) {
  const calls: { method: string; path: string; form: Record<string, string> | null }[] = [];
  const queue = tape.filter((exchange) => exchange.name === name).map(edit);
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    url.searchParams.delete("access_token");
    const method = init?.method ?? "GET";
    const path = url.pathname.replace(/^\/v\d+\.\d+\//, "") + url.search;
    const form = method === "POST" ? Object.fromEntries([...new URLSearchParams(String(init?.body))].filter(([key]) => key !== "access_token")) : null;
    calls.push({ method, path, form });
    const index = queue.findIndex((exchange) => exchange.method === method && exchange.path === path);
    if (index < 0) throw new Error(`Unrecorded Graph call: ${method} ${decodeURIComponent(path)}`);
    const [exchange] = queue.splice(index, 1);
    return Response.json(exchange.body, { status: exchange.status });
  });
  return calls;
}

afterEach(() => vi.restoreAllMocks());

describe("core: pause one ad (#1045)", () => {
  it("Meta accepts PAUSED on a live ad (validate_only), and AdBrain writes nothing else", async () => {
    const calls = replay("validate-pause-live-ad");
    const status = await new MetaClient(creds).setAdStatus(recorded.campaignId, recorded.liveAdId, "PAUSED", { validateOnly: true });
    expect(status).toEqual({ id: recorded.liveAdId, status: "ACTIVE", effectiveStatus: "ACTIVE", changed: false });
    const writes = calls.filter((call) => call.method === "POST");
    expect(writes).toEqual([{ method: "POST", path: recorded.liveAdId, form: { status: "PAUSED", execution_options: "[\"validate_only\"]" } }]);
  });

  it("writes nothing for an ad that is already PAUSED (the owner may have paused it in Meta), so it's never recorded", async () => {
    const calls = replay("pause-paused-ad");
    const status = await new MetaClient(creds).setAdStatus(recorded.campaignId, recorded.pausedAdId, "PAUSED");
    expect(status).toMatchObject({ status: "PAUSED", changed: false });
    expect(calls.some((call) => call.method === "POST")).toBe(false);
  });

  it("pauses a running ad and reads it back PAUSED; the only write is that ad's status", async () => {
    // The recorded write and read-back, with the ad's first read marked ACTIVE (as it is before a real pause).
    let first = true;
    const calls = replay("pause-paused-ad", (exchange) => {
      if (first && exchange.method === "GET" && exchange.path.startsWith(`${recorded.pausedAdId}?`)) { first = false; return { ...exchange, body: { ...(exchange.body as object), status: "ACTIVE", effective_status: "ACTIVE" } }; }
      return exchange;
    });
    const status = await new MetaClient(creds).setAdStatus(recorded.campaignId, recorded.pausedAdId, "PAUSED");
    expect(status).toMatchObject({ status: "PAUSED", changed: true });
    expect(calls.filter((call) => call.method === "POST")).toEqual([{ method: "POST", path: recorded.pausedAdId, form: { status: "PAUSED" } }]);
  });

  it("refuses an ad from another campaign before writing anything", async () => {
    const calls = replay("pause-paused-ad", (exchange) => exchange.path.startsWith(`${recorded.pausedAdId}?`)
      ? { ...exchange, body: { ...(exchange.body as object), campaign_id: "9999999999999999" } } : exchange);
    await expect(new MetaClient(creds).setAdStatus(recorded.campaignId, recorded.pausedAdId, "PAUSED")).rejects.toThrow("That ad isn't part of this campaign.");
    expect(calls.some((call) => call.method === "POST")).toBe(false);
  });
});
