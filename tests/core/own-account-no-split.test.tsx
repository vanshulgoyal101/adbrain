// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Business, Creative } from "@/lib/types";

// #1506 (CPO on #1315, #1235): an own-account pilot pays Meta from their own ad account, so AdBrain never shows it
// 'Add money', an ad-money balance or the 80/20 split. Only the operator flag puts a business in `operator` mode.
const m = vi.hoisted(() => ({ operatorFunded: false as boolean | null, managed: null as object | null }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/components/meta-connect/meta-connect-dialog", () => ({ MetaConnectDialog: () => null }));
vi.mock("@/lib/campaign/setup-go-live-flow", () => ({ goLive: vi.fn() }));
vi.mock("@/lib/meta-connect-ui/client", () => ({ createMetaConnectClient: () => ({}) }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: () => ({ abortSignal: async () => ({ data: m.operatorFunded, error: null }) }) }),
}));
vi.mock("@/lib/meta/managed-account", () => ({ getManagedAccount: async () => m.managed }));
vi.mock("@/components/customer-balance", () => ({ CustomerBalance: () => <p>Ad budget balance ₹0</p> }));
vi.mock("@/components/production-checkout", () => ({ ProductionCheckout: () => <button type="button">Add more ad money</button> }));
vi.mock("@/components/test-checkout", () => ({ TestCheckout: () => null }));
import { SetupGoLive } from "@/components/setup-go-live";
import { BillingSection } from "@/components/managed-billing";
import { fundingMode } from "@/lib/payments/operator-funding";
import { honestCopyFindings } from "@/lib/copy/honest-copy-rules";

const business = { id: "7a1c5b0e-3f0a-4c55-9d4e-2f1f6f0b9a11", name: "Solaride", locations: ["Chandigarh"] } as Pick<Business, "id" | "name" | "locations">;
const ads = [{ id: "a", headline: "Ad a", image_url: "/a.png" }, { id: "b", headline: "Ad b", image_url: "/b.png" }] as Creative[];
const SPLIT = /service allocation|advertising allocation|\b(?:80|20)\s?%/i;
const text = () => document.body.textContent ?? "";

function expectNoAdMoney() {
  expect(screen.queryByRole("link", { name: /Add money/i })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Add (more )?(ad )?money/i })).not.toBeInTheDocument();
  // Case-sensitive: the 'Ad money' row, not the trust line 'AdBrain never holds your ad money'.
  expect(text()).not.toMatch(/\bAd money\b/);
  expect(text()).not.toMatch(/ad budget balance/i);
  expect(text()).not.toMatch(SPLIT);
  expect(honestCopyFindings(text()).filter((finding) => finding.startsWith("split"))).toEqual([]);
}

beforeEach(() => { m.operatorFunded = false; m.managed = null; });
afterEach(cleanup);

describe("core: an own-account pilot never sees Add money, an ad-money balance or the split (#1506)", () => {
  it("funding mode: own unless the operator flag is set (operator) or AdBrain holds the money (managed)", async () => {
    await expect(fundingMode(business.id)).resolves.toBe("own");
    m.operatorFunded = true;
    await expect(fundingMode(business.id)).resolves.toBe("operator");
    m.operatorFunded = false; m.managed = { adAccountId: "act_1" };
    await expect(fundingMode(business.id)).resolves.toBe("managed");
  });

  it.each([false, true])("Step 3 (Page connected: %s): Payment on Meta and the ₹999 line, no Ad money row", (pageConnected) => {
    render(<SetupGoLive business={business} ads={ads} pageConnected={pageConnected} funding="own"
      whatsappNumber="+91 ••••• 4842" weeklyCap={{ capRupees: null, active: [] }} />);
    expect(screen.getByText("Payment on Meta")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add payment in Meta" })).toHaveAttribute("href", expect.stringContaining("business.facebook.com"));
    expect(text()).toContain("After that it's ₹999 a month");
    expectNoAdMoney();
  });

  it("Settings billing: 'You pay Meta directly', with no balance, checkout or Add money even when live payments are on", () => {
    render(<BillingSection mode="own" connection={null} liveBusinessId={business.id} />);
    expect(screen.getByRole("heading", { name: "Billing" })).toBeInTheDocument();
    expect(text()).toMatch(/You pay Meta directly from your ad account/);
    expectNoAdMoney();
  });

  it("control: the checks catch the forbidden row, balance and split, so they can fail", () => {
    for (const forbidden of [<a key="a" href="/settings">Add money</a>, <p key="b">Ad money</p>, <p key="c">Ad budget balance ₹500</p>,
      <p key="d">80% ads, 20% service allocation</p>]) {
      render(forbidden);
      expect(() => expectNoAdMoney()).toThrow();
      cleanup();
    }
  });
});
