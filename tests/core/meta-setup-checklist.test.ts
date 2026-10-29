import { afterEach, describe, expect, it, vi } from "vitest";
import recorded from "./fixtures/meta/setup-checklist.json";
import { MetaClient } from "@/lib/meta/client";
import { setupChecklist, setupChecklistEnabled } from "@/lib/meta/setup-checklist";

// #1016 (#795 slice 1): setup-checklist.json holds the real GET answers on the internal Solaride
// account (scripts/record-meta-setup-checklist.ts; tokens dropped, ids replaced by stable fake ones,
// numbers cut to the last 4 digits).
type Exchange = { path: string; status: number; body: unknown };
const creds = { adAccountId: recorded.adAccountId, pageId: recorded.pageId, accessToken: "core-token" };

function replay(tape: Exchange[]) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    expect(init?.method ?? "GET").toBe("GET");
    const url = new URL(String(input));
    url.searchParams.delete("access_token");
    const path = decodeURIComponent(url.pathname.replace(/^\/v\d+\.\d+\//, "") + url.search);
    const exchange = tape.find((entry) => entry.path === path);
    if (!exchange) throw new Error(`Unrecorded Graph call: ${path}`);
    return Response.json(exchange.body, { status: exchange.status });
  });
}

// The same real tape with the two things a new owner usually lacks taken out: Meta then omits
// `funding_source_details`, and the portfolio owns no WhatsApp Business account. The Page's own
// answer (no WhatsApp number) is already the real one.
function withoutCardOrWhatsApp(tape: Exchange[]): Exchange[] {
  return tape.map((entry) => {
    if (entry.path.includes("funding_source_details")) {
      const { funding_source_details: _dropped, ...rest } = entry.body as Record<string, unknown>;
      void _dropped;
      return { ...entry, body: rest };
    }
    if (entry.path.includes("owned_whatsapp_business_accounts")) return { ...entry, body: { data: [] } };
    return entry;
  });
}

afterEach(() => vi.restoreAllMocks());

describe("core: Meta setup checklist after Connect (#1016)", () => {
  it("reads only GETs, and on the recorded account every row is done", async () => {
    replay(recorded.tape as Exchange[]);
    const reads = await new MetaClient(creds).setupReads();
    expect(reads).toEqual(recorded.reads);
    expect(reads).toEqual({ portfolio: { id: recorded.reads.portfolio.id, name: "Solaride" }, accountActive: true, accountStatus: 1, currency: "INR", paymentMethod: true, pageListed: true, whatsapp: true });
    const rows = setupChecklist(reads, creds);
    expect(rows.map((row) => [row.key, row.done])).toEqual([["portfolio", true], ["adAccount", true], ["page", true], ["whatsapp", true], ["payment", true]]);
    expect(rows.every((row) => !row.action)).toBe(true);
  });

  it("with no card and no WhatsApp, those two rows each get one Meta link and a Hindi line", async () => {
    replay(withoutCardOrWhatsApp(recorded.tape as Exchange[]));
    const rows = setupChecklist(await new MetaClient(creds).setupReads(), creds);
    expect(rows.filter((row) => !row.done).map((row) => row.key)).toEqual(["whatsapp", "payment"]);
    const payment = rows.find((row) => row.key === "payment")!;
    expect(payment.action).toMatchObject({ label: "Add a card or UPI", href: `https://business.facebook.com/billing_hub/payment_settings/?asset_id=${recorded.adAccountId.replace(/^act_/, "")}` });
    expect(payment.action!.hi).toMatch(/[\u0900-\u097F]/);
    expect(rows.find((row) => row.key === "whatsapp")!.action!.label).toBe("Link WhatsApp");
  });

  it("is off unless META_SETUP_CHECKLIST is exactly true", () => {
    expect(setupChecklistEnabled({})).toBe(false);
    expect(setupChecklistEnabled({ META_SETUP_CHECKLIST: "1" })).toBe(false);
    expect(setupChecklistEnabled({ META_SETUP_CHECKLIST: "true" })).toBe(true);
  });

  it("flags a non-rupee or disabled account, a missing portfolio and a Page this login can't see", () => {
    const base = recorded.reads;
    const rows = setupChecklist({ ...base, portfolio: null, currency: "USD", pageListed: false }, creds);
    expect(rows.filter((row) => !row.done).map((row) => row.key)).toEqual(["portfolio", "adAccount", "page"]);
    expect(rows.find((row) => row.key === "adAccount")!.action!.label).toBe("Use an ad account in rupees");
    // #1943: Meta's account_status picks the line and action (2 = disabled).
    expect(setupChecklist({ ...base, accountActive: false, accountStatus: 2 }, creds).find((row) => row.key === "adAccount")!.action!.label).toBe("Ask Meta to review");
  });
});
