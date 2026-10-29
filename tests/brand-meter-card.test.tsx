// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("@/app/(app)/brand/actions", () => ({ saveBrandFact: mocks.save }));

import { BrandMeterCard } from "@/components/brand-meter-card";

beforeEach(() => {
  mocks.save.mockReset();
  document.cookie = "adbrain-brand-meter-snooze=; max-age=0; path=/";
});
afterEach(cleanup);

describe("Home's Brand meter card (#2032)", () => {
  it("shows the count and one nudge, with the segment's example", () => {
    render(<BrandMeterCard businessId="b1" meter={{ known: 0, total: 4, next: "offer" }} segment="solar" />);
    expect(screen.getByRole("heading", { name: "Your ads know 0 of 4 things about you" })).toBeTruthy();
    expect(screen.getByText(/Make your offer specific/).textContent).toContain("Like “Free site survey”.");
    expect(screen.queryByText(/proof|trust/i)).toBeNull();
  });

  it("leaves the example out for a business outside the three segments", () => {
    render(<BrandMeterCard businessId="b1" meter={{ known: 1, total: 4, next: "audience" }} segment={null} />);
    expect(screen.getByText("Who are your best customers?")).toBeTruthy();
    expect(screen.queryByText(/Like “/)).toBeNull();
  });

  it("Add opens one field that saves to the Brand and says running ads don't change", async () => {
    mocks.save.mockResolvedValue({ ok: true });
    render(<BrandMeterCard businessId="b1" meter={{ known: 0, total: 4, next: "offer" }} segment="solar" />);
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    const field = screen.getByRole("textbox", { name: "Your offer" });
    expect(screen.getByText("Your next ads will use this. Running ads don't change.")).toBeTruthy();
    fireEvent.change(field, { target: { value: "Free site survey" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Saved. Your next ads will use this."));
    expect(mocks.save).toHaveBeenCalledWith("b1", "offer", "Free site survey");
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("fills a #1966 blank chip for proof and keeps the owner on the field when a blank is left", async () => {
    mocks.save.mockResolvedValue({ ok: false, error: "Fill in each blank, using only what is true for your business." });
    render(<BrandMeterCard businessId="b1" meter={{ known: 1, total: 4, next: "proof" }} segment="solar" />);
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    fireEvent.click(screen.getByRole("button", { name: "{n} homes installed in {area}" }));
    expect((screen.getByRole("textbox", { name: "A number people can trust" }) as HTMLInputElement).value).toBe("{n} homes installed in {area}");
    expect(screen.queryByRole("button", { name: /installation team/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByText("Fill in each blank, using only what is true for your business.")).toBeTruthy());
    expect(screen.getByRole("textbox").getAttribute("aria-invalid")).toBe("true");
  });

  it("Not now hides the card for 7 days", () => {
    render(<BrandMeterCard businessId="b1" meter={{ known: 2, total: 4, next: "why" }} segment={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(screen.queryByRole("heading")).toBeNull();
    expect(document.cookie).toContain("adbrain-brand-meter-snooze=1");
  });

  it("speaks Hindi", () => {
    render(<BrandMeterCard businessId="b1" meter={{ known: 0, total: 4, next: "offer" }} segment="ielts" locale="hi" />);
    expect(screen.getByRole("heading", { name: "आपके विज्ञापन आपके बारे में 4 में से 0 बातें जानते हैं" })).toBeTruthy();
    expect(screen.getByText(/अपना ऑफ़र साफ़ लिखें/).textContent).toContain("जैसे “मुफ़्त डेमो क्लास”।");
    expect(screen.getByRole("button", { name: "जोड़ें" })).toBeTruthy();
  });
});
