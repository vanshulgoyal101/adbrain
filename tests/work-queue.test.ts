import { describe, expect, it } from "vitest";
import { buildWorkQueue, missingBrandContext } from "@/lib/work-queue";

const business = {
  name: "Test business",
  description: "Local services",
  brand_voice: "Direct",
  target_audience: "Homeowners",
  locations: ["Jaipur"],
};
const base = { business, creatives: [], campaigns: [], metaReady: false };

describe("workspace work queue", () => {
  it("gives a first-run account one real next step", () => {
    expect(
      buildWorkQueue({ ...base, business: null }).map((item) => item.id),
    ).toEqual(["brand"]);
    expect(buildWorkQueue(base).map((item) => item.id)).toEqual(["create"]);
  });

  it("does not call an incomplete business ready", () => {
    const incomplete = {
      ...business,
      description: " ",
      locations: [""],
      target_audience: null,
    };
    expect(missingBrandContext(incomplete)).toEqual([
      "business description",
      "target audience",
      "service areas",
    ]);
    expect(buildWorkQueue({ ...base, business: incomplete })[0].id).toBe(
      "context",
    );
  });

  it("routes review directly to drafts", () => {
    const queue = buildWorkQueue({
      ...base,
      creatives: [{ id: "draft", status: "draft" }],
    });
    expect(queue[0]).toMatchObject({
      title: "1 ad needs review",
      href: "/studio?status=draft",
    });
    expect(queue.some((item) => item.id === "connection")).toBe(false);
  });

  it("offers export while Meta is unavailable, not a blocked launch", () => {
    const queue = buildWorkQueue({
      ...base,
      creatives: [{ id: "approved", status: "approved" }],
    });
    expect(queue.map((item) => item.id)).toEqual(["connection", "approved"]);
    expect(queue[1]).toMatchObject({
      href: "/studio?status=approved",
      action: "Export ads",
    });
  });

  it("does not keep suggesting already-used approved ads", () => {
    const queue = buildWorkQueue({
      ...base,
      metaReady: true,
      creatives: [{ id: "used", status: "approved" }],
      campaigns: [{ status: "active", creative_ids: ["used"] }],
    });
    expect(queue).toEqual([]);
  });

  it("keeps paused campaigns a deliberate review action", () => {
    const queue = buildWorkQueue({
      ...base,
      metaReady: true,
      creatives: [{ id: "used", status: "approved" }],
      campaigns: [{ status: "paused", creative_ids: ["used"] }],
    });
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({
      id: "campaigns",
      action: "Review campaigns",
    });
    expect(queue[0].detail).toContain("1 paused, 0 draft");
  });
});
