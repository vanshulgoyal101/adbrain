// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Business, Creative } from "@/lib/types";

// #1271 (#1251 WS1 slices 4a/4b): Go live shows what will run and walks Connect Page → Go live; the one tap runs
// setup-go-live-flow (its own core test replays the recorded Meta answers) and shows each step and the outcome.
const mocks = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), goLive: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }) }));
vi.mock("@/components/meta-connect/meta-connect-dialog", () => ({
  MetaConnectDialog: ({ onConnected }: { onConnected: () => void }) => <button type="button" onClick={onConnected}>Meta dialog: connected</button>,
}));
vi.mock("@/lib/campaign/setup-go-live-flow", () => ({ goLive: mocks.goLive }));
vi.mock("@/lib/meta-connect-ui/client", () => ({ createMetaConnectClient: () => ({}) }));
import { SetupGoLive, type SetupFunding } from "@/components/setup-go-live";
import type { GoLiveResult, GoLiveStep } from "@/lib/campaign/setup-go-live-flow";

const business = { id: "b1", name: "Spine Care", locations: ["Jaipur", "Ajmer"] } as Pick<Business, "id" | "name" | "locations">;
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

  /** Go live with the flow paused at each step; `finish` settles it with the given outcome. */
  function tapGoLive(amount = "₹500 a day") {
    let finish!: (result: GoLiveResult) => void;
    let step!: (step: GoLiveStep) => void;
    mocks.goLive.mockImplementation((_deps, _input, onStep: (step: GoLiveStep) => void) => {
      step = onStep;
      return new Promise<GoLiveResult>((resolve) => { finish = resolve; });
    });
    goLive();
    fireEvent.click(screen.getByRole("button", { name: amount }));
    fireEvent.click(bar().getByRole("button", { name: `Go live · ${amount}` }));
    return { step: (next: GoLiveStep) => act(() => step(next)), finish: (result: GoLiveResult) => act(async () => finish(result)) };
  }

  it("connected: one tap runs Go live with these ads, this budget and a 2-day run, one progress line per step", async () => {
    const run = tapGoLive();
    expect(mocks.goLive).toHaveBeenCalledWith(expect.anything(),
      { businessId: "b1", businessName: "Spine Care", ads, dailyBudgetRupees: 500, capDays: 2 }, expect.any(Function));
    run.step("check");
    expect(screen.getByText("Checking your campaign…")).toHaveAttribute("role", "status");
    expect(bar().getByRole("button", { name: "Go live · ₹500 a day" })).toBeDisabled();
    fireEvent.click(bar().getByRole("button", { name: "Go live · ₹500 a day" }));
    expect(mocks.goLive).toHaveBeenCalledTimes(1);
    run.step("create");
    expect(screen.getByText("Creating it on Meta, paused…")).toHaveAttribute("role", "status");
    run.step("activate");
    expect(screen.getByText("Turning it on with a ₹1,000 limit…")).toHaveAttribute("role", "status");
    await run.finish({ kind: "live", campaignId: "c1" });
    expect(screen.getByText("You're live. Meta is checking your ads; they usually start within a day.")).toHaveAttribute("role", "status");
    fireEvent.click(bar().getByRole("button", { name: "Open your campaign" }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/campaigns?all=1"));
  });

  it("blocked at review: Meta's words and a way to fix them in the campaign review; nothing created", async () => {
    const run = tapGoLive();
    await run.finish({ kind: "blocked", messages: ["Add your business website on the Your business page."] });
    expect(screen.getByRole("alert")).toHaveTextContent("Add your business website on the Your business page.");
    expect(screen.getByRole("link", { name: "Fix in campaign review" })).toHaveAttribute("href", "/campaigns?all=1&new=1&review=1&budget=500&creatives=a,b");
    expect(bar().getByRole("button", { name: "Go live · ₹500 a day" })).toBeEnabled();
  });

  it("refused at activation: the server's words, saved paused, nothing spent", async () => {
    const run = tapGoLive();
    await run.finish({ kind: "refused", campaignId: "c1", message: "Over your weekly cap." });
    expect(screen.getByRole("alert")).toHaveTextContent("Over your weekly cap.Your campaign is saved, paused. Nothing was spent.");
    expect(screen.getByRole("link", { name: "Open Campaigns" })).toHaveAttribute("href", "/campaigns?all=1");
  });

  it("not connected any more: the tap opens the Meta dialog", async () => {
    const run = tapGoLive();
    await run.finish({ kind: "connect" });
    fireEvent.click(screen.getByRole("button", { name: "Meta dialog: connected" }));
    expect(mocks.refresh).toHaveBeenCalled();
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
