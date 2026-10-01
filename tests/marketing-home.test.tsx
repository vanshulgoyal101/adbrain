// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { MarketingHome } from "@/components/marketing-home";
import { LEGAL_LINKS } from "@/lib/legal-links";
import PrivacyPolicyPage from "@/app/privacy/page";
import DataDeletionPage from "@/app/data-deletion/page";

describe("public product example", () => {
  it("labels the example without claiming a live generation or customer result", () => {
    render(<MarketingHome />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("AdBrain");
    expect(screen.getByText(/Not a customer campaign or a live AI generation/)).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /illustrative ad photograph/ })).toHaveAttribute("src");
    expect(screen.getByRole("heading", { name: "Created paused" })).toBeInTheDocument();
  });

  it("switches the business, audience, image, copy, and call to action together", async () => {
    const user = userEvent.setup();
    render(<MarketingHome />);
    const ad = within(screen.getByRole("article", { name: "Sample ad" }));
    expect(ad.getByRole("heading")).toHaveTextContent("Make room for a slower morning.");
    await user.click(screen.getByRole("radio", { name: "Fitness" }));
    expect(ad.getByRole("heading")).toHaveTextContent("Your first class starts with a hello.");
    expect(ad.getByText(/Find your starting point at Form Studio/)).toBeInTheDocument();
    expect(ad.getByText("Ask about a class")).toBeInTheDocument();
    expect(ad.getByRole("img")).toHaveAttribute("alt", expect.stringContaining("fitness studio"));
    expect(screen.getByText("People looking for a welcoming first class")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Fitness" })).toBeChecked();
    await user.keyboard("{ArrowLeft}");
    expect(screen.getByRole("radio", { name: "Food & drink" })).toBeChecked();
    expect(ad.getByText("Plan your visit")).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "Home services" }));
    expect(ad.getByRole("heading")).toHaveTextContent("A space that feels more like you.");
    expect(ad.getByText("Book a consultation")).toBeInTheDocument();
    expect(ad.getByRole("img")).toHaveAttribute("alt", expect.stringContaining("living room"));
  });

  it("positions the product around customers without a solar identity or promised results", () => {
    const { container } = render(<MarketingHome />);
    expect(screen.getByText("Reach the right customers.")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/solar|run ads|guaranteed customers/i);
    expect(screen.getByRole("heading", { name: "Keep the conversation going" })).toBeInTheDocument();
  });

  it("keeps conversion, example, and legal navigation accessible", () => {
    const { container } = render(<MarketingHome />);
    expect(screen.getByRole("link", { name: "Create your first campaign" })).toHaveAttribute("href", "/login");
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
    expect(screen.getByRole("link", { name: "Explore campaign ideas" })).toHaveAttribute("href", "#example");
    expect(container.querySelector("#example")).toBeInTheDocument();
    expect(container.querySelector("a button")).toBeNull();
    for (const link of LEGAL_LINKS) expect(screen.getByRole("link", { name: link.label })).toHaveAttribute("href", link.href);
  });
});

describe("privacy requests", () => {
  it("directs users to signed-in Settings without promising immediate deletion or an unverified mailbox", () => {
    render(<PrivacyPolicyPage />);
    expect(screen.getAllByRole("link", { name: "Settings" })[0]).toHaveAttribute("href", "/settings");
    expect(screen.getByText(/submitting a request does not automatically export or delete/)).toBeInTheDocument();
    expect(screen.getByText(/Payment, invoice, refund and security records may need to be retained/)).toBeInTheDocument();
    expect(screen.queryByText(/privacy@adbrain/)).not.toBeInTheDocument();
    render(<DataDeletionPage />);
    expect(screen.getAllByRole("link", { name: "Settings" }).at(-1)).toHaveAttribute("href", "/settings");
    expect(screen.getByText(/there is no one-click full-account export or deletion/)).toBeInTheDocument();
    expect(screen.getByText(/does not delete provider-side campaigns or lead data/)).toBeInTheDocument();
  });
});