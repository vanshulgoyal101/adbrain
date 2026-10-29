// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SEGMENTS, segmentWhatsAppHref } from "@/lib/segments";

// #1565: the leave-behind landings, one static page per pilot segment.
describe("/for/[segment] (#1565)", () => {
  it("prerenders exactly solar, ielts and interiors; anything else is a 404", async () => {
    const page = await import("@/app/for/[segment]/page");
    expect(page.dynamicParams).toBe(false);
    expect(page.generateStaticParams()).toEqual([{ segment: "solar" }, { segment: "ielts" }, { segment: "interiors" }]);
    await expect(page.default({ params: Promise.resolve({ segment: "dental" }) })).rejects.toThrow();
  });

  it.each(SEGMENTS.map((segment) => [segment.slug, segment] as const))("%s: headline, the customer's WhatsApp message, the kit's offer and a sign-up link", async (_slug, segment) => {
    const { default: SegmentPage } = await import("@/app/for/[segment]/page");
    const { container } = render(await SegmentPage({ params: Promise.resolve({ segment: segment.slug }) }));
    expect(screen.getByRole("heading", { level: 1, name: segment.headline })).toBeInTheDocument();
    expect(within(screen.getByRole("figure")).getByText(segment.ask)).toBeInTheDocument();
    // #1632: the costs as three scannable rows (key, value, the kit's sentence).
    const costs = screen.getByRole("region", { name: "Your first campaign, set up with you for free" });
    expect([...costs.querySelectorAll("dt")].map((term) => term.textContent)).toEqual(["Setup", "Ads", "AdBrain"]);
    expect(within(costs).getByText("You pay Meta directly")).toBeInTheDocument();
    expect(within(costs).getByText("₹999 a month")).toBeInTheDocument();
    expect(within(costs).getByText(/^First month free\. No auto-debit, no lock-in\.$/)).toBeInTheDocument();
    // #1632: 'How it starts' is a real numbered sequence.
    expect(within(screen.getByRole("region", { name: "How it starts" })).getAllByRole("listitem")).toHaveLength(3);
    for (const link of screen.getAllByRole("link", { name: "Start my free campaign" })) expect(link).toHaveAttribute("href", "/login");
    const text = container.textContent ?? "";
    // #1235 and #1500: no margin or split, no promised results.
    expect(text).not.toMatch(/guarantee|\b20\s?%|\b80\s?%|service fee|100%/i);
  });

  it("#1944: IELTS and interiors invite the first 3; solar shows no Solaride numbers until the CEO OKs naming it (#1937)", async () => {
    const { default: SegmentPage } = await import("@/app/for/[segment]/page");
    for (const slug of ["ielts", "interiors"]) {
      const { unmount } = render(await SegmentPage({ params: Promise.resolve({ segment: slug }) }));
      expect(screen.getByText(/^Be one of the first 3 .* in Tricity to try it\. We'll share your results with you, and with others only if you say yes\.$/)).toBeInTheDocument();
      unmount();
    }
    const { container } = render(await SegmentPage({ params: Promise.resolve({ segment: "solar" }) }));
    expect(container.textContent).not.toMatch(/Solaride|6 WhatsApp chats|₹1,200/);
    expect(screen.queryByText(/first 3/)).toBeNull();
  });

  it("#1944: the solar proof copy is exactly as measured, with no per-chat price and no promise", () => {
    const proof = SEGMENTS.find((segment) => segment.slug === "solar")!.proof!;
    expect(proof.body).toContain("6 WhatsApp chats for about ₹1,200 across two short runs");
    expect(proof.body).toContain("it isn't a promise");
    expect(`${proof.heading} ${proof.body} ${proof.hinglish}`).not.toMatch(/per chat|₹\d+ (?:a|per) chat|guarantee/i);
  });

  it("#1632: solar shows its 3 sample ads, marked as samples; IELTS and interiors have none yet", async () => {
    const { default: SegmentPage } = await import("@/app/for/[segment]/page");
    const { unmount } = render(await SegmentPage({ params: Promise.resolve({ segment: "solar" }) }));
    const samples = screen.getByRole("region", { name: "Ads AdBrain could make for you" });
    expect(within(samples).getAllByRole("img")).toHaveLength(3);
    expect(within(samples).getAllByText("Sample")).toHaveLength(3);
    unmount();
    render(await SegmentPage({ params: Promise.resolve({ segment: "ielts" }) }));
    expect(screen.queryByRole("region", { name: "Ads AdBrain could make for you" })).toBeNull();
    expect(screen.getByText(/A free demo class, up front/)).toBeInTheDocument();
  });

  it("#1632: with a WhatsApp number, WhatsApp is the one solid button (again at the end) and sign-up is a text link", async () => {
    const before = process.env.SUPPORT_WHATSAPP;
    process.env.SUPPORT_WHATSAPP = "+91 98765 43210";
    try {
      const { default: SegmentPage } = await import("@/app/for/[segment]/page");
      render(await SegmentPage({ params: Promise.resolve({ segment: "ielts" }) }));
      expect(screen.getAllByRole("link", { name: "Message us on WhatsApp" })).toHaveLength(2);
      expect(screen.getByRole("region", { name: "Want us to set up your first campaign?" })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Or start on your own" })).toHaveAttribute("href", "/login");
      expect(screen.queryByRole("link", { name: "Start my free campaign" })).toBeNull();
    } finally {
      if (before === undefined) delete process.env.SUPPORT_WHATSAPP; else process.env.SUPPORT_WHATSAPP = before;
    }
  });

  it("the WhatsApp button opens the owner's chat pre-typed for the segment; no number, no button", () => {
    const solar = SEGMENTS[0];
    expect(segmentWhatsAppHref(solar, "+91 98765 43210")).toBe(`https://wa.me/919876543210?text=${encodeURIComponent(solar.whatsappText)}`);
    expect(segmentWhatsAppHref(solar, "")).toBeNull();
  });

  it("is in the sitemap", async () => {
    const { default: sitemap } = await import("@/app/sitemap");
    const urls = sitemap().map((entry) => entry.url);
    for (const { slug } of SEGMENTS) expect(urls.some((url) => url.endsWith(`/for/${slug}`))).toBe(true);
  });
});
