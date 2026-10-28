// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MarketingHome } from "@/components/marketing-home";
import { LEGAL_LINKS } from "@/lib/legal-links";
import PrivacyPolicyPage from "@/app/privacy/page";
import DataDeletionPage from "@/app/data-deletion/page";
// #730: the status page reads the recorded request; here it was received.
vi.mock("@/lib/privacy-requests", () => ({ metaDeletionStatus: async () => "received" }));

describe("public product example", () => {
  it("labels the example without claiming a live generation or customer result", () => {
    render(<MarketingHome />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Ads that bring customers to your WhatsApp.");
    expect(screen.getByText("Made by AdBrain for example businesses, not customers.")).toBeInTheDocument();
    expect(screen.getAllByRole("img", { name: /^An AdBrain ad for a / }).length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: "You approve every rupee." })).toBeInTheDocument();
    // #718 (CEO, path A): the price the owner sees, and the ad money goes to Meta.
    expect(screen.getByRole("heading", { name: "Simple pricing" })).toBeInTheDocument();
    expect(screen.getByText("₹999 a month for AdBrain, first month free. You pay Meta for your ads directly, with a limit you set. No auto-debit, stop any time.")).toBeInTheDocument();
    // #1235 (owner): AdBrain's split or margin is never shown to customers.
    expect(document.body.textContent).not.toMatch(/\b(80|20)\s?%|service (fee|allocation)|margin/i);
    expect(screen.queryByText(/partner/i)).toBeNull();
    expect(screen.queryByRole("link", { name: /WhatsApp us/ })).toBeNull();
  });

  it("links the gallery's real ads to each industry page", () => {
    render(<MarketingHome />);
    expect(screen.getByRole("link", { name: "See all ideas" })).toHaveAttribute("href", "/ideas");
    expect(screen.getByRole("link", { name: /Rooftop solar/ })).toHaveAttribute("href", "/ideas/rooftop-solar");
    expect(screen.queryByRole("radio")).toBeNull();
  });

  it("positions the product around customers without a solar identity or promised results", () => {
    const { container } = render(<MarketingHome />);
    expect(screen.getByText("Ad banao, customers paao, seedha WhatsApp par.")).toHaveAttribute("lang", "hi-Latn");
    expect(screen.getByText("Free to try. ₹999 a month after your first campaign. Your ad money goes to Meta, not to us.")).toBeInTheDocument();
    // Solaride appears only as a labelled example further down, never in the hero.
    expect(container.querySelector("#hero-title")!.closest("section")!.textContent).not.toMatch(/solar/i);
    expect(container.textContent).not.toMatch(/run ads|guaranteed customers/i);
    expect(screen.getByRole("heading", { name: "From your business to WhatsApp chats" })).toBeInTheDocument();
    // #847: the loop is told once; no second numbered "From idea to enquiry" section or caps eyebrows.
    expect(screen.queryByText(/FROM IDEA TO ENQUIRY|BEFORE YOU START/)).toBeNull();
  });

  it("keeps conversion, example, and legal navigation accessible", () => {
    const { container } = render(<MarketingHome />);
    expect(screen.getByRole("link", { name: "Make my first ad free" })).toHaveAttribute("href", "/login");
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
    expect(screen.getByRole("link", { name: "See how it works" })).toHaveAttribute("href", "#cycle");
    expect(screen.getByRole("region", { name: "From your business to WhatsApp chats" })).toHaveAttribute("id", "cycle");
    expect(screen.getByRole("link", { name: "Campaign ideas" })).toHaveAttribute("href", "/ideas");
    expect(screen.getByRole("link", { name: "How it works" })).toHaveAttribute("href", "#cycle");
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