import { describe, expect, it } from "vitest";
import { onboardingProgress, type ManagedAccountProgressRow } from "@/lib/managed/onboarding";

const base: ManagedAccountProgressRow = {
  state: "requested", funding_state: "none", page_id: null, child_business_id: null, ad_account_id: null,
  waba_id: null, phone_number_id: null, last_error: null,
};
const row = (patch: Partial<ManagedAccountProgressRow>) => ({ ...base, ...patch });

describe("2-Tier onboarding progress from the ledger (#526)", () => {
  it("starts with payment for a new owner", () => {
    expect(onboardingProgress(null)).toMatchObject({
      customer: { pay: "current", page: "waiting", whatsapp: "waiting" },
      background: { childBusiness: "waiting", adAccount: "waiting", funding: "waiting" },
      ready: false, failed: null,
    });
  });

  it("moves to the Page once paid, then sets up in the background while the owner links WhatsApp", () => {
    expect(onboardingProgress(row({ funding_state: "card_attached" })).customer).toEqual({ pay: "done", page: "current", whatsapp: "waiting" });
    const afterPage = onboardingProgress(row({ state: "page_linked", funding_state: "card_attached", page_id: "1" }));
    expect(afterPage.customer).toEqual({ pay: "done", page: "done", whatsapp: "current" });
    expect(afterPage.background).toEqual({ childBusiness: "working", adAccount: "waiting", funding: "waiting" });
    const accountMade = onboardingProgress(row({ state: "ad_account_created", funding_state: "invoiced", page_id: "1", child_business_id: "2", ad_account_id: "act_3" }));
    expect(accountMade.background).toEqual({ childBusiness: "done", adAccount: "done", funding: "working" });
  });

  it("is ready only when the ledger says ready", () => {
    const linked = { funding_state: "card_attached" as const, page_id: "1", child_business_id: "2", ad_account_id: "act_3", waba_id: "4", phone_number_id: "5" };
    const whatsapp = onboardingProgress(row({ ...linked, state: "whatsapp_linked" }));
    expect(whatsapp.customer.whatsapp).toBe("done");
    expect(whatsapp.background.funding).toBe("done");
    expect(whatsapp.ready).toBe(false);
    expect(onboardingProgress(row({ ...linked, state: "ready" })).ready).toBe(true);
  });

  it("marks the first unfinished step as failed, with Meta's code kept for support", () => {
    const failed = onboardingProgress(row({ state: "failed", funding_state: "card_attached", page_id: "1", child_business_id: "2", last_error: "meta.100.2446" }));
    expect(failed.background).toEqual({ childBusiness: "done", adAccount: "failed", funding: "waiting" });
    expect(failed.failed).toEqual({ step: "adAccount", code: "meta.100.2446" });
    expect(onboardingProgress(row({ funding_state: "failed" }))).toMatchObject({ customer: { pay: "failed" }, failed: { step: "pay", code: null } });
  });
});
