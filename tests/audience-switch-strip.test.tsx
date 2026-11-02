// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AudienceSwitchStrip } from "@/components/audience-switch-strip";
import hi from "../messages/hi.json";

// #765 (b): the card's "New audience ready" strip: turn the waiting copy on, or cancel it.
describe("AudienceSwitchStrip", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn(async () => Response.json({ ok: true, result: {} }));
    vi.stubGlobal("fetch", fetchMock);
  });
  const sent = () => JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));

  it("speaks the owner's language, including Meta's silence and the last try (#1438)", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({}, { status: 502 }));
    render(<AudienceSwitchStrip campaignId="c-1" operationId="op-1" running={false} lastError="समय खत्म" onDone={vi.fn()} words={{ locale: "hi", messages: hi.campaigns }} />);
    expect(screen.getByRole("group", { name: "नई ऑडियंस तैयार है" })).toBeTruthy();
    expect(screen.getByRole("alert")).toHaveTextContent("पिछली कोशिश: समय खत्म");
    fireEvent.click(screen.getByRole("button", { name: "नई ऑडियंस इस्तेमाल करें" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Meta तक नहीं पहुँच सके। कुछ भी नहीं बदला; फिर कोशिश करें।"));
    expect(screen.getByRole("button", { name: "नई ऑडियंस रद्द करें" })).toBeTruthy();
  });

  it("turns the new audience on for a running campaign, with 44 px buttons", async () => {
    const onDone = vi.fn();
    render(<AudienceSwitchStrip campaignId="c-1" operationId="op-1" running onDone={onDone} />);
    expect(screen.getByText("Your current audience keeps running until you turn the new one on.")).toBeInTheDocument();
    const on = screen.getByRole("button", { name: "Turn it on" });
    expect(on.className).toMatch(/\bh-11\b/);
    fireEvent.click(on);
    await waitFor(() => expect(onDone).toHaveBeenCalledWith("New audience is on and the old one is stopped. Meta reviews the ads again and learning restarts."));
    expect(fetchMock.mock.calls[0][0]).toBe("/api/campaigns/c-1/audience/switch");
    expect(sent()).toEqual({ operationId: "op-1", action: "switch" });
  });

  // #1737: a waiting choice, not a warning: a neutral inset, one solid action, Cancel as quiet text.
  it("is calm: no amber, one solid button, Cancel as a quiet text button", () => {
    render(<AudienceSwitchStrip campaignId="c-1" operationId="op-1" running={false} onDone={vi.fn()} />);
    const strip = screen.getByRole("group", { name: "New audience ready" });
    expect(strip.className).not.toMatch(/amber/);
    expect(screen.getByRole("button", { name: "Use the new audience" }).className).toMatch(/\bbg-primary\b/);
    const cancel = screen.getByRole("button", { name: "Cancel new audience" });
    expect(cancel.className).not.toMatch(/\bborder\b|\bbg-primary\b/);
    expect(cancel.className).toMatch(/\bh-11\b/);
  });

  // #1274: in a half-width card at 1440 the viewport `sm:` row squeezed the text to one word per line.
  it("goes side by side only when the strip itself is wide, not the screen", () => {
    render(<AudienceSwitchStrip campaignId="c-1" operationId="op-1" running={false} onDone={vi.fn()} />);
    const strip = screen.getByRole("group", { name: "New audience ready" });
    expect(strip.className).toMatch(/(^|\s)@container(\s|$)/);
    const row = strip.firstElementChild as HTMLElement;
    expect(row.className).toMatch(/\bflex-col\b/);
    expect(row.className).toMatch(/@2xl:flex-row/);
    expect(strip.outerHTML).not.toMatch(/\bsm:flex-row\b/);
  });

  it("cancels: only the copy goes and the current audience keeps running", async () => {
    const onDone = vi.fn();
    render(<AudienceSwitchStrip campaignId="c-1" operationId="op-1" running onDone={onDone} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel new audience" }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith("New audience cancelled. The current one keeps running."));
    expect(sent()).toEqual({ operationId: "op-1", action: "cancel" });
  });

  it("on a paused campaign, uses the new audience without starting anything", async () => {
    const onDone = vi.fn();
    render(<AudienceSwitchStrip campaignId="c-1" operationId="op-1" running={false} onDone={onDone} />);
    fireEvent.click(screen.getByRole("button", { name: "Use the new audience" }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith("New audience is in place. The campaign stays paused until you resume it."));
  });

  it("shows the last try's failure after a reload, with the retry", () => {
    render(<AudienceSwitchStrip campaignId="c-1" operationId="op-1" running lastError="The old audience could not be turned back on. Try again, or check the campaign in Meta." onDone={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Last try: The old audience could not be turned back on.");
    expect(screen.getByRole("button", { name: "Turn it on" })).toBeEnabled();
  });

  it("shows Meta's refusal and keeps the strip so the owner can retry", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: "Ad set refused. The old audience is running again.", retryable: true }, { status: 409 }));
    const onDone = vi.fn();
    render(<AudienceSwitchStrip campaignId="c-1" operationId="op-1" running onDone={onDone} />);
    fireEvent.click(screen.getByRole("button", { name: "Turn it on" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The old audience is running again.");
    expect(onDone).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Turn it on" })).toBeEnabled();
  });
});
