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
    expect(screen.getByText(/₹999 a month, first month free/)).toBeInTheDocument();
    expect(screen.getByText(/You pay Meta directly/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Start my free campaign" })).toHaveAttribute("href", "/login");
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
