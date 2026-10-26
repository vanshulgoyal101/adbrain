// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AdAssistant } from "@/components/ad-assistant";
import { occasionIdeas } from "@/lib/seasonal";
import type { Business } from "@/lib/types";

const business = { id: "biz-700", name: "Sharma Dental", languages: ["English"] } as Business;
const withFacts = { ...business, offers: ["Cleaning ₹999"], locations: ["Ludhiana"], phone: "+91 98140 00000" } as Business;
const diwali = occasionIdeas(business.name, new Date("2026-10-26T06:00:00Z"));

describe("<AdAssistant> occasion chips (#700)", () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(() => sessionStorage.clear());

  it("shows nothing when no occasion is in season", () => {
    render(<AdAssistant business={business} />);
    expect(screen.queryByRole("group", { name: "Coming up" })).toBeNull();
  });

  it("one tap fills the goal with the fact-safe occasion brief", async () => {
    const user = userEvent.setup();
    render(<AdAssistant business={business} occasions={diwali} />);
    const group = await screen.findByRole("group", { name: "Coming up" });
    await user.click(within(group).getByRole("button", { name: "Diwali festive season" }));
    expect(screen.getByRole("textbox", { name: "Campaign goal" })).toHaveValue(diwali[0].prompt);
    expect(screen.getByRole("button", { name: "Start creating" })).toBeEnabled();
  });

  it("goes straight to 3 ads when the Brand already has an offer, area and phone (#858)", async () => {
    const user = userEvent.setup();
    render(<AdAssistant business={withFacts} occasions={diwali} />);
    await user.click(await screen.findByRole("button", { name: "Diwali festive season" }));
    expect(screen.getByRole("button", { name: "Make 3 ads" })).toBeEnabled();
  });
});
