// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import en from "../messages/en.json";
import hi from "../messages/hi.json";
import { DestinationChoice, WebsiteDestinationFields, WebsiteReviewFact, WebsiteReviewFacts, reviewWebsiteUrl, websiteHref } from "@/components/campaign-destination";
import { CampaignLaunchReview } from "@/components/campaign-launch-review";
import { buildManualDraftInput } from "@/lib/campaign/manual-draft-input";
import { draftInputSchema } from "@/lib/campaign/connect-contracts";

const keys = (value: unknown, prefix = ""): string[] =>
  value && typeof value === "object" ? Object.entries(value).flatMap(([key, child]) => keys(child, `${prefix}${key}.`)) : [prefix];

describe("#2600 website destination", () => {
  it("keeps WhatsApp first and offers Website only when allowed", () => {
    const { rerender } = render(<DestinationChoice value="whatsapp" onChange={() => {}} />);
    expect(screen.getAllByRole("radio").map((radio) => radio.id)).toEqual(["destination-whatsapp", "destination-instant_form"]);
    rerender(<DestinationChoice value="whatsapp" onChange={() => {}} offerWebsite />);
    expect(screen.getByRole("radio", { name: "WhatsApp chat (recommended)" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Website" })).toHaveAccessibleDescription("People open a page on your site");
    expect(screen.getByRole("group", { name: "Where should people go?" })).toBeInTheDocument();
    expect(screen.getByText("Recommended")).toBeInTheDocument();
    // A restored website draft still shows its choice.
    rerender(<DestinationChoice value="website" onChange={() => {}} />);
    expect(screen.getByRole("radio", { name: "Website" })).toBeChecked();
  });

  it("shows the link the ad opens and offers no button choice", () => {
    render(<WebsiteDestinationFields website="shop.example.in/offer" />);
    expect(screen.getByText("shop.example.in")).toBeInTheDocument();
    expect(screen.getByText("/offer")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open" })).toHaveAttribute("href", "https://shop.example.in/offer");
    expect(screen.getByRole("link", { name: "Change in Brand" })).toHaveAttribute("href", "/brand");
    expect(screen.queryByRole("radio")).toBeNull();
  });

  it("asks for a website in Brand rather than linking a bad one", () => {
    render(<WebsiteDestinationFields website="javascript:alert(1)" />);
    expect(screen.getByText(/Add your website in Brand first/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add website in Brand" })).toHaveAttribute("href", "/brand");
    expect(websiteHref("ftp://example.com")).toBeNull();
    expect(websiteHref("localhost")).toBeNull();
    expect(websiteHref(" http://example.com ")).toBe("http://example.com/");
  });

  it("is ready in Review only with a website", () => {
    const props = { selectedCount: 1, budget: 300, destination: "website" as const, audience: "Mohali" };
    const { rerender } = render(<CampaignLaunchReview {...props} />);
    expect(screen.getByText("Review before creation")).toBeInTheDocument();
    rerender(<CampaignLaunchReview {...props} website="example.com" />);
    expect(screen.getByText("Ready for campaign review")).toBeInTheDocument();
    expect(screen.getAllByRole("term").map((term) => term.textContent)).toEqual(["Goal", "People will go to", "Ad", "Total daily budget", " Audience"]);
    expect(screen.getByText("Website visits")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open" })).toHaveAttribute("href", "https://example.com/");
    expect(screen.queryByText(/^Button:/)).toBeNull();
    expect(screen.getByText("Shown on Facebook, Instagram and Messenger")).toBeInTheDocument();
    render(<WebsiteReviewFact url="https://example.com/" words={{ locale: "hi", messages: hi.campaigns }} />);
    expect(screen.getByRole("link", { name: "खोलें" })).toBeInTheDocument();
  });

  it("starts the server Review with the goal and asks for a working link", () => {
    render(<dl><WebsiteReviewFacts url="not a site" /></dl>);
    expect(screen.getAllByRole("term").map((term) => term.textContent)).toEqual(["Goal", "People will go to"]);
    expect(screen.getByText("Needs a working link")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Open" })).toBeNull();
  });

  it("never falls back to Brand once preflight finds no usable link", () => {
    expect(reviewWebsiteUrl(undefined, "example.com")).toBe("example.com");
    expect(reviewWebsiteUrl(null, "facebook.com/mypage")).toBeNull();
    expect(reviewWebsiteUrl("https://example.com/offer", "example.com")).toBe("https://example.com/offer");
  });

  it("saves a website draft without a lead form or a button choice", () => {
    const input = buildManualDraftInput({
      businessId: "00000000-0000-4000-8000-000000000001", name: "Spring sale", goal: "Visits", mode: "manual", creativeIds: [],
      dailyBudgetRupees: 300, destination: "website", leadFormId: "123", whatsappNumber: "+919876543210", whatsappLanguage: "hi",
      whatsappMessage: null, targeting: draftInputSchema.shape.targeting.parse({}), abTest: false,
    });
    expect(input).toMatchObject({ destination: "website", leadFormId: null });
    expect(input).not.toHaveProperty("whatsappNumber");
    expect(draftInputSchema.safeParse(input).success).toBe(true);
    expect(input).not.toHaveProperty("websiteCta");
    expect(draftInputSchema.safeParse({ ...input, websiteCta: "shop_now" }).success).toBe(false);
  });

  it("#2703 says the button once when every ad's matches, per ad when they differ", () => {
    const { container, rerender } = render(<WebsiteReviewFact url="https://example.com/" ads={[{ headline: "Sale", cta: "Shop Now" }, { headline: "New", cta: "Buy now" }]} />);
    expect(container.textContent).toContain("Button on Facebook: Shop now");
    rerender(<WebsiteReviewFact url="https://example.com/" ads={[{ headline: "Spring sale", cta: "Shop Now" }, { headline: " ", cta: "Register" }, { cta: "Book Now" }]} />);
    expect(container.textContent).toContain("Button on Facebook:");
    expect(container.textContent).toContain("Spring saleShop now");
    expect(container.textContent).toContain("Ad 2Sign up");
    expect(container.textContent).toContain("Ad 3Learn more");
    rerender(<WebsiteReviewFact url="https://example.com/" ads={[{ headline: "Sale", cta: "Sign up" }, { headline: "Free", cta: "Get Quote" }]} words={{ locale: "hi", messages: hi.campaigns }} />);
    expect(container.textContent).toContain("Facebook पर बटन:");
    expect(container.textContent).toContain("साइन अप करें");
    expect(container.textContent).toContain("और जानें");
    rerender(<WebsiteReviewFact url="https://example.com/" ads={[]} />);
    expect(container.textContent).not.toContain("Button on Facebook");
  });

  it("#2703 leaves WhatsApp and form Review exactly as they were", () => {
    const base = { selectedCount: 1, budget: 300, audience: "Mohali", website: "example.com" };
    for (const props of [{ ...base, destination: "whatsapp" as const, whatsappNumber: "+91 98xxxx3210" }, { ...base, destination: "instant_form" as const, leadFormName: "Quote form" }]) {
      const before = render(<CampaignLaunchReview {...props} />).container.innerHTML;
      const after = render(<CampaignLaunchReview {...props} websiteAds={[{ headline: "Sale", cta: "Shop Now" }]} />).container.innerHTML;
      expect(after).toBe(before);
      expect(after).not.toContain("Button on Facebook");
    }
  });

  it("#2703 server Review shows the buttons under the link", () => {
    const { container } = render(<dl><WebsiteReviewFacts url="https://example.com/" ads={[{ headline: "Sale", cta: "Sign up" }]} /></dl>);
    expect(container.textContent).toContain("Button on Facebook: Sign up");
  });

  it("has every destination word in Hindi", () => {
    expect(keys(hi.campaigns.destination).sort()).toEqual(keys(en.campaigns.destination).sort());
  });
});
