// @vitest-environment jsdom
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProductTelemetry } from "@/components/product-telemetry";

const state = vi.hoisted(() => ({ pathname: "/studio" }));
vi.mock("next/navigation", () => ({ usePathname: () => state.pathname }));
beforeEach(() => {
  state.pathname = "/studio";
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
  Object.defineProperty(navigator, "doNotTrack", { configurable: true, value: "0" });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("first-party product telemetry", () => {
  it("sends only allowlisted page metadata on navigation", async () => {
    const view = render(<ProductTelemetry />);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(fetch).toHaveBeenCalledWith("/api/events", expect.objectContaining({ body: JSON.stringify({ name: "page.view", page: "/studio" }) }));
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
});