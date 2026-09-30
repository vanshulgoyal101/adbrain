// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProductTelemetry } from "@/components/product-telemetry";

const state = vi.hoisted(() => ({ pathname: "/studio" }));
vi.mock("next/navigation", () => ({ usePathname: () => state.pathname }));
beforeEach(() => {
  state.pathname = "/studio";
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
  Object.defineProperty(navigator, "doNotTrack", { configurable: true, value: "0" });
  Object.defineProperty(navigator, "globalPrivacyControl", { configurable: true, value: false });
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  vi.spyOn(performance, "now").mockReturnValue(0);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("first-party product telemetry", () => {
  it("sends only allowlisted page metadata on navigation", async () => {
    const view = render(<ProductTelemetry />);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(fetch).toHaveBeenCalledWith("/api/events", expect.objectContaining({ body: JSON.stringify({ name: "page.view", page: "/studio", viewport: "wide" }) }));
    view.rerender(<ProductTelemetry />);
    expect(fetch).toHaveBeenCalledTimes(1);
    state.pathname = "/campaigns";
    view.rerender(<ProductTelemetry />);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  });
  it("honors Do Not Track and the feature switch", () => {
    Object.defineProperty(navigator, "doNotTrack", { configurable: true, value: "1" });
    const view = render(<ProductTelemetry />);
    expect(fetch).not.toHaveBeenCalled();
    view.unmount();
    Object.defineProperty(navigator, "doNotTrack", { configurable: true, value: "0" });
    vi.stubEnv("NEXT_PUBLIC_PRODUCT_LOGGING_ENABLED", "false");
    render(<ProductTelemetry />);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("does not submit unknown paths", () => {
    state.pathname = "/private/customer-name";
    render(<ProductTelemetry />);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("captures only annotated action codes, never labels or input values", () => {
    const view = render(<><ProductTelemetry /><input aria-label="Prompt" defaultValue="private customer offer" />
      <button data-product-event="creative.generate"><span>Private business name</span></button>
      <button data-product-event="private-user@example.com">Unknown</button>
      <button data-product-event="creative.approve" disabled>Disabled</button></>);
    fireEvent.click(view.getByText("Private business name"));
    fireEvent.click(view.getByText("Unknown"));
    fireEvent.click(view.getByText("Disabled"));
    const bodies = vi.mocked(fetch).mock.calls.map(([, options]) => JSON.parse(options!.body as string));
    expect(bodies).toEqual([{ name: "page.view", page: "/studio", viewport: "wide" },
      { name: "ui.action", page: "/studio", action: "creative.generate", viewport: "wide" }]);
    expect(JSON.stringify(bodies)).not.toMatch(/private|customer|offer|business|@/i);
  });
  it("records foreground duration without hidden time or duplicate pagehide flushes", () => {
    const view = render(<ProductTelemetry />);
    vi.mocked(performance.now).mockReturnValue(2500);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    fireEvent(document, new Event("visibilitychange"));
    fireEvent(window, new Event("pagehide"));
    vi.mocked(performance.now).mockReturnValue(100000);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    fireEvent(window, new Event("pageshow"));
    vi.mocked(performance.now).mockReturnValue(101500);
    view.unmount();
    const durations = vi.mocked(fetch).mock.calls.map(([, options]) => JSON.parse(options!.body as string))
      .filter(event => event.name === "page.engagement").map(event => event.durationMs);
    expect(durations).toEqual([2500, 1500]);
  });
  it("caps client volume and honors privacy changes after mount", () => {
    const view = render(<><ProductTelemetry /><button data-product-event="creative.generate">Generate</button></>);
    for (let index = 0; index < 70; index += 1) fireEvent.click(view.getByText("Generate"));
    expect(fetch).toHaveBeenCalledTimes(45);
    vi.mocked(performance.now).mockReturnValue(60_000);
    fireEvent.click(view.getByText("Generate"));
    expect(fetch).toHaveBeenCalledTimes(46);
    Object.defineProperty(navigator, "globalPrivacyControl", { configurable: true, value: true });
    fireEvent.click(view.getByText("Generate"));
    fireEvent(window, new Event("pagehide"));
    expect(fetch).toHaveBeenCalledTimes(46);
  });
  it("keeps StrictMode page views deduplicated and never throws when telemetry fails", () => {
    vi.mocked(fetch).mockImplementation(() => { throw new Error("Offline"); });
    expect(() => render(<StrictMode><ProductTelemetry /></StrictMode>)).not.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});