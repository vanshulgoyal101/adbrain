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

  it("sends a new owner with approved ads to share them, not to a Meta settings dead end (#336)", () => {
    const queue = buildWorkQueue({
      ...base,
      creatives: [{ id: "approved", status: "approved" }],
    });
    expect(queue.map((item) => item.id)).toEqual(["approved"]);
    expect(queue[0]).toMatchObject({
      title: "Your ads are ready",
      href: "/campaigns",
      action: "Share your ads",
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

  it("still points an owner with campaigns at the Meta connection when it drops", () => {
    const queue = buildWorkQueue({
      ...base,
      creatives: [{ id: "fresh", status: "approved" }],
      campaigns: [{ status: "paused", creative_ids: ["used"] }],
    });
    expect(queue.map((item) => item.id)).toEqual(["connection", "approved", "campaigns"]);
    expect(queue[1]).toMatchObject({ href: "/studio?status=approved", action: "Export ads" });
  });

  describe("#1148: after one Create and 'Use this ad', Home says Launch, not review", () => {
    const now = Date.parse("2026-10-28T08:00:00Z");
    const made = "2026-10-28T07:00:00Z";
    const batch = [
      { id: "picked", status: "approved" as const, variant_group: "g1", created_at: made },
      { id: "other-1", status: "draft" as const, variant_group: "g1", created_at: made },
      { id: "other-2", status: "draft" as const, variant_group: "g1", created_at: made },
    ];

    it("launch comes first and the unpicked ads don't count as needing review", () => {
      const queue = buildWorkQueue({ ...base, metaReady: true, creatives: batch, now });
      expect(queue.map((item) => item.id)).toEqual(["launch"]);
      expect(queue[0]).toMatchObject({ title: "Launch a campaign with your approved ads", href: "/campaigns", action: "Launch a campaign" });
    });

    it("a fresh unreviewed batch still needs review, after Launch; ads older than 7 days don't", () => {
      const fresh = [{ id: "new-1", status: "draft" as const, variant_group: "g2", created_at: made }, { id: "new-2", status: "draft" as const, variant_group: "g2", created_at: made }];
      const old = { id: "old", status: "draft" as const, variant_group: "g0", created_at: "2026-10-10T07:00:00Z" };
      const queue = buildWorkQueue({ ...base, metaReady: true, creatives: [...batch, ...fresh, old], now });
      expect(queue.map((item) => item.id)).toEqual(["launch", "review"]);
      expect(queue[1].title).toBe("2 ads need review");
    });

    it("while a campaign runs, or one is paused or a draft, Launch isn't pushed", () => {
      expect(buildWorkQueue({ ...base, metaReady: true, creatives: batch, campaigns: [{ status: "active", creative_ids: ["picked"] }], now }).map((item) => item.id)).toEqual([]);
      expect(buildWorkQueue({ ...base, metaReady: true, creatives: batch, campaigns: [{ status: "paused", creative_ids: ["picked"] }], now }).map((item) => item.id)).toEqual(["campaigns"]);
    });

    it("without Meta, the ready ads to share come first", () => {
      expect(buildWorkQueue({ ...base, creatives: batch, now }).map((item) => item.id)).toEqual(["approved"]);
    });
  });
});

// #1630 (CPO, #1604): the ₹999 plan on Home, from #1442's plan status; nothing while billing is off.
describe("buildWorkQueue: the ₹999 plan (#1630)", () => {
  const now = Date.parse("2026-11-20T06:30:00Z");
  const day = 86_400_000;
  const plan = (state: Parameters<typeof buildWorkQueue>[0]["plan"]) => buildWorkQueue({ ...base, business, now, plan: state });

  it("adds nothing with billing off, for an exempt business, or with more than 7 days of the free month left", () => {
    expect(plan(null).some((item) => item.id === "plan")).toBe(false);
    expect(plan({ state: "exempt" }).some((item) => item.id === "plan")).toBe(false);
    expect(plan({ state: "trial_not_started" }).some((item) => item.id === "plan")).toBe(false);
    expect(plan({ state: "free", until: new Date(now + 8 * day).toISOString(), dueSoon: false }).some((item) => item.id === "plan")).toBe(false);
  });

  it("free month ending within 7 days: the date, the price, Pay ₹999 to Settings → Plan, first in the queue", () => {
    const [first] = plan({ state: "free", until: "2026-11-27T06:30:00Z", dueSoon: true });
    expect(first).toEqual({ id: "plan", title: "Your free month ends on 27 November", detail: "Then it's ₹999 a month. No auto-debit; you pay when you choose.",
      href: "/settings#plan-title", action: "Pay ₹999", tone: "work" });
  });

  it("unpaid: running ads keep running, new ones wait; attention", () => {
    const [first] = plan({ state: "unpaid", since: "2026-11-19T06:30:00Z" });
    expect(first).toMatchObject({ id: "plan", title: "Your ₹999 plan payment is due", detail: "Running ads keep running. New ads and campaigns wait until you pay.", action: "Pay ₹999", tone: "attention" });
  });

  it("speaks Hindi with the same shape", () => {
    const [due] = buildWorkQueue({ ...base, business, now, plan: { state: "unpaid", since: "2026-11-19T06:30:00Z" }, locale: "hi" });
    expect(due).toMatchObject({ title: "आपका ₹999 का प्लान बाकी है", action: "₹999 भरें", tone: "attention" });
    const [ending] = buildWorkQueue({ ...base, business, now, plan: { state: "free", until: "2026-11-27T06:30:00Z", dueSoon: true }, locale: "hi" });
    expect(ending.title).toMatch(/^आपका फ्री महीना .+ को खत्म होगा$/);
  });
});
