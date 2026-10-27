import { afterEach, describe, expect, it, vi } from "vitest";
import spendTape from "./fixtures/meta/lifetime-spend.json";

// Graph responses recorded read-only from two real Solaride campaigns by
// scripts/record-meta-spend-fixtures.ts: one never delivered, one with ₹32.63 lifetime spend (#216).
import { MetaClient } from "@/lib/meta/client";
import { decodeLifetimeSpendPaise } from "@/lib/meta/insights";

type Exchange = { method: string; path: string; status: number; body: unknown };

const creds = { adAccountId: "act_9000000000000001", pageId: "900000000000002", accessToken: "test-token" };

function replay() {
  const pending = [...spendTape] as Exchange[];
  const sent: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    expect(url.origin + url.pathname.slice(0, 7)).toBe("https://graph.facebook.com/v21.0/");
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

afterEach(() => vi.restoreAllMocks());

describe("core: customer cost evidence reads Meta lifetime spend (#216)", () => {
  it("reads 0 for a campaign that never delivered and exact paise for one that spent, with GETs only", async () => {
    const tape = replay();
    const meta = new MetaClient(creds);
    await expect(meta.readLifetimeSpendPaise("120253646427440526")).resolves.toBe(0);
    await expect(meta.readLifetimeSpendPaise("120240969992630526")).resolves.toBe(3263);
    expect(tape.pending).toEqual([]);
    expect(tape.sent.every(call => call.startsWith("GET "))).toBe(true);
    expect(tape.sent).toContain("GET 120240969992630526/insights?fields=spend&date_preset=maximum");
  });

  it("refuses a campaign from another ad account before reading spend", async () => {
    replay();
    const meta = new MetaClient({ ...creds, adAccountId: "act_1" });
    await expect(meta.readLifetimeSpendPaise("120240969992630526")).rejects.toThrow(/connected ad account/);
  });

  it("never guesses spend from a partial or malformed response", () => {
    const recorded = (spendTape as Exchange[]).find(exchange => exchange.path.startsWith("120240969992630526/insights"))!.body as { data: object[] };
    expect(decodeLifetimeSpendPaise(recorded)).toBe(3263);
    expect(decodeLifetimeSpendPaise({ data: [{ spend: "1000" }] })).toBe(100000);
    expect(decodeLifetimeSpendPaise({ data: [{ spend: "0.5" }] })).toBe(50);
    for (const payload of [null, {}, { data: [{}] }, { data: [{ spend: "1.234" }] }, { data: [{ spend: "-1" }] },
      { data: [recorded.data[0], recorded.data[0]] }, { ...recorded, paging: { next: "https://graph.facebook.com/next" } }]) {
      expect(() => decodeLifetimeSpendPaise(payload)).toThrow();
    }
  });
});
