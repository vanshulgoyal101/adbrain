// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BillingSection } from "@/components/managed-billing";
import { MetaConnectionPanel } from "@/components/meta-connection";
import type { MetaConnection } from "@/lib/meta/credentials";

// #1916 (CPO, #1880): Settings says plainly what happens if an own-account owner stops paying, disconnects or deletes.
vi.mock("@/components/ui/confirm-dialog", () => ({
  useConfirm: () => [async (options: { title: string; description?: string; confirmLabel: string; cancelLabel?: string }) =>
    window.confirm(JSON.stringify(options)), null],
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
afterEach(() => vi.restoreAllMocks());

describe("If you stop (#1916)", () => {
  it("shows the three plain lines under an own-account plan", () => {
    render(<BillingSection mode="own" connection={null} />);
    const block = screen.getByRole("list", { name: "If you stop" });
    expect(block).toHaveTextContent("If you stop paying: your running ads keep running on Meta, and your results and enquiries stay here. Making new ads and campaigns waits until you pay. Nothing is deleted.");
    expect(block).toHaveTextContent("If you disconnect Facebook: your ads keep running in Meta until you pause them there. AdBrain can't pause them or update results after that.");
    expect(block).toHaveTextContent("To delete your data: use Privacy and data requests below. Your campaigns stay in your own Meta ad account.");
  });

  it("in Hindi too", () => {
    render(<BillingSection mode="own" connection={null} locale="hi" />);
    expect(screen.getByRole("list", { name: "अगर आप रुकें" })).toHaveTextContent("भुगतान बंद करने पर: आपके चल रहे विज्ञापन Meta पर चलते रहेंगे");
  });

  it("isn't shown where AdBrain holds the ad money", () => {
    render(<BillingSection mode="operator" connection={null} />);
    expect(screen.queryByRole("list", { name: "If you stop" })).toBeNull();
  });

  it("the disconnect question says the ads keep running in Meta", () => {
    const asked = vi.spyOn(window, "confirm").mockReturnValue(false);
    const connection = { source: "oauth", ready: true, pending: false, adAccountId: null, pageId: null, tokenExpiresAt: null, expired: false, scopes: [] } as MetaConnection;
    render(<MetaConnectionPanel businessId="11111111-1111-4111-8111-111111111111" connection={connection} oauthConfigured />);
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(JSON.parse(String(asked.mock.calls[0][0]))).toMatchObject({
      title: "Disconnect Facebook?",
      description: "Your ads keep running in Meta until you pause them there. After this, AdBrain can't pause them or update their results.",
      confirmLabel: "Disconnect", cancelLabel: "Keep connected",
    });
  });
});
