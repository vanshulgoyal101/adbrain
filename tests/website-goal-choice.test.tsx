// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WebsiteDestinationFields } from "@/components/campaign-destination";
import type { ReviewTracking } from "@/lib/campaign/website-tracking";
import type { WebsiteGoal } from "@/lib/types/campaign";

const english = {
  legend: "What do you want from your website?",
  visits: "Visits",
  leads: "Website leads",
  sales: "Sales",
  needsTracking: "Needs tracking",
  unavailable: "Not available yet",
  noSource: "No website tracking source is available to this ad account.",
  chooseTracking: "Choose which tracking source to use.",
  unreadable: "We couldn't check tracking for this ad account.",
  quiet: "Meta hasn't seen any recent events.",
  missing: "Meta hasn't seen the event for this goal.",
  finish: "Finish tracking setup",
};

const hindi = {
  legend: "आप अपनी वेबसाइट से क्या चाहते हैं?",
  visits: "विज़िट",
  leads: "वेबसाइट लीड",
  sales: "बिक्री",
  needsTracking: "ट्रैकिंग चाहिए",
  unavailable: "अभी उपलब्ध नहीं",
  noSource: "इस विज्ञापन खाते के लिए वेबसाइट ट्रैकिंग का कोई स्रोत उपलब्ध नहीं है।",
  chooseTracking: "इस्तेमाल करने के लिए ट्रैकिंग स्रोत चुनें।",
  unreadable: "हम इस विज्ञापन खाते की ट्रैकिंग जाँच नहीं सके।",
  quiet: "Meta को हाल में कोई इवेंट नहीं मिला।",
  missing: "Meta को इस लक्ष्य का इवेंट नहीं मिला।",
  finish: "ट्रैकिंग सेटअप पूरा करें",
};

const noSource: ReviewTracking = {
  pixelId: null,
  status: {
    state: "none", unreadable: null, pixelId: null, pixels: [], window: null,
    lastSeenAt: null, counts: null, totalEvents: null,
  },
};

const leadReady: ReviewTracking = {
  pixelId: "101",
  status: {
    state: "ready", unreadable: null, pixelId: "101",
    pixels: [{ id: "101", name: "Shop website", lastFiredAt: null, unavailable: false }],
    window: { since: "2026-10-28T00:00:00+0000", until: "2026-11-04T00:00:00+0000" },
    lastSeenAt: null, counts: { Lead: 12, Purchase: 0 }, totalEvents: 12,
  },
};

function renderGoalChoice(tracking: ReviewTracking, value: WebsiteGoal = "visits", copy = english) {
  const onChange = vi.fn();
  render(<WebsiteDestinationFields website="example.com" goalChoice={{ value, tracking, onChange, copy }} />);
  return onChange;
}

describe("website goal choices", () => {
  it("keeps visits selected and explains why conversion goals need tracking", () => {
    const onChange = renderGoalChoice(noSource);
    expect(screen.getByRole("radio", { name: "Visits" })).toBeChecked();
    const leads = screen.getByRole("radio", { name: "Website leads" });
    expect(leads).toHaveAttribute("aria-disabled", "true");
    expect(leads).toHaveAccessibleDescription("Needs tracking");
    expect(screen.getByText(english.noSource)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: english.finish })).toHaveAttribute("href", "/brand?all=1#brand-tracking");
    leads.focus();
    expect(leads).toHaveFocus();
    fireEvent.click(leads);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("distinguishes a ready lead event from a missing purchase while the rollout gate is closed", () => {
    renderGoalChoice(leadReady);
    expect(screen.getByRole("radio", { name: "Website leads" })).toHaveAccessibleDescription("Not available yet");
    expect(screen.getByRole("radio", { name: "Sales" })).toHaveAccessibleDescription("Needs tracking");
    expect(screen.getByText(english.missing)).toBeInTheDocument();
  });

  it("does not use another pixel's counts or silently replace a restored conversion goal", () => {
    const onChange = renderGoalChoice({ ...leadReady, pixelId: "202" }, "leads");
    expect(screen.getByRole("radio", { name: "Website leads" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Website leads" })).toHaveAccessibleDescription("Needs tracking");
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("radio", { name: "Visits" }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith("visits");
  });

  it("asks the owner to choose tracking instead of treating an unselected source as a failed read", () => {
    renderGoalChoice({ ...leadReady, pixelId: null });
    expect(screen.getByText(english.chooseTracking)).toBeInTheDocument();
    expect(screen.queryByText(english.unreadable)).not.toBeInTheDocument();
  });

  it("uses the supplied Hindi words for unavailable goals", () => {
    renderGoalChoice(noSource, "visits", hindi);
    expect(screen.getByRole("radio", { name: hindi.visits })).toBeChecked();
    expect(screen.getByRole("radio", { name: hindi.leads })).toHaveAccessibleDescription(hindi.needsTracking);
    expect(screen.getByText(hindi.noSource)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: hindi.finish })).toBeInTheDocument();
  });
});
