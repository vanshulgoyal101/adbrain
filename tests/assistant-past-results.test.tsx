// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdAssistant } from "@/components/ad-assistant";
import type { OpeningLine } from "@/lib/campaign/result-evidence";
import type { Business } from "@/lib/types";

const business = { id: "biz-371", name: "Solaride", languages: ["English"] } as Business;
const opening: OpeningLine = {
  text: "Your “Wondering Whether Your Roof Is Ready?” ad got 1 chat at ₹10.69 (early: based on 1 chat). Make 3 more like it, or try a new angle?",
  moreLikeThis: { goal: "Make 3 more ads like my best one, with fresh words", referenceBrief: "Rooftop brief\nAngle: Solve a pain point" },
  newAngle: { goal: "Try a new angle, different from my last ads" },
};

beforeEach(() => {
  sessionStorage.clear();
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ready: false, question: { id: "q1", field: "audience", question: "Who should see it?", options: ["Homes", "Factories"], allowText: true, allowRandom: false, aiCanDecide: false } })));
});
afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

describe("<AdAssistant> opens on past results (#371)", () => {
  it("offers More like this, which fills the goal and sends the best ad's brief as reference", async () => {
    render(<AdAssistant business={business} opening={opening} />);
    expect(await screen.findByText(opening.text)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "More like this" }));
    expect(screen.getByRole("textbox", { name: "Campaign goal" })).toHaveValue(opening.moreLikeThis!.goal);
    await userEvent.click(screen.getByRole("button", { name: /Start creating/ }));
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
    expect(body).toMatchObject({ goal: opening.moreLikeThis!.goal, referenceBrief: opening.moreLikeThis!.referenceBrief });
  });

  it("offers New angle, which fills the goal without a reference", async () => {
    render(<AdAssistant business={business} opening={opening} />);
    await userEvent.click(await screen.findByRole("button", { name: "New angle" }));
    expect(screen.getByRole("textbox", { name: "Campaign goal" })).toHaveValue(opening.newAngle.goal);
    await userEvent.click(screen.getByRole("button", { name: /Start creating/ }));
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string).referenceBrief).toBeUndefined();
  });

  it("shows nothing extra for a business without results", async () => {
    render(<AdAssistant business={business} opening={null} />);
    expect(await screen.findByRole("textbox", { name: "Campaign goal" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "More like this" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New angle" })).not.toBeInTheDocument();
  });
});
