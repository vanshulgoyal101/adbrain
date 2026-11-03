import { describe, expect, it } from "vitest";
import { reviewedPixelColumn } from "@/lib/campaign/website-tracking";

// #2711 (M2, #2714): a website leads/sales campaign row records the pixel Review checked; nothing else writes the column.
describe("reviewedPixelColumn", () => {
  it("records the reviewed pixel for website leads and sales", () => {
    expect(reviewedPixelColumn({ destination: "website", websiteGoal: "leads", pixelId: "1234567890" })).toEqual({ meta_pixel_id: "1234567890" });
    expect(reviewedPixelColumn({ destination: "website", websiteGoal: "sales", pixelId: "42" })).toEqual({ meta_pixel_id: "42" });
  });

  it("leaves the column out for visits, WhatsApp and lead forms, even if a pixel rode along", () => {
    for (const review of [
      { destination: "website" as const, websiteGoal: "visits" as const, pixelId: "42" },
      { destination: "website" as const },
      { destination: "whatsapp" as const, pixelId: "42" },
      { destination: "instant_form" as const },
      {},
    ]) {
      const columns = reviewedPixelColumn(review);
      expect(columns).toEqual({});
      expect("meta_pixel_id" in columns).toBe(false);
    }
  });

  it("refuses a leads or sales review with no pixel instead of saving a campaign that can't be measured", () => {
    expect(() => reviewedPixelColumn({ destination: "website", websiteGoal: "leads" })).toThrow(/no tracking pixel/);
    expect(() => reviewedPixelColumn({ destination: "website", websiteGoal: "sales", pixelId: "" })).toThrow(/no tracking pixel/);
  });
});
