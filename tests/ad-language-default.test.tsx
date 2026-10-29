// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { defaultAdLanguage } from "@/lib/languages";

// #1681 (CPO #1669): the ad language a first batch uses, and the one-row choice before it starts.
describe("defaultAdLanguage by segment (#1681)", () => {
  it("Brand languages win; else solar → Hinglish; IELTS, interiors and the rest → English", () => {
    expect(defaultAdLanguage(["Hindi"], "Rooftop solar")).toBe("hi");
    expect(defaultAdLanguage([], "Rooftop solar")).toBe("hinglish");
    expect(defaultAdLanguage(null, "Solar panels for homes")).toBe("hinglish");
    expect(defaultAdLanguage([], "IELTS coaching")).toBe("en");
    expect(defaultAdLanguage([], "Modular kitchens")).toBe("en");
    expect(defaultAdLanguage([], "Bakery")).toBe("en");
    expect(defaultAdLanguage([])).toBe("en");
  });
});

describe("<AdLanguageChips> (#1681)", () => {
  it("'Ads in:' with 4 chips in their own scripts, the default pressed; a tap changes it and reports it", async () => {
    const onChange = vi.fn();
    const { AdLanguageChips } = await import("@/components/ad-language-chips");
    render(<AdLanguageChips value="hinglish" onChange={onChange} />);
    const group = screen.getByRole("group", { name: "Your ads will be in" });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hinglish" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "हिंदी" })).toHaveAttribute("lang", "hi");
    expect(screen.getByRole("button", { name: "ਪੰਜਾਬੀ" })).toHaveAttribute("lang", "pa");
    fireEvent.click(screen.getByRole("button", { name: "English" }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith("en"));
  });
});
