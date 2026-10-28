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

describe("core: <SetupResumeCard> (#1272)", () => {
  it.each([[1, "Your business", "/brand"], [2, "Your ads", "/create"], [3, "Go live", "/campaigns"]] as const)("step %i resumes at %s", (step, label, href) => {
    render(<SetupResumeCard step={step} />);
    expect(screen.getByRole("heading", { name: "Your first ad" })).toBeInTheDocument();
    expect(screen.getByText(`Step ${step} of 3 · ${label}`)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Continue" })).toHaveAttribute("href", href);
  });
});
