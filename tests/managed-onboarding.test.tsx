// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ManagedOnboarding } from "@/components/managed/managed-onboarding";
import { onboardingProgress, type ManagedAccountProgressRow } from "@/lib/managed/onboarding";

const steps = { pay: <button type="button">Pay with Razorpay</button>, page: <button type="button">Use Solaride</button>, whatsapp: <button type="button">Link WhatsApp</button> };
const row = (patch: Partial<ManagedAccountProgressRow>): ManagedAccountProgressRow => ({
  state: "requested", funding_state: "none", page_id: null, child_business_id: null, ad_account_id: null,
  waba_id: null, phone_number_id: null, last_error: null, ...patch,
});

describe("<ManagedOnboarding> (#526)", () => {
  it("opens only the owner's current step and shows AdBrain's background work", () => {
    render(<ManagedOnboarding progress={onboardingProgress(row({ state: "page_linked", funding_state: "card_attached", page_id: "1" }))} steps={steps} />);
    const yours = screen.getByRole("list", { name: "Your steps" });
    expect(within(yours).getAllByRole("listitem").map((item) => item.getAttribute("aria-current"))).toEqual([null, null, "step"]);
    expect(screen.getByRole("button", { name: "Link WhatsApp" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pay with Razorpay" })).toBeNull();
    const background = screen.getByRole("complementary", { name: "What AdBrain is doing" });
    expect(background).toHaveTextContent("Your business on MetaSetting up");
    expect(background).toHaveTextContent("Starts after your business on Meta");
  });

  it("says what stopped, in plain words, with Meta's code for support", () => {
    render(<ManagedOnboarding progress={onboardingProgress(row({ state: "failed", funding_state: "card_attached", page_id: "1", child_business_id: "2", last_error: "meta.100.2446" }))} steps={steps} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Meta didn't create your ad account");
    expect(screen.getByRole("alert")).toHaveTextContent("meta.100.2446");
  });

  it("ends at 'Ready to advertise' with one next action", () => {
    render(<ManagedOnboarding progress={onboardingProgress(row({ state: "ready", funding_state: "card_attached", page_id: "1", child_business_id: "2", ad_account_id: "act_3", waba_id: "4", phone_number_id: "5" }))} steps={steps} />);
    expect(screen.getByRole("heading", { name: "Ready to advertise" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Create ads" })).toHaveAttribute("href", "/create");
  });
});
