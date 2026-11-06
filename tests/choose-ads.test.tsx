// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ADVICE_FROM_ADS, ChooseAds, budgetAdvice, formatDuration, type ChoosableAd } from "@/components/choose-ads";

const ad = (id: string, kind: ChoosableAd["kind"], durationSec?: number): ChoosableAd => ({ id, kind, imageUrl: `https://example.com/${id}.jpg`, title: id, durationSec });
const ads = [ad("p1", "photo"), ad("v1", "video", 24), ad("a1", "adbrain"), ad("v2", "video", 18), ad("a2", "adbrain"), ad("a3", "adbrain"), ad("a4", "adbrain")];

describe("Choose ads (#778, Designer frame 2)", () => {
  it("one mixed grid with Your photo / Your video · length / AdBrain tags and the budget advice", () => {
    render(<ChooseAds ads={ads} onUse={vi.fn()} />);
    expect(screen.getByRole("button", { name: "p1, Your photo" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "v1, Your video · 0:24" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "a1, AdBrain" })).toBeInTheDocument();
    expect(screen.getByText(/At ₹300 a day, Meta tests about 3–4 ads well/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pick at least 1 ad" })).toBeDisabled();
  });

  it("Yours and By AdBrain filter the grid; picks survive switching", () => {
    render(<ChooseAds ads={ads} onUse={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "a1, AdBrain" }));
    fireEvent.click(screen.getByRole("tab", { name: "Yours" }));
    expect(screen.queryByRole("button", { name: "a1, AdBrain" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { pressed: false })).toHaveLength(3);
    fireEvent.click(screen.getByRole("tab", { name: "By AdBrain" }));
    expect(screen.getByRole("button", { name: "a1, AdBrain" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("button", { name: "p1, Your photo" })).not.toBeInTheDocument();
  });

  it("caps at 6: the rest are disabled until one is unpicked, and Use sends the picks in order", () => {
    const onUse = vi.fn();
    render(<ChooseAds ads={ads} onUse={onUse} />);
    for (const id of ["v1", "p1", "a1", "v2", "a2", "a3"]) fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${id},`) }));
    expect(screen.getByRole("button", { name: "a4, AdBrain" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "a3, AdBrain" }));
    expect(screen.getByRole("button", { name: "a4, AdBrain" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Use 5 ads" }));
    expect(onUse).toHaveBeenCalledWith(["v1", "p1", "a1", "v2", "a2"]);
  });

  it("starts from the given picks, dropping unknown ids, and says the budget it was given", () => {
    render(<ChooseAds ads={ads} initial={["a1", "gone"]} dailyBudgetInr={500} onUse={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Use 1 ad" })).toBeEnabled();
    expect(screen.getByText(/At ₹500 a day/)).toBeInTheDocument();
  });

  it("formats lengths as m:ss", () => {
    expect([formatDuration(24), formatDuration(102), formatDuration(60)]).toEqual(["0:24", "1:42", "1:00"]);
  });

  it("gives the same budget advice to the composer picker, from the 4th ad", () => {
    expect(ADVICE_FROM_ADS).toBe(4);
    expect(budgetAdvice(300)).toMatch(/^At ₹300 a day, Meta tests about 3–4 ads well/);
  });
});
