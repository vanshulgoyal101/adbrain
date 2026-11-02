// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import en from "../messages/en.json";
import hi from "../messages/hi.json";
import { DestinationChoice, WebsiteDestinationFields, WebsiteReviewFact, websiteHref } from "@/components/campaign-destination";
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
    expect(screen.getByRole("radio", { name: "Website" })).toBeInTheDocument();
    // A restored website draft still shows its choice.
    rerender(<DestinationChoice value="website" onChange={() => {}} />);
    expect(screen.getByRole("radio", { name: "Website" })).toBeChecked();
  });

  it("picks the button and shows the link the ad opens", () => {
    const onCta = vi.fn();
    render(<WebsiteDestinationFields website="shop.example.in/offer" cta="learn_more" onCta={onCta} />);
    expect(screen.getByRole("link", { name: "https://shop.example.in/offer" })).toHaveAttribute("href", "https://shop.example.in/offer");
    expect(screen.getByRole("radio", { name: "Learn more" })).toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: "Shop now" }));
    expect(onCta).toHaveBeenCalledWith("shop_now");
  });

  it("asks for a website in Brand rather than linking a bad one", () => {
    render(<WebsiteDestinationFields website="javascript:alert(1)" cta="sign_up" onCta={() => {}} />);
    expect(screen.getByText(/Add your website in Brand first/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Your business" })).toHaveAttribute("href", "/brand");
    expect(websiteHref("ftp://example.com")).toBeNull();
    expect(websiteHref("localhost")).toBeNull();
    expect(websiteHref(" http://example.com ")).toBe("http://example.com/");
  });

  it("is ready in Review only with a website, and names the button", () => {
    const props = { selectedCount: 1, budget: 300, destination: "website" as const, audience: "Mohali" };
    const { rerender } = render(<CampaignLaunchReview {...props} />);
    expect(screen.getByText("Review before creation")).toBeInTheDocument();
    rerender(<CampaignLaunchReview {...props} website="example.com" websiteCta="sign_up" />);
    expect(screen.getByText("Ready for campaign review")).toBeInTheDocument();
    expect(screen.getByText("People will go to")).toBeInTheDocument();
    expect(screen.getByText("Button: Sign up")).toBeInTheDocument();
    expect(screen.queryByText("Shown on Facebook, Instagram and Messenger")).toBeNull();
    render(<WebsiteReviewFact url="https://example.com/" words={{ locale: "hi", messages: hi.campaigns }} />);
    expect(screen.getByText("बटन: और जानें")).toBeInTheDocument();
  });

  it("saves the button on a website draft, never a lead form", () => {
    const input = buildManualDraftInput({
      businessId: "00000000-0000-4000-8000-000000000001", name: "Spring sale", goal: "Visits", mode: "manual", creativeIds: [],
      dailyBudgetRupees: 300, destination: "website", leadFormId: "123", whatsappNumber: "+919876543210", whatsappLanguage: "hi",
      whatsappMessage: null, targeting: draftInputSchema.shape.targeting.parse({}), abTest: false,
    });
    expect(input).toMatchObject({ destination: "website", websiteCta: "learn_more", leadFormId: null });
    expect(input).not.toHaveProperty("whatsappNumber");
    expect(draftInputSchema.safeParse(input).success).toBe(true);
    expect(draftInputSchema.safeParse({ ...input, websiteCta: "call_now" }).success).toBe(false);
  });

  it("has every destination word in Hindi", () => {
    expect(keys(hi.campaigns.destination).sort()).toEqual(keys(en.campaigns.destination).sort());
  });
});
