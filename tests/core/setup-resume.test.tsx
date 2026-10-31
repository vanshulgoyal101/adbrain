// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SetupResumeCard } from "@/components/setup-resume-card";
import { setupResume } from "@/lib/setup/resume";
import type { Business } from "@/lib/types";

// #1272 (#1251 WS1 slice 5): until the first ad is live, Home resumes the saved setup step.
const usable = { name: "SunPeak", vertical: "Rooftop solar", phone: "9876543210", locations: ["Jaipur"], offers: ["Free survey"] } as Business;
const currentGoal = "Get WhatsApp enquiries for Rooftop solar in Jaipur, leading with: Free survey";
const adMadeFrom = (sourceFacts: string[]) => ({ status: "approved" as const, generation: { sourceFacts } });
const current = adMadeFrom([currentGoal]);

describe("core: setupResume (#1272)", () => {
  it("no business, or not the five facts yet: step 1", () => {
    expect(setupResume({ business: null, creatives: [], campaigns: [] }).step).toBe(1);
    expect(setupResume({ business: { ...usable, offers: [] }, creatives: [current], campaigns: [] })).toEqual({ step: 1, ready: [] });
    // The column's default isn't something the owner said.
    expect(setupResume({ business: { ...usable, vertical: "local business" }, creatives: [], campaigns: [] }).step).toBe(1);
  });

  it("five facts, no ad picked yet: step 2 (drafts don't count)", () => {
    expect(setupResume({ business: usable, creatives: [{ ...current, status: "draft" }], campaigns: [] })).toEqual({ step: 2, ready: [] });
  });

  it.each([
    ["an older offer", ["Get WhatsApp enquiries for Rooftop solar in Jaipur, leading with: Free quote"]],
    ["an older location", ["Get WhatsApp enquiries for Rooftop solar in Ajmer, leading with: Free survey"]],
    ["an older category", ["Get WhatsApp enquiries for Home services in Jaipur, leading with: Free survey"]],
    ["Studio", []],
  ])("an approved ad from %s resumes at step 2 (#2371)", (_source, facts) => {
    expect(setupResume({ business: usable, creatives: [adMadeFrom(facts)], campaigns: [] })).toEqual({ step: 2, ready: [] });
  });

  it("an approved older ad with no generation record resumes at step 2 (#2371)", () => {
    expect(setupResume({ business: usable, creatives: [{ status: "approved" }], campaigns: [] })).toEqual({ step: 2, ready: [] });
  });

  it("only a picked ad made from today's business details advances to step 3 (#2371)", () => {
    const old = adMadeFrom(["Get WhatsApp enquiries for Rooftop solar in Jaipur, leading with: Free quote"]);
    expect(setupResume({ business: usable, creatives: [old, { ...current, status: "draft" }], campaigns: [] })).toEqual({ step: 2, ready: [] });
    expect(setupResume({ business: usable, creatives: [old, current], campaigns: [] })).toEqual({ step: 3, ready: [current] });
  });

  it("an ad picked: step 3, also with a paused campaign that never went live", () => {
    expect(setupResume({ business: usable, creatives: [current], campaigns: [] }).step).toBe(3);
    expect(setupResume({ business: usable, creatives: [current], campaigns: [{ launched_at: null, status: "paused" }] }).step).toBe(3);
  });

  it("once a campaign has gone live (or is on, or ran before launched_at was recorded): normal Home", () => {
    for (const campaign of [{ launched_at: "2026-10-27T10:00:00Z", status: "paused" }, { launched_at: null, status: "active" }, { launched_at: null, status: "completed" }]) {
      expect(setupResume({ business: { ...usable, offers: [] }, creatives: [current], campaigns: [campaign] })).toEqual({ step: null, ready: [] });
    }
  });
});

describe("core: imported Meta campaigns count as gone live (#1403)", () => {
  const imported = { launched_at: null, status: "paused", meta_campaign_id: "120253654207670526", raw: { name: "From Meta" } };
  it("an imported campaign that's paused now keeps the normal Home", () => {
    expect(setupResume({ business: usable, creatives: [], campaigns: [imported] }).step).toBeNull();
    expect(setupResume({ business: usable, creatives: [], campaigns: [{ ...imported, raw: null, source: null }] }).step).toBeNull();
  });

  it("Go live's own campaign, created paused before the tap, still resumes at step 3", () => {
    const goLive = { launched_at: null, status: "paused", meta_campaign_id: "120253709994100526", raw: { source: "campaign_operation" } };
    expect(setupResume({ business: usable, creatives: [current], campaigns: [goLive] }).step).toBe(3);
    expect(setupResume({ business: usable, creatives: [current], campaigns: [{ ...goLive, raw: undefined, source: "campaign_operation" }] }).step).toBe(3);
  });

  it("a draft with no Meta campaign doesn't count", () => {
    expect(setupResume({ business: usable, creatives: [current], campaigns: [{ launched_at: null, status: "draft", meta_campaign_id: null }] }).step).toBe(3);
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
