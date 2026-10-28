import { afterEach, describe, expect, it, vi } from "vitest";
import tape from "./fixtures/meta/managed-spend-cap.provisional.json";
import { requestBody } from "./replay";
import { MetaClient } from "@/lib/meta/client";
import { childSpendCap } from "@/lib/managed/spend-cap";
import { createAnnualPaymentQuote } from "@/lib/payments/allocation";

// #522: a managed customer's child ad account gets a Meta spending limit equal to the media their
// prepaid ad share buys. The Graph exchange is PROVISIONAL (documented shape, see the fixture);
// the decision and the client are real.
type Exchange = { method: string; path: string; form?: Record<string, string>; status: number; body: Record<string, unknown> };
const exchanges = tape.exchanges as Exchange[];
const creds = { adAccountId: tape.adAccountId, pageId: "900000000000002", accessToken: "test-token" };

function replay(readBack: Record<string, unknown> = exchanges[1].body) {
  const sent: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    url.searchParams.delete("access_token");
    const body = new URLSearchParams(requestBody(init));
    body.delete("access_token");
    const call = `${init?.method ?? "GET"} ${url.pathname.replace("/v21.0/", "")}${url.search}${body.size ? ` ${body}` : ""}`;
    sent.push(call);
    const match = exchanges.find((exchange) => call === `${exchange.method} ${exchange.path}${exchange.form ? ` ${new URLSearchParams(exchange.form)}` : ""}`);
    if (!match) throw new Error(`Unrecorded Graph call: ${call}`);
    return Response.json(match.method === "GET" ? readBack : match.body, { status: match.status });
  });
  return sent;
}

afterEach(() => vi.restoreAllMocks());

describe("core: a managed customer's ad account spending limit (#522)", () => {
  it("sets a ₹500 customer's child account limit to the media their ₹400 ad share buys, and reads it back", async () => {
    const quote = createAnnualPaymentQuote(50_000);
    const decision = childSpendCap({
      advertisingAllocationPaise: quote.metaAllocationPaise, advertisingRefundedPaise: 0, held: false, taxRateBps: 1800,
      mediaOnOtherAccountsPaise: 0, lifetimeMediaSpentPaise: 0, account: { spendCapPaise: 0, amountSpentPaise: 0 },
    });
    expect(decision).toEqual({ action: "set", capPaise: 33_898, roomPaise: 33_898 });
    if (decision.action !== "set") throw new Error("expected a limit to set");
    const sent = replay();
    await expect(new MetaClient(creds).setAccountSpendCap(decision.capPaise, decision.roomPaise)).resolves.toMatchObject({ spendCapPaise: 33_898, roomPaise: 33_898 });
    // Rupees on the write, paise on the read; never a spend_cap_action (reset or delete).
    expect(sent).toEqual([`POST ${tape.adAccountId} spend_cap=338.98`, exchanges[1].method + " " + exchanges[1].path]);
  });

  it("keeps campaigns paused when Meta reads back a different limit", async () => {
    replay({ ...exchanges[1].body, spend_cap: "33800" });
    await expect(new MetaClient(creds).setAccountSpendCap(33_898, 33_898)).rejects.toThrow(/spending limit changed/);
  });

  it("keeps campaigns paused when writing the limit restarted Meta's spent counter, leaving more room than allowed (QA)", async () => {
    // Spent 10,000 before the write; allowed room 23,898. If Meta now reads 0 spent, the room is 33,898.
    replay({ ...exchanges[1].body, spend_cap: "33898", amount_spent: "0" });
    await expect(new MetaClient(creds).setAccountSpendCap(33_898, 23_898)).rejects.toThrow(/more than the customer has left/);
  });

  it("never writes 0 or a fraction, which Meta would read as no limit or reject", async () => {
    const sent = replay();
    for (const cap of [0, -1, 338.98, Number.NaN]) await expect(new MetaClient(creds).setAccountSpendCap(cap, 0)).rejects.toThrow(/Invalid ad account spending limit/);
    await expect(new MetaClient(creds).setAccountSpendCap(33_898, -1)).rejects.toThrow(/Invalid ad account spending limit/);
    expect(sent).toEqual([]);
  });
});
