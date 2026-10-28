// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SetupResumeCard } from "@/components/setup-resume-card";
import { setupResumeStep } from "@/lib/setup/resume";
import type { Business } from "@/lib/types";

// #1272 (#1251 WS1 slice 5): until the first ad is live, Home resumes the saved setup step.
const usable = { name: "SunPeak", vertical: "Rooftop solar", phone: "9876543210", locations: ["Jaipur"], offers: ["Free survey"] } as Business;

describe("core: setupResumeStep (#1272)", () => {
  it("no business, or not the five facts yet: step 1", () => {
    expect(setupResumeStep({ business: null, creatives: [], campaigns: [] })).toBe(1);
    expect(setupResumeStep({ business: { ...usable, offers: [] }, creatives: [], campaigns: [] })).toBe(1);
    // The column's default isn't something the owner said.
    expect(setupResumeStep({ business: { ...usable, vertical: "local business" }, creatives: [], campaigns: [] })).toBe(1);
  });

  it("five facts, no ad picked yet: step 2 (drafts don't count)", () => {
    expect(setupResumeStep({ business: usable, creatives: [{ status: "draft" }], campaigns: [] })).toBe(2);
  });

  it("an ad picked: step 3, also with a paused campaign that never went live", () => {
    expect(setupResumeStep({ business: usable, creatives: [{ status: "approved" }], campaigns: [] })).toBe(3);
    expect(setupResumeStep({ business: usable, creatives: [{ status: "approved" }], campaigns: [{ launched_at: null, status: "paused" }] })).toBe(3);
  });

  it("once a campaign has gone live (or is on, or ran before launched_at was recorded): normal Home", () => {
    for (const campaign of [{ launched_at: "2026-10-27T10:00:00Z", status: "paused" }, { launched_at: null, status: "active" }, { launched_at: null, status: "completed" }]) {
      expect(setupResumeStep({ business: { ...usable, offers: [] }, creatives: [], campaigns: [campaign] })).toBeNull();
    }
  });
});

describe("core: imported Meta campaigns count as gone live (#1403)", () => {
  const imported = { launched_at: null, status: "paused", meta_campaign_id: "120253654207670526", raw: { name: "From Meta" } };
  it("an imported campaign that's paused now keeps the normal Home", () => {
    expect(setupResumeStep({ business: usable, creatives: [], campaigns: [imported] })).toBeNull();
    expect(setupResumeStep({ business: usable, creatives: [], campaigns: [{ ...imported, raw: null, source: null }] })).toBeNull();
  });

  it("Go live's own campaign, created paused before the tap, still resumes at step 3", () => {
    const goLive = { launched_at: null, status: "paused", meta_campaign_id: "120253709994100526", raw: { source: "campaign_operation" } };
    expect(setupResumeStep({ business: usable, creatives: [{ status: "approved" }], campaigns: [goLive] })).toBe(3);
    expect(setupResumeStep({ business: usable, creatives: [{ status: "approved" }], campaigns: [{ ...goLive, raw: undefined, source: "campaign_operation" }] })).toBe(3);
  });

  it("a draft with no Meta campaign doesn't count", () => {
    expect(setupResumeStep({ business: usable, creatives: [{ status: "approved" }], campaigns: [{ launched_at: null, status: "draft", meta_campaign_id: null }] })).toBe(3);
  });
});

describe("core: <SetupResumeCard> (#1272)", () => {
  it.each([[1, "Your business", "/brand"], [2, "Your ads", "/create"], [3, "Go live", "/campaigns"]] as const)("step %i resumes at %s", (step, label, href) => {
    render(<SetupResumeCard step={step} />);
    expect(screen.getByRole("heading", { name: "Your first ad" })).toBeInTheDocument();
    expect(screen.getByText(`Step ${step} of 3 · ${label}`)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Continue" })).toHaveAttribute("href", href);
  });
});

// #1712 (CPO, #1687): a handed-over account lands at step 3 with ads already made; Home shows them and the next step.
describe("core: Home's step 3 card shows the ready ads (#1712)", () => {
  const ad = (id: string) => ({ id, headline: `Ad ${id}`, image_url: `https://example.supabase.co/storage/v1/object/public/creatives/${id}.png` });

  it("names how many are ready, shows them, and leads to Go live", () => {
    render(<SetupResumeCard step={3} ready={[ad("a"), ad("b")]} />);
    expect(screen.getByRole("heading", { name: "Your 2 ads are ready" })).toBeInTheDocument();
    expect(screen.getAllByRole("img")).toHaveLength(2);
    expect(screen.getByText("Next: connect your Facebook Page and go live. It takes about 10 minutes, and nothing spends until you tap Go live.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Connect and go live" })).toHaveAttribute("href", "/campaigns");
    for (const link of screen.getAllByRole("link")) expect(link).toHaveAttribute("href", "/campaigns");
    expect(screen.queryByText(/budget|area|₹/i)).toBeNull();
  });

  it("shows at most 3 pictures, and says 1 ad for one", () => {
    const { unmount } = render(<SetupResumeCard step={3} ready={["a", "b", "c", "d"].map(ad)} />);
    expect(screen.getByRole("heading", { name: "Your 4 ads are ready" })).toBeInTheDocument();
    expect(screen.getAllByRole("img")).toHaveLength(3);
    unmount();
    render(<SetupResumeCard step={3} ready={[ad("a")]} />);
    expect(screen.getByRole("heading", { name: "Your ad is ready" })).toBeInTheDocument();
  });

  it("steps 1 and 2, and step 3 with no ready ads, are unchanged", () => {
    for (const step of [1, 2, 3] as const) {
      const { unmount } = render(<SetupResumeCard step={step} ready={[]} />);
      expect(screen.getByRole("heading", { name: "Your first ad" })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Continue" })).toBeInTheDocument();
      expect(screen.queryByRole("img")).toBeNull();
      unmount();
    }
  });
});
