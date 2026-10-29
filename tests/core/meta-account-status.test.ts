import { afterEach, describe, expect, it, vi } from "vitest";
import { adAccountState } from "@/lib/meta/account-status";
import { verifyMetaCapabilities } from "@/lib/meta/capability-verification";
import { buildCandidateDTOs, type DiscoveryPair } from "@/lib/meta/selection";
import { setupChecklist, type SetupReads } from "@/lib/meta/setup-checklist";

// #1943 (CPO brief, #1925): Meta's ad account_status in plain words with one action; every status but 1 blocks Go live.
// Values are the Marketing API's account_status enum; no Meta write is involved.
const QUALITY = "https://business.facebook.com/accountquality";

describe("core: ad account status in plain words (#1943)", () => {
  it.each([
    [2, "Meta has disabled this ad account, so ads can't run. You can ask Meta to review it.", "Ask Meta to review", QUALITY],
    [3, "Meta couldn't charge your card or UPI. Pay the balance in Meta and your ads can run again.", "Pay in Meta", "billing_hub"],
    [8, "Meta couldn't charge your card or UPI. Pay the balance in Meta and your ads can run again.", "Pay in Meta", "billing_hub"],
    [9, "Meta couldn't charge your card or UPI. Pay it soon to keep your ads running.", "Pay in Meta", "billing_hub"],
    [7, "Meta is checking this new ad account. Ads can start once it's done; there's nothing to do now.", null, null],
    [100, "This ad account is closed in Meta. Connect a different ad account.", "Connect another account", null],
    [101, "This ad account is closed in Meta. Connect a different ad account.", "Connect another account", null],
    [201, "This ad account is not active. Check Account quality in Meta.", "Open Account quality", QUALITY],
  ])("status %i", (status, sentence, label, url) => {
    const state = adAccountState(status, "act_123")!;
    expect(state.en).toBe(sentence);
    expect(state.hi).toBeTruthy();
    expect(state.action?.label ?? null).toBe(label);
    if (url) expect(state.action?.kind === "open_meta" && state.action.url).toContain(url);
    expect(state.blocksGoLive).toBe(true);
    expect(`${state.en} ${state.hi}`).not.toMatch(/risk|policy violation|flagged/i);
  });

  it("leaves an active account alone", () => {
    expect(adAccountState(1, "act_123")).toBeNull();
  });

  it("uses the CPO's Hindi", () => {
    expect(adAccountState(2)!.hi).toBe("Meta ने यह विज्ञापन खाता बंद कर दिया है, इसलिए विज्ञापन नहीं चल सकते। आप Meta से दोबारा जाँच करवा सकते हैं।");
    expect(adAccountState(2)!.action!.labelHi).toBe("Meta से जाँच करवाएँ");
    expect(adAccountState(101)!.action!.labelHi).toBe("दूसरा खाता जोड़ें");
  });

  it("explains a disabled account when connecting, with Ask Meta to review", () => {
    const pair = { pairId: "p1", page: { id: "456", name: "Page" }, relationshipVerified: true, currencySupported: true,
      adAccount: { id: "act_123", name: "Main", currency: "INR", timezoneName: "Asia/Kolkata", status: 2, disabled: true, metaBusinessId: null } } as unknown as DiscoveryPair;
    const [candidate] = buildCandidateDTOs([pair]);
    expect(candidate.eligible).toBe(false);
    expect(candidate.blockers[0]).toEqual({ code: "ACCOUNT_RESTRICTED", message: "Meta has disabled this ad account, so ads can't run. You can ask Meta to review it.",
      action: { kind: "open_meta", url: QUALITY, label: "Ask Meta to review" } });
  });

  it("blocks Go live with the plain line when the account can't be charged", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("me/permissions")) return Response.json({ data: ["ads_management", "pages_manage_ads"].map(permission => ({ permission, status: "granted" })) });
      if (url.includes("me/accounts")) return Response.json({ data: [{ id: "456", tasks: ["ADVERTISE"] }] });
      if (url.includes("act_123?")) return Response.json({ id: "act_123", account_status: 3, currency: "INR", timezone_name: "Asia/Kolkata", user_tasks: ["ADVERTISE"], funding_source_details: { id: "b1" } });
      return Response.json({ data: [] });
    }));
    const result = await verifyMetaCapabilities("fixture-token", { metaBusinessId: null, adAccountId: "act_123", accountName: "A", pageId: "456", pageName: "P", currency: "INR", timezoneName: "Asia/Kolkata" });
    expect(result.canCreatePaused.state).toBe("blocked");
    expect(result.canCreatePaused.blockers[0]).toMatchObject({ code: "ACCOUNT_RESTRICTED", message: "Meta couldn't charge your card or UPI. Pay the balance in Meta and your ads can run again.",
      action: { kind: "open_meta", label: "Pay in Meta" } });
    expect(result.canActivate.state).toBe("blocked");
  });

  it("shows the same words on the setup checklist's account row, in Hindi too", () => {
    const reads: SetupReads = { portfolio: { id: "1", name: "Solaride" }, accountActive: false, accountStatus: 7, currency: "INR", paymentMethod: true, pageListed: true, whatsapp: true };
    const row = setupChecklist(reads, { adAccountId: "act_123" }).find((item) => item.key === "adAccount")!;
    expect(row.done).toBe(false);
    expect(row.action).toMatchObject({ en: "Meta is checking this new ad account. Ads can start once it's done; there's nothing to do now." });
    expect(row.action!.hi).toContain("जाँच कर रहा है");
  });
});

afterEach(() => vi.unstubAllGlobals());
