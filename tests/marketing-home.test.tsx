// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MarketingHome } from "@/components/marketing-home";
import { LEGAL_LINKS } from "@/lib/legal-links";
import PrivacyPolicyPage from "@/app/privacy/page";
import DataDeletionPage from "@/app/data-deletion/page";

describe("public product example", () => {
  it("labels the example without claiming a live generation or customer result", () => {
    render(<MarketingHome />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Ads that bring customers to your WhatsApp.");
    expect(screen.getByText(/Not a customer campaign or a live AI generation/)).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /illustrative ad photograph/ })).toHaveAttribute("src");
    expect(screen.getByRole("heading", { name: "You approve every rupee." })).toBeInTheDocument();
    expect(screen.getByText(/Making ads is free\. To run them, top up any amount from ₹500; 80% goes to your ads \(including Meta's GST\) and 20% to AdBrain\./)).toBeInTheDocument();
    expect(screen.queryByText(/partner/i)).toBeNull();
    expect(screen.queryByRole("link", { name: /WhatsApp us/ })).toBeNull();
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
    expect(screen.getByText("Ad banao, customers paao, seedha WhatsApp par.")).toHaveAttribute("lang", "hi-Latn");
    expect(screen.getByText("Making ads is free. You pay only when you choose to run one.")).toBeInTheDocument();
    // Solaride appears only as a labelled example further down, never in the hero.
    expect(container.querySelector("#hero-title")!.closest("section")!.textContent).not.toMatch(/solar/i);
    expect(container.textContent).not.toMatch(/run ads|guaranteed customers/i);
    expect(screen.getByRole("heading", { name: "Keep the conversation going" })).toBeInTheDocument();
  });

  it("keeps conversion, example, and legal navigation accessible", () => {
    const { container } = render(<MarketingHome />);
    expect(screen.getByRole("link", { name: "Make my first ad free" })).toHaveAttribute("href", "/login");
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
    expect(screen.getByRole("link", { name: "See how it works" })).toHaveAttribute("href", "#cycle");
    expect(screen.getByRole("region", { name: "From your business to WhatsApp chats" })).toHaveAttribute("id", "cycle");
    expect(screen.getByRole("link", { name: "Campaign ideas" })).toHaveAttribute("href", "#example");
    expect(container.querySelector("#example")).toBeInTheDocument();
    expect(container.querySelector("a button")).toBeNull();
    for (const link of LEGAL_LINKS) expect(screen.getByRole("link", { name: link.label })).toHaveAttribute("href", link.href);
  });
});

describe("WhatsApp support link", () => {
  it("links the configured support number and hides it while unset", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPPORT_WHATSAPP", "+91 98765 43210");
    vi.resetModules();
    const { MarketingHome: Home } = await import("@/components/marketing-home");
    render(<Home />);
    expect(screen.getByRole("link", { name: "Questions? WhatsApp us" })).toHaveAttribute("href", "https://wa.me/919876543210");
    vi.unstubAllEnvs();
  });
});

describe("privacy requests", () => {
  it("directs users to signed-in Settings without promising immediate deletion or an unverified mailbox", async () => {
    render(<PrivacyPolicyPage />);
    expect(screen.getAllByRole("link", { name: "Settings" })[0]).toHaveAttribute("href", "/settings");
    expect(screen.getByText(/submitting a request does not automatically export or delete/)).toBeInTheDocument();
    expect(screen.getByText(/Payment, invoice, refund and security records may need to be retained/)).toBeInTheDocument();
    expect(screen.queryByText(/privacy@adbrain/)).not.toBeInTheDocument();
    render(await DataDeletionPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getAllByRole("link", { name: "Settings" }).at(-1)).toHaveAttribute("href", "/settings");
    expect(screen.getByText(/there is no one-click full-account export or deletion/)).toBeInTheDocument();
    expect(screen.getByText(/does not delete provider-side campaigns or lead data/)).toBeInTheDocument();
    expect(screen.queryByText(/Confirmation code/)).not.toBeInTheDocument();
  });

  it("shows the Meta data deletion confirmation code only when it is well formed", async () => {
    const { unmount } = render(await DataDeletionPage({ searchParams: Promise.resolve({ code: "0123456789abcdef" }) }));
    expect(screen.getByText("0123456789abcdef")).toBeInTheDocument();
    expect(screen.getByText(/disconnected AdBrain from your Meta/)).toBeInTheDocument();
    unmount();
    render(await DataDeletionPage({ searchParams: Promise.resolve({ code: "<script>" }) }));
    expect(screen.queryByText(/Confirmation code/)).not.toBeInTheDocument();
  });
});