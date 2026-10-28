// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Business, Creative } from "@/lib/types";

// #1271 (#1251 WS1 slice 4a): Go live shows what will run and walks Connect Page → Go live; it creates and spends nothing itself.
const mocks = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }) }));
vi.mock("@/components/meta-connect/meta-connect-dialog", () => ({
  MetaConnectDialog: ({ onConnected }: { onConnected: () => void }) => <button type="button" onClick={onConnected}>Meta dialog: connected</button>,
}));
import { SetupGoLive, type SetupFunding } from "@/components/setup-go-live";

const business = { id: "b1", locations: ["Jaipur", "Ajmer"] } as Pick<Business, "id" | "locations">;
const ads = [{ id: "a", headline: "Ad a", image_url: "/a.png" }, { id: "b", headline: "Ad b", image_url: "/b.png" }] as Creative[];
const bar = () => within(screen.getByRole("navigation", { name: "Setup steps" }));

function goLive({ pageConnected = true, funding = "managed" as SetupFunding | null, capRupees = null as number | null } = {}) {
  render(<SetupGoLive business={business} ads={ads} pageConnected={pageConnected} funding={funding}
    whatsappNumber="+91 ••••• 3210" weeklyCap={{ capRupees, active: [] }} />);
}

beforeEach(() => vi.clearAllMocks());

describe("core: <SetupGoLive> (#1271)", () => {
  it("says what will run: ads, ₹300 a day for 2 days (₹600 at most), where, and the WhatsApp chat", () => {
    goLive();
    expect(screen.getByRole("group", { name: "Step 3 of 3: Go live" })).toBeInTheDocument();
    expect(screen.getByText("Ads: 2 picked")).toBeInTheDocument();
    expect(screen.getByText("₹300 a day for 2 days, ₹600 at most")).toBeInTheDocument();
    expect(screen.getByText("Jaipur, Ajmer")).toBeInTheDocument();
    expect(screen.getByText("They message you on WhatsApp at +91 ••••• 3210")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Change who sees it" })).toHaveAttribute("href", "/campaigns?all=1&new=1&creatives=a,b");
  });

  it("a chip changes the daily amount, the total and the primary", () => {
    goLive();
    fireEvent.click(screen.getByRole("button", { name: "₹1,000 a day" }));
    expect(screen.getByText("₹1,000 a day for 2 days, ₹2,000 at most")).toBeInTheDocument();
    expect(screen.getByText("Stops at ₹2,000")).toBeInTheDocument();
    expect(bar().getByRole("button", { name: "Go live · ₹1,000 a day" })).toBeEnabled();
  });

  it("Page not connected: the primary connects it first, then the page refreshes", () => {
    goLive({ pageConnected: false });
    expect(screen.getByText("Not connected")).toBeInTheDocument();
    fireEvent.click(bar().getByRole("button", { name: "Connect Facebook Page" }));
    fireEvent.click(screen.getByRole("button", { name: "Meta dialog: connected" }));
    expect(mocks.refresh).toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("connected: Go live opens the campaign review with these ads and this budget (nothing created here)", () => {
    goLive();
    fireEvent.click(screen.getByRole("button", { name: "₹500 a day" }));
    fireEvent.click(bar().getByRole("button", { name: "Go live · ₹500 a day" }));
    expect(mocks.push).toHaveBeenCalledWith("/campaigns?all=1&new=1&review=1&budget=500&creatives=a,b");
  });

  it("over the weekly cap (#1342): says so and Go live can't be tapped", () => {
    goLive({ capRupees: 2000 });
    expect(screen.getByRole("alert")).toHaveTextContent("Your weekly cap: ₹2,000 · with this campaign, about ₹2,100 a week, over the cap.");
    expect(bar().getByRole("button", { name: "Go live · ₹300 a day" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "₹1,000 a day" }));
    expect(bar().getByRole("button", { name: "Go live · ₹1,000 a day" })).toBeDisabled();
  });

  it("money row: AdBrain ad money vs paying Meta on your own account", () => {
    goLive({ funding: "managed" });
    expect(screen.getByText("Ad money")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add money" })).toHaveAttribute("href", "/settings");
    document.body.innerHTML = "";
    goLive({ funding: "own" });
    expect(screen.getByText("Payment on Meta")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add payment in Meta" })).toHaveAttribute("target", "_blank");
  });
});
