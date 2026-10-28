// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import recorded from "./fixtures/meta/ad-review.json";
import { RejectedAds } from "@/components/rejected-ads";
import { SupportLinkProvider } from "@/components/support-link";
import { adReviewState, type AdReview } from "@/lib/meta/client";

vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

// #1274 (CTO): the WS2 card says why Meta didn't approve an ad, from Meta's recorded answer (#1305's tape), with
// the fix as actions and Meta's own words under Details.
type Exchange = { path: string; body: unknown };
const adsBody = (recorded.tape as Exchange[]).find((exchange) => exchange.path.includes("/ads?"))!.body as { data: Parameters<typeof adReviewState>[0][] };
const recordedReviews = adsBody.data.map(adReviewState);
const region = () => within(screen.getByRole("region", { name: "Ads Meta didn't approve" }));

describe("core: the card's rejected-ads line (#1274, #1305)", () => {
  it("recorded 'Lead Ads' rejection: Meta's words quoted, the three fallback fixes, Meta's message under Details", () => {
    const onEditAd = vi.fn();
    render(<RejectedAds reviews={recordedReviews} spend={0} onEditAd={onEditAd} adsManagerUrl="https://adsmanager.facebook.com/x" />);
    expect(region().getByText(/^Meta didn't approve 1 ad: Meta didn't say exactly why\. Here's their message: "It looks like your ad contains content/)).toHaveTextContent(/Nothing was spent\.$/);
    fireEvent.click(region().getByRole("button", { name: "Edit the words" }));
    expect(onEditAd).toHaveBeenCalledTimes(1);
    expect(region().getByRole("link", { name: "Make a new picture" })).toHaveAttribute("href", "/create");
    expect(region().getByRole("link", { name: "Ask Meta to review again" })).toHaveAttribute("href", "https://adsmanager.facebook.com/x");
    expect(region().getByText(/^Meta's message: “It looks like your ad contains content/)).toBeInTheDocument();
  });

  it("a matched policy says the CPO's sentence and its own fix; a spent campaign doesn't say nothing was spent", () => {
    const reviews: AdReview[] = [
      adReviewState({ id: "1", effective_status: "DISAPPROVED", ad_review_feedback: { global: { "Personal Attributes": "Ads must not assert personal attributes." } } }),
      adReviewState({ id: "2", effective_status: "ACTIVE" }),
    ];
    render(<SupportLinkProvider url="https://wa.me/910000000000"><RejectedAds reviews={reviews} spend={120} /></SupportLinkProvider>);
    expect(region().getByText("Meta didn't approve 1 ad: The ad talks about the reader's own health or problem (\"Are you…?\"). Meta doesn't allow that.")).toBeInTheDocument();
    // Edit the words needs an editable ad; without one there's no dead button.
    expect(region().queryByRole("button")).not.toBeInTheDocument();
  });

  it("says nothing when no ad is rejected or Meta gave no reason", () => {
    const { container } = render(<RejectedAds reviews={[adReviewState({ id: "1", effective_status: "ACTIVE" }), adReviewState({ id: "2", effective_status: "DISAPPROVED" })]} spend={0} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("'message us' opens the support WhatsApp", () => {
    const reviews = [adReviewState({ id: "1", effective_status: "DISAPPROVED", ad_review_feedback: { global: { "Housing": "Housing ads need a special ad category." } } })];
    render(<SupportLinkProvider url="https://wa.me/910000000000"><RejectedAds reviews={reviews} spend={0} /></SupportLinkProvider>);
    expect(region().getByRole("link", { name: "Message us" })).toHaveAttribute("href", "https://wa.me/910000000000");
  });
});
