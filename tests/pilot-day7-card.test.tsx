// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PilotDay7Card } from "@/components/pilot-day7-card";

const businessId = "11111111-1111-4111-8111-111111111111";
afterEach(() => vi.unstubAllGlobals());

describe("Home: day-7 pricing question card (#1650)", () => {
  it("asks, offers the reasons for the answer, saves the codes and thanks the owner", async () => {
    const fetchMock = vi.fn(async () => Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    render(<PilotDay7Card businessId={businessId} />);
    expect(screen.getByText("One question after your first week: would you pay ₹999 a month to keep using AdBrain?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Maybe" }));
    expect(screen.queryByRole("button", { name: "It saves me time" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Too expensive" }));
    await screen.findByText("Thanks, that helps us decide.");
    expect(fetchMock).toHaveBeenCalledWith("/api/feedback/pilot-day7", expect.objectContaining({ method: "POST",
      body: JSON.stringify({ businessId, answer: "maybe", reason: "too_expensive" }) }));
  });

  it("'Not now' saves a dismissal and hides the card", async () => {
    const fetchMock = vi.fn(async () => Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const { container } = render(<PilotDay7Card businessId={businessId} />);
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(fetchMock).toHaveBeenCalledWith("/api/feedback/pilot-day7", expect.objectContaining({ body: JSON.stringify({ businessId, dismiss: true }) }));
  });

  it("speaks Hindi when the owner chose it", () => {
    vi.stubGlobal("fetch", vi.fn());
    render(<PilotDay7Card businessId={businessId} locale="hi" />);
    expect(screen.getByText("पहले हफ़्ते के बाद एक सवाल: क्या आप AdBrain चालू रखने के लिए ₹999 महीना देंगे?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "हाँ" }));
    expect(screen.getByRole("button", { name: "इससे समय बचता है" })).toBeInTheDocument();
  });

  it("keeps the card and says so when saving fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "x" }, { status: 503 })));
    render(<PilotDay7Card businessId={businessId} />);
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));
    fireEvent.click(screen.getByRole("button", { name: "It brings enquiries" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Your answer couldn't be saved. Try again.");
  });
});
