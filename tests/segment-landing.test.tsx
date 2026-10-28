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
