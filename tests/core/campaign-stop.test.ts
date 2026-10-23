import { afterEach, describe, expect, it, vi } from "vitest";
import stopTape from "./fixtures/meta/campaign-stop.json";

// Graph responses recorded read-only from two real paused Solaride campaigns by
// scripts/record-meta-stop-fixtures.ts (#221): one with every child PAUSED, one paused
// at campaign level only (children ACTIVE, effective CAMPAIGN_PAUSED), with ₹32.63 spend.
import { MetaClient } from "@/lib/meta/client";

type Exchange = { method: string; path: string; status: number; body: unknown };

const creds = { adAccountId: "act_2398686420592052", pageId: "885223068001054", accessToken: "test-token" };
const PAUSED_TREE = "120253256980050526";
const CAMPAIGN_PAUSED = "120240969992630526";

function replay(edit: (exchange: Exchange) => Exchange = exchange => exchange) {
  const pending = (structuredClone(stopTape) as Exchange[]).map(edit);
  const sent: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    url.searchParams.delete("access_token");
    const method = init?.method ?? "GET";
    const path = url.pathname.replace("/v21.0/", "") + url.search;
    sent.push(`${method} ${path}`);
    const index = pending.findIndex(exchange => exchange.method === method && exchange.path === path);
    if (index < 0) throw new Error(`Unrecorded Graph call: ${method} ${path}`);
    const [exchange] = pending.splice(index, 1);
    return Response.json(exchange.body, { status: exchange.status });
  });
  return { sent, pending };
}

function editChildren(campaignId: string, level: "adsets" | "ads", change: (child: Record<string, unknown>) => Record<string, unknown>) {
  return (exchange: Exchange): Exchange => exchange.path.startsWith(`${campaignId}/${level}?`)
    ? { ...exchange, body: { ...(exchange.body as object), data: (exchange.body as { data: Record<string, unknown>[] }).data.map(change) } }
    : exchange;
}

afterEach(() => vi.restoreAllMocks());

describe("core: Meta confirms a paused run has stopped before its spend settles (#221)", () => {
  it("confirms a tree paused at every level and one paused at campaign level, and reads its spend, with GETs only", async () => {
    const tape = replay();
    const meta = new MetaClient(creds);
    await expect(meta.readCampaignStopped(PAUSED_TREE)).resolves.toBe(true);
    await expect(meta.readLifetimeSpendPaise(PAUSED_TREE)).resolves.toBe(0);
    await expect(meta.readCampaignStopped(CAMPAIGN_PAUSED)).resolves.toBe(true);
    await expect(meta.readLifetimeSpendPaise(CAMPAIGN_PAUSED)).resolves.toBe(3263);
    expect(tape.pending).toEqual([]);
    expect(tape.sent.every(call => call.startsWith("GET "))).toBe(true);
  });

  it("does not confirm the stop while any ad set or ad can still deliver", async () => {
    replay(editChildren(CAMPAIGN_PAUSED, "ads", ad => ({ ...ad, effective_status: "ACTIVE" })));
    await expect(new MetaClient(creds).readCampaignStopped(CAMPAIGN_PAUSED)).resolves.toBe(false);
    vi.restoreAllMocks();
    replay(editChildren(PAUSED_TREE, "adsets", adSet => ({ ...adSet, status: "ACTIVE", effective_status: "ACTIVE" })));
    await expect(new MetaClient(creds).readCampaignStopped(PAUSED_TREE)).resolves.toBe(false);
    vi.restoreAllMocks();
    replay(exchange => exchange.path.startsWith(`${PAUSED_TREE}?fields=id%2Caccount_id%2Cstatus`)
      ? { ...exchange, body: { ...(exchange.body as object), status: "ACTIVE", effective_status: "ACTIVE" } } : exchange);
    await expect(new MetaClient(creds).readCampaignStopped(PAUSED_TREE)).resolves.toBe(false);
  });

  it("refuses another ad account's campaign or a partial child listing", async () => {
    replay();
    await expect(new MetaClient({ ...creds, adAccountId: "act_1" }).readCampaignStopped(PAUSED_TREE)).rejects.toThrow(/connected ad account/);
    vi.restoreAllMocks();
    replay(exchange => exchange.path.startsWith(`${PAUSED_TREE}/ads?`)
      ? { ...exchange, body: { ...(exchange.body as object), paging: { next: "https://graph.facebook.com/next" } } } : exchange);
    await expect(new MetaClient(creds).readCampaignStopped(PAUSED_TREE)).rejects.toThrow(/completely/);
  });
});
