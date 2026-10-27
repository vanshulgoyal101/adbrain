import { afterEach, describe, expect, it, vi } from "vitest";
import fundingTape from "./fixtures/meta/account-funding.json";

// The Graph ad account read recorded read-only from Solaride's real account by
// scripts/record-meta-funding-fixtures.ts after the owner's ₹1,000 top-up (#245).
import { MetaClient } from "@/lib/meta/client";

type Exchange = { method: string; path: string; status: number; body: Record<string, unknown> };

const creds = { adAccountId: "act_9000000000000001", pageId: "900000000000002", accessToken: "test-token" };
const recorded = (fundingTape as Exchange[])[0];

function replay(body: Record<string, unknown> = recorded.body) {
  const sent: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    expect(url.origin + url.pathname.slice(0, 7)).toBe("https://graph.facebook.com/v21.0/");
    url.searchParams.delete("access_token");
    const call = `${init?.method ?? "GET"} ${url.pathname.replace("/v21.0/", "")}${url.search}`;
    sent.push(call);
    if (call !== `GET ${recorded.path}`) throw new Error(`Unrecorded Graph call: ${call}`);
    return Response.json(body, { status: recorded.status });
  });
  return sent;
}

afterEach(() => vi.restoreAllMocks());

describe("core: operator-funded activation reads Meta's account spending limit (#245)", () => {
  it("reads the spending limit and amount spent in exact paise, with one GET", async () => {
    const sent = replay();
    await expect(new MetaClient(creds).readAccountFunding()).resolves.toEqual({
      spendCapPaise: 88983, amountSpentPaise: 4237, roomPaise: 84746, prepay: true,
    });
    expect(sent).toEqual([`GET ${recorded.path}`]);
  });

  it("refuses an account read it cannot verify", async () => {
    for (const body of [
      { ...recorded.body, currency: "USD" },
      { ...recorded.body, id: "act_1" },
      { ...recorded.body, spend_cap: "88983.5" },
      { ...recorded.body, amount_spent: undefined },
    ]) {
      replay(body);
      await expect(new MetaClient(creds).readAccountFunding()).rejects.toThrow(/funding could not be verified/);
      vi.restoreAllMocks();
    }
  });

  it("reports no room when Meta has spent up to the limit, and 0 when no limit is set", async () => {
    replay({ ...recorded.body, amount_spent: "90000" });
    await expect(new MetaClient(creds).readAccountFunding()).resolves.toMatchObject({ roomPaise: 0 });
    vi.restoreAllMocks();
    replay({ ...recorded.body, spend_cap: undefined });
    await expect(new MetaClient(creds).readAccountFunding()).resolves.toMatchObject({ spendCapPaise: 0, roomPaise: 0 });
  });
});
