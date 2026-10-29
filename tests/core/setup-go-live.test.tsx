// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Business, Creative } from "@/lib/types";

// #1271 (#1251 WS1 slices 4a/4b): Go live shows what will run and walks Connect Page → Go live; the one tap runs
// setup-go-live-flow (its own core test replays the recorded Meta answers) and shows each step and the outcome.
const mocks = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), goLive: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }) }));
vi.mock("@/components/meta-connect/meta-connect-dialog", () => ({
  MetaConnectDialog: ({ onConnected, onClose }: { onConnected: () => void; onClose: () => void }) => <>
    <button type="button" onClick={onConnected}>Meta dialog: connected</button>
    <button type="button" onClick={onClose}>Meta dialog: closed</button>
  </>,
}));
vi.mock("@/lib/campaign/setup-go-live-flow", () => ({ goLive: mocks.goLive }));
vi.mock("@/lib/meta-connect-ui/client", () => ({ createMetaConnectClient: () => ({}) }));
import { SetupGoLive, type SetupFunding } from "@/components/setup-go-live";
import hi from "../../messages/hi.json";
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
  it("says what will run: ads, ₹300 a day for 2 days (₹708 at most with Meta's GST), where, and the WhatsApp chat", () => {
    goLive();
    expect(screen.getByRole("group", { name: "Step 3 of 3: Go live" })).toBeInTheDocument();
    expect(screen.getByText("Ads: 2 picked")).toBeInTheDocument();
    expect(screen.getByText("₹300 a day for 2 days, ₹708 at most including Meta's GST")).toBeInTheDocument();
    expect(screen.getByText("Jaipur, Ajmer")).toBeInTheDocument();
    expect(screen.getByText("They message you on WhatsApp at +91 ••••• 3210")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Change who sees it" })).toHaveAttribute("href", "/campaigns?all=1&new=1&creatives=a,b");
  });

  it("#1934: returning, payment shows done for the last campaign, the budget starts at the last amount, no first-month line", () => {
    render(<SetupGoLive business={business} ads={ads} pageConnected funding="own" returning initialDaily={500}
      whatsappNumber="+91 ••••• 3210" weeklyCap={{ capRupees: null, active: [] }} />);
    expect(screen.getByText("Set up for your last campaign")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Add payment in Meta" })).toBeNull();
    expect(screen.getByText(/₹500 a day for 2 days/)).toBeInTheDocument();
    expect(screen.queryByText(/first month of AdBrain is free/)).toBeNull();
  });

  it("says Meta paces the capped total across the days, so one day can be over the daily amount (#2007)", () => {
    goLive();
    expect(screen.getByText("Meta spreads it across the days, so one day can be a bit more than ₹300 and another less. The total never goes past the limit above.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "₹1,000 a day" }));
    expect(screen.getByText("Meta spreads it across the days, so one day can be a bit more than ₹1,000 and another less. The total never goes past the limit above.")).toBeInTheDocument();
  });

  it("says the pacing line in Hindi (#2007)", () => {
    render(<SetupGoLive business={business} ads={ads} pageConnected funding="managed" words={{ locale: "hi", messages: hi.setup }}
      whatsappNumber="+91 ••••• 3210" weeklyCap={{ capRupees: null, active: [] }} />);
    expect(screen.getByText("Meta इसे दिनों में बाँटता है, इसलिए किसी दिन ₹300 से थोड़ा ज़्यादा और किसी दिन कम लग सकता है। कुल खर्च ऊपर लिखी सीमा से ज़्यादा कभी नहीं होगा।")).toBeInTheDocument();
    // #1530: the 2/7-day choice in Hindi.
    fireEvent.click(within(screen.getByRole("group", { name: "कितने दिन" })).getByRole("button", { name: "7 दिन" }));
    expect(screen.getByText("₹300 रोज़, 7 दिन तक, Meta के GST समेत ज़्यादा से ज़्यादा ₹2,478")).toBeInTheDocument();
  });

  it("a chip changes the daily amount, the total and the primary", () => {
    goLive();
    fireEvent.click(screen.getByRole("button", { name: "₹1,000 a day" }));
    expect(screen.getByText("₹1,000 a day for 2 days, ₹2,360 at most including Meta's GST")).toBeInTheDocument();
    expect(screen.getByText("Stops at ₹2,360")).toBeInTheDocument();
    expect(bar().getByRole("button", { name: "Go live · ₹1,000 a day" })).toBeEnabled();
  });

  it("#1530 (CEO): 2 days is the default; 7 days changes the total and the run Go live turns on", () => {
    mocks.goLive.mockImplementation((_deps, _input, onStep: (step: GoLiveStep) => void) => { onStep("check"); return new Promise(() => {}); });
    goLive();
    const days = within(screen.getByRole("group", { name: "How many days" })).getAllByRole("button");
    expect(days.map((chip) => [chip.textContent, chip.getAttribute("aria-pressed")])).toEqual([["2 days", "true"], ["7 days", "false"]]);
    fireEvent.click(screen.getByRole("button", { name: "7 days" }));
    expect(screen.getByText("₹300 a day for 7 days, ₹2,478 at most including Meta's GST")).toBeInTheDocument();
    expect(screen.getByText("Stops at ₹2,478")).toBeInTheDocument();
    expect(screen.getByText("7 days at ₹300 a day, including Meta's GST")).toBeInTheDocument();
    fireEvent.click(bar().getByRole("button", { name: "Go live · ₹300 a day" }));
    expect(mocks.goLive).toHaveBeenCalledWith(expect.anything(),
      { businessId: "b1", businessName: "Spine Care", ads, dailyBudgetRupees: 300, capDays: 7 }, expect.any(Function));
    expect(screen.getByRole("button", { name: "2 days" })).toBeDisabled();
  });

  it("#1530: changing the days after a refusal clears the old answer, so the next tap is judged afresh", async () => {
    const run = tapGoLive();
    await run.finish({ kind: "refused", campaignId: "c1", message: "Your Meta spending limit is below ₹2,478." });
    fireEvent.click(screen.getByRole("button", { name: "7 days" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("#1587: one solid primary; 'a day' once so the chips fit a row; the total isn't said three times", () => {
    goLive();
    const chips = within(screen.getByRole("group", { name: "Daily budget" })).getAllByRole("button");
    expect(chips.map((chip) => chip.textContent)).toEqual(["₹300 a day", "₹500", "₹1,000"]);
    expect(chips[0]).toHaveAttribute("aria-pressed", "true");
    expect(chips[0].className).toContain("bg-primary/10");
    expect(chips[0].className).not.toMatch(/(^|\s)bg-primary(\s|$)/);
    expect(screen.getByText("Meta checks your ads first, usually within a few hours and up to a day.")).toBeInTheDocument();
    expect(screen.getAllByText(/₹708/)).toHaveLength(2);
  });

  it("Page not connected: the primary connects it first, then the page refreshes", () => {
    goLive({ pageConnected: false });
    expect(screen.getByText("Not connected")).toBeInTheDocument();
    // #1529: before Connect, the full composer is the pre-access dead end, so the link isn't offered.
    expect(screen.queryByRole("link", { name: "Change who sees it" })).toBeNull();
    fireEvent.click(bar().getByRole("button", { name: "Connect Facebook Page" }));
    fireEvent.click(screen.getByRole("button", { name: "Meta dialog: connected" }));
    expect(mocks.refresh).toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("#718: an own-account business is told AdBrain's price before Go live; others aren't", () => {
    goLive({ funding: "own" });
    expect(screen.getByText("Your first month of AdBrain is free. After that it's ₹999 a month; we'll remind you before it's due.")).toBeInTheDocument();
    cleanup();
    goLive({ funding: "managed" });
    expect(screen.queryByText(/₹999 a month/)).not.toBeInTheDocument();
  });

  it("#1292: before Connect, the trust line for who holds the ad money; none once connected", () => {
    goLive({ pageConnected: false, funding: "own" });
    expect(screen.getByText("Your Page, your ad account, your card. AdBrain never holds your ad money.")).toBeInTheDocument();
    cleanup();
    goLive({ pageConnected: false, funding: "managed" });
    expect(screen.getByText("Your ad budget stays yours: you see every rupee spent.")).toBeInTheDocument();
    cleanup();
    goLive({ pageConnected: true, funding: "own" });
    expect(screen.queryByText(/AdBrain never holds your ad money/)).not.toBeInTheDocument();
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
    expect(screen.getByText("Turning it on…")).toHaveAttribute("role", "status");
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

  it("money row (#1251 CEO): only the own-ad-account row; AdBrain's 'Ad money' row stays hidden for every funding mode", () => {
    for (const funding of ["managed", "operator", "own", null] as const) {
      document.body.innerHTML = "";
      goLive({ funding });
      expect(screen.getByText("Payment on Meta")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Add payment in Meta" })).toHaveAttribute("target", "_blank");
      expect(screen.queryByText("Ad money")).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Add money" })).not.toBeInTheDocument();
      expect(screen.getByText("Stops at ₹708")).toBeInTheDocument();
    }
  });
});

describe("core: step 3 shows the WhatsApp welcome Go live sends (#1529)", () => {
  it("the welcome and what's ready to send, read-only", () => {
    render(<SetupGoLive business={business} ads={ads} pageConnected={false} funding="own" whatsappNumber="+91 ••••• 3210" weeklyCap={null}
      welcome={{ source: "saved", language: "en", greeting: "Hi! Thanks for asking about a free site survey.", autofill: "I'd like a free site survey", callButton: true }} />);
    expect(screen.getByText("“Hi! Thanks for asking about a free site survey.”")).toBeInTheDocument();
    expect(screen.getByText("Customers see your welcome, a Call now button, and 'I'd like a free site survey' ready to send.")).toBeInTheDocument();
  });

});

describe("core: Go live's total is activation's own cap + GST (#1251 CPO/Dev 2)", () => {
  it("₹300/₹500/₹1,000 a day for 2 days → ₹708/₹1,180/₹2,360, the amount the reserve check needs", async () => {
    const { capWithGstPaise, paymentToCoverPaise } = await import("@/lib/payments/allocation");
    expect([300, 500, 1000].map((dailyRupees) => capWithGstPaise({ dailyRupees, days: 2 }))).toEqual([70_800, 118_000, 236_000]);
    // Dev 2's payment helper still funds exactly that total (#1374 numbers unchanged).
    expect([300, 500, 1000].map((dailyRupees) => paymentToCoverPaise({ dailyRupees, days: 2, availablePaise: 0 }))).toEqual([88_500, 147_500, 295_000]);
    // #1530: the pilot run, ₹300 a day for 7 days → ₹2,478 (the kit's Meta spending limit).
    expect(capWithGstPaise({ dailyRupees: 300, days: 7 })).toBe(247_800);
  });

describe("#1901: Go live says whose picture each ad is", () => {
  it("labels each picked ad's picture", () => {
    render(<SetupGoLive business={business} pageConnected funding="managed" whatsappNumber="+91 ••••• 3210" weeklyCap={{ capRupees: null, active: [] }}
      ads={[{ ...ads[0], generation: { image: { provider: "owner-photo" } } }, { ...ads[1], generation: { image: { provider: "openrouter" } } }] as Creative[]} />);
    expect(screen.getByText("Your photo")).toBeInTheDocument();
    expect(screen.getByText("AI picture")).toBeInTheDocument();
  });
});
});

// #1989 (CPO #1983): until App Review passes (#156) only Testers can log in to the app; anyone else gets Meta's
// "app not available" page inside the Facebook dialog, which AdBrain can't see. Step 3 says so before and after.
describe("core: step 3 asks a not-yet-Tester owner to accept the invite (#1989)", () => {
  const hint = /Facebook is still reviewing AdBrain/;
  const retry = /Didn't connect\? If Facebook said the app isn't available/;
  function step3({ pageConnected = false, appReviewPending = true, locale = "en" as "en" | "hi" } = {}) {
    render(<SetupGoLive business={business} ads={ads} pageConnected={pageConnected} funding="own" appReviewPending={appReviewPending}
      words={locale === "hi" ? { locale, messages: hi.setup } : undefined} whatsappNumber="+91 ••••• 3210" weeklyCap={{ capRupees: null, active: [] }} />);
  }
  beforeEach(() => { cleanup(); window.sessionStorage.clear(); });

  it("flag on, before the first tap: the invite hint and 'Open my invites' in a new tab", () => {
    step3();
    expect(screen.getByText(hint)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Open my invites" });
    expect(link).toHaveAttribute("href", "https://developers.facebook.com/requests");
    expect(link).toHaveAttribute("target", "_blank");
    expect(screen.queryByText(retry)).toBeNull();
  });

  it("back from Facebook with nothing connected: the retry block; Try again reopens Connect", () => {
    step3();
    fireEvent.click(bar().getByRole("button", { name: "Connect Facebook Page" }));
    fireEvent.click(screen.getByRole("button", { name: "Meta dialog: closed" }));
    expect(screen.getByText(retry)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open my invites" })).toHaveAttribute("href", "https://developers.facebook.com/requests");
    expect(screen.queryByText(hint)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByRole("button", { name: "Meta dialog: connected" })).toBeInTheDocument();
  });

  it("back on step 3 after Facebook in this tab (oauth_cancelled, or 'app not available'): the retry block", () => {
    step3();
    fireEvent.click(bar().getByRole("button", { name: "Connect Facebook Page" }));
    cleanup();
    step3();
    expect(screen.getByText(retry)).toBeInTheDocument();
  });

  it("connected: today's ✓ row and no hint, even after a try", () => {
    window.sessionStorage.setItem("adbrain.setup.connectTried", "1");
    step3({ pageConnected: true });
    expect(screen.getByText("Connected")).toBeInTheDocument();
    expect(screen.queryByText(hint)).toBeNull();
    expect(screen.queryByText(retry)).toBeNull();
    expect(screen.queryByRole("link", { name: "Open my invites" })).toBeNull();
  });

  it("flag off (after App Review): no hint and no retry block anywhere", () => {
    step3({ appReviewPending: false });
    expect(screen.queryByText(hint)).toBeNull();
    fireEvent.click(bar().getByRole("button", { name: "Connect Facebook Page" }));
    fireEvent.click(screen.getByRole("button", { name: "Meta dialog: closed" }));
    expect(screen.queryByText(retry)).toBeNull();
    expect(screen.queryByRole("link", { name: "Open my invites" })).toBeNull();
  });

  it("Hindi: the CPO's words", () => {
    step3({ locale: "hi" });
    expect(screen.getByText(/Facebook अभी AdBrain की जाँच कर रहा है/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "मेरे इनवाइट खोलें" })).toBeInTheDocument();
    fireEvent.click(bar().getByRole("button", { name: "Facebook पेज जोड़ें" }));
    fireEvent.click(screen.getByRole("button", { name: "Meta dialog: closed" }));
    expect(screen.getByText(/जुड़ा नहीं\? अगर Facebook ने कहा कि ऐप उपलब्ध नहीं है/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "फिर से कोशिश करें" })).toBeInTheDocument();
  });

  it("#1438 Hindi: the summary, checklist and price in the CPO's words", () => {
    step3({ locale: "hi", appReviewPending: false });
    expect(screen.getByRole("heading", { name: "लाइव करें" })).toBeInTheDocument();
    expect(screen.getByText("विज्ञापन: 2 चुने")).toBeInTheDocument();
    expect(screen.getByText("वे आपको WhatsApp +91 ••••• 3210 पर मैसेज करेंगे")).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "लाइव करने से पहले" })).toBeInTheDocument();
    expect(screen.getByText("Facebook पेज")).toBeInTheDocument();
    expect(screen.getByText("जुड़ा नहीं है")).toBeInTheDocument();
    expect(screen.getByText("Meta पर पेमेंट")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Meta में पेमेंट जोड़ें" })).toBeInTheDocument();
    expect(screen.getByText(/^AdBrain का पहला महीना मुफ़्त है।/)).toBeInTheDocument();
    expect(screen.getByText(/^आपका पेज, आपका ऐड अकाउंट, आपका कार्ड। AdBrain आपके विज्ञापन/)).toBeInTheDocument();
    expect(screen.queryByText(/Before you go live|Payment on Meta|Not connected|a day for/)).toBeNull();
  });
});
