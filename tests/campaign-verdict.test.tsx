// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CampaignVerdict } from "@/components/campaign-verdict";
import { cardVerdictInput, lastCampaignComparison } from "@/lib/campaign/card-verdict";
import { verdict, type VerdictInput } from "@/lib/campaign/verdict";

vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

// #1274 (#1255 slice 2): the card's sentence, number and one action for each state, with the figures under Details.
const NOW = Date.parse("2026-10-28T12:00:00Z");
const base: VerdictInput = { destination: "whatsapp", status: "active", liveSince: "2026-10-20T10:00:00Z", impressions: 5000, results: 10, spend: 1500,
  opens: 40, waiting: 0, weakAd: null, comparison: null, now: NOW };
function card(change: Partial<VerdictInput>, props: Partial<React.ComponentProps<typeof CampaignVerdict>> = {}) {
  const input = { ...base, ...change };
  return render(<CampaignVerdict verdict={verdict(input)} whatsapp={input.destination === "whatsapp"} results={input.results} spend={input.spend}
    details={<p>Impressions 5,000</p>} adsManagerUrl="https://adsmanager.facebook.com/x" {...props} />);
}
const region = () => within(screen.getByRole("region", { name: "How it's going" }));

describe("<CampaignVerdict> (#1274)", () => {
  it("measured: the number and spend, no judgement and no action; figures folded under Details", () => {
    card({});
    expect(region().getByText("Each chat costs ₹150.")).toBeInTheDocument();
    expect(region().getByText("₹150")).toHaveClass("text-[32px]");
    expect(region().getByText(/per chat · 10 chats, ₹1,500 spent/)).toBeInTheDocument();
    expect(region().queryByRole("link")).not.toBeInTheDocument();
    expect(region().queryByRole("button")).not.toBeInTheDocument();
    const details = region().getByText("Details").closest("details")!;
    expect(details.open).toBe(false);
    expect(within(details).getByText("Impressions 5,000")).toBeInTheDocument();
  });

  it("never says '₹0 spent' (a zero-spend card says so once, #173)", () => {
    card({ impressions: 0, results: 0, spend: 0, liveSince: "2026-10-28T10:00:00Z" });
    expect(region().getByText("Meta is checking your ads. This usually takes minutes to a few hours, and up to a day.")).toBeInTheDocument();
    expect(region().queryByText(/spent/)).not.toBeInTheDocument();
  });

  it("early days: the count, no action", () => {
    card({ results: 0, spend: 120 });
    expect(region().getByText("No chats yet.")).toBeInTheDocument();
    expect(region().getByText("0")).toBeInTheDocument();
    expect(region().getByText(/chats · ₹120 spent/)).toBeInTheDocument();
  });

  it("people waiting: Reply now opens Enquiries", () => {
    card({ waiting: 2 });
    expect(region().getByText(/^2 people are waiting for your reply\./)).toBeInTheDocument();
    expect(region().getByRole("link", { name: "Reply now" })).toHaveAttribute("href", "/leads");
  });

  it("costly against the owner's last campaign: Try new ads", () => {
    card({ results: 10, spend: 5000, comparison: { kind: "own", results: 25, typical: 200 } });
    expect(region().getByText("Each chat costs ₹500, more than your last campaign (₹200 each).")).toBeInTheDocument();
    expect(region().getByRole("link", { name: "Try new ads" })).toHaveAttribute("href", "/create");
  });

  it("not showing after a day: See Meta's status in Ads Manager", () => {
    card({ impressions: 0, results: 0, spend: 0, liveSince: "2026-10-26T10:00:00Z" });
    expect(region().getByRole("link", { name: "See Meta's status" })).toHaveAttribute("href", "https://adsmanager.facebook.com/x");
  });

  it("ended: Run this again calls back", () => {
    const onRunAgain = vi.fn();
    card({ status: "completed", results: 14, spend: 1344 }, { onRunAgain });
    fireEvent.click(region().getByRole("button", { name: "Run this again" }));
    expect(onRunAgain).toHaveBeenCalledTimes(1);
  });

  it("spent, no chats: the sentence names the opens; Edit the ad opens the ad's editor (CPO), none where it can't be edited", () => {
    const onEditAd = vi.fn();
    const view = card({ results: 0, spend: 450, opens: 38 }, { onEditAd });
    expect(region().getByText("₹450 spent, no chats yet. 38 people opened WhatsApp but didn't send the message.")).toBeInTheDocument();
    fireEvent.click(region().getByRole("button", { name: "Edit the ad" }));
    expect(onEditAd).toHaveBeenCalledTimes(1);
    view.unmount();
    card({ results: 0, spend: 450, opens: 38 });
    expect(region().queryByRole("button")).not.toBeInTheDocument();
  });

  it("slice 2c: one weak ad: the sentence says how much more it costs and the action is the pause offer", () => {
    const weakAd = { ad: { adId: "a2", name: "Ad 2", creative: null, spend: 900, results: 3, costPerResult: 300 }, reference: { adId: "a1", name: "Ad 1", creative: null, costPerResult: 100 }, reason: "expensive" as const };
    card({ weakAd }, { pauseOffer: <button type="button">Pause this ad</button> });
    expect(region().getByText("One ad costs 3 times as much per chat as your others. Pausing it leaves more of your budget for the ones that work.")).toBeInTheDocument();
    expect(region().getByRole("button", { name: "Pause this ad" })).toBeInTheDocument();
  });
});

describe("card verdict inputs (#1274)", () => {
  const campaign = (id: string, created_at: string, destination = "whatsapp") => ({ id, status: "active", created_at, raw: {}, destination, objective: "OUTCOME_ENGAGEMENT" });
  const result = (conversations: number, spend: number) => ({ impressions: 100, spend, leads: 0, conversations, whatsapp_opens: 3, destination: "whatsapp" });

  it("maps a card's stored numbers and the health record's live-since", () => {
    const input = cardVerdictInput({ ...campaign("c1", "2026-10-27T00:00:00Z"), raw: { health: { checkedAt: "2026-10-28T00:00:00.000Z", activeSince: "2026-10-27T10:00:00.000Z", flags: [] } } } as never,
      result(1, 32.63) as never, { now: NOW, waiting: 1, weakAd: null, comparison: null });
    expect(input).toMatchObject({ destination: "whatsapp", results: 1, spend: 32.63, opens: 3, waiting: 1, liveSince: "2026-10-27T10:00:00.000Z" });
  });

  it("compares with the owner's previous campaign of the same destination only", () => {
    const campaigns = [campaign("old-form", "2026-10-01T00:00:00Z", "instant_form"), campaign("old", "2026-10-10T00:00:00Z"), campaign("now", "2026-10-20T00:00:00Z"), campaign("later", "2026-10-25T00:00:00Z")];
    const results = { old: result(25, 5000), "old-form": { ...result(0, 900), leads: 30, destination: "instant_form" }, later: result(3, 300) };
    expect(lastCampaignComparison(campaigns[2] as never, campaigns as never, results as never)).toEqual({ kind: "own", results: 25, typical: 200 });
    expect(lastCampaignComparison(campaigns[1] as never, campaigns as never, results as never)).toBeNull();
  });
});
