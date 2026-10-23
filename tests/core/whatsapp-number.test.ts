import { afterEach, describe, expect, it, vi } from "vitest";
import recorded from "./fixtures/meta/whatsapp-number.json";
import adSetCheck from "./fixtures/meta/whatsapp-adset-validate.json";

// #157: Solaride's Page has no published WhatsApp number, but its Meta business owns two
// WhatsApp Business Accounts whose numbers Meta accepts for the Page's WhatsApp ad sets
// (validate_only, whatsapp-adset-validate.json). Real read-only answers, digits replaced.
import { MetaClient } from "@/lib/meta/client";

const creds = { adAccountId: "act_2398686420592052", pageId: "885223068001054", accessToken: "test-token" };

function replay() {
  const calls: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    expect(init?.method ?? "GET").toBe("GET");
    url.searchParams.delete("access_token");
    const path = decodeURIComponent(url.pathname.replace("/v21.0/", "") + url.search);
    calls.push(path);
    if (path === `${creds.pageId}?fields=access_token`) return Response.json({ access_token: "page-token" });
    const exchange = recorded.tape.find((entry) => entry.path === path);
    if (!exchange) throw new Error(`Unrecorded Graph call: ${path}`);
    return Response.json(exchange.body, { status: exchange.status });
  });
  return calls;
}

afterEach(() => vi.restoreAllMocks());

describe("core: WhatsApp button number against recorded Graph reads (#157)", () => {
  it("has Meta's validate_only acceptance of the Page's WhatsApp ad set with either business number, in either format", () => {
    const adSets = adSetCheck.tape.filter((entry) => entry.name.startsWith("adset-"));
    expect(adSets.map((entry) => entry.name).sort()).toEqual(["adset-0874-digits", "adset-0874-plus", "adset-4842-digits", "adset-4842-plus"]);
    for (const entry of adSets) {
      expect(entry).toMatchObject({ status: 200, body: { success: true } });
      expect(JSON.parse(entry.form?.promoted_object ?? "{}")).toMatchObject({ page_id: creds.pageId });
      expect(entry.form).toMatchObject({ destination_type: "WHATSAPP", optimization_goal: "CONVERSATIONS", status: "PAUSED" });
    }
    expect(adSetCheck.tape.at(-1)).toMatchObject({ name: "campaign-delete", status: 200 });
  });
  it("accepts a number on a WhatsApp Business Account of the ad account's own business when the Page shows none", async () => {
    expect(recorded.tape[0].body).not.toHaveProperty("whatsapp_number");
    for (const number of ["+919999994842", "+919999990874"]) {
      replay();
      expect(await new MetaClient(creds).getWhatsAppNumber(number)).toBe(number);
      vi.restoreAllMocks();
    }
  });

  it("refuses a number the business does not own, and keeps the Page-only rule when no number is requested", async () => {
    replay();
    expect(await new MetaClient(creds).getWhatsAppNumber("+919876543210")).toBeNull();
    vi.restoreAllMocks();
    const calls = replay();
    expect(await new MetaClient(creds).getWhatsAppNumber()).toBeNull();
    expect(calls.some((path) => path.includes("owned_whatsapp_business_accounts"))).toBe(false);
  });
});
