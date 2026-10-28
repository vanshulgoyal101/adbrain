// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
import { SetupSpine, firstTimer, SETUP_STEPS } from "@/components/setup-spine";

beforeEach(() => router.push.mockReset());

// #1268 (#1251 WS1 slice 1): the frame every first-timer step sits in.
describe("<SetupSpine> (#1268)", () => {
  it("names the step, shows 3 segments with the done ones filled, and says Saved", () => {
    render(<SetupSpine step={2} saved="saved" primary={{ label: "Continue with 2 ads", href: "/campaigns" }}><p>ads</p></SetupSpine>);
    const strip = screen.getByRole("group", { name: "Step 2 of 3: Your ads" });
    expect(within(strip).getByText("Step 2 of 3")).toBeInTheDocument();
    expect(within(strip).getByText("Your ads")).toBeInTheDocument();
    const segments = strip.querySelectorAll("[data-segment]");
    expect([...segments].map((segment) => segment.getAttribute("data-segment"))).toEqual(["done", "current", "todo"]);
    expect(screen.getByRole("status")).toHaveTextContent("Saved");
    expect(screen.getByRole("heading", { name: "Set up your first ad" })).toBeInTheDocument();
  });

  it("step 1 has no Back; later steps go back to the step before", () => {
    const { rerender } = render(<SetupSpine step={1} primary={{ label: "Continue", href: "/create" }}><p /></SetupSpine>);
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
    rerender(<SetupSpine step={3} primary={{ label: "Connect Facebook Page", onClick: () => undefined }}><p /></SetupSpine>);
    expect(screen.getAllByRole("button", { name: "Back" }).length).toBeGreaterThan(0);
  });

  it("is back-safe: Back and the primary wait for the step's save before leaving", async () => {
    let finish!: () => void;
    const beforeLeave = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    render(<SetupSpine step={2} saved="saving" beforeLeave={beforeLeave} primary={{ label: "Continue with 2 ads", href: "/campaigns" }}><p /></SetupSpine>);
    expect(screen.getByRole("status")).toHaveTextContent("Saving");
    const bar = screen.getByRole("navigation", { name: "Setup steps" });
    fireEvent.click(within(bar).getByRole("button", { name: "Back" }));
    expect(beforeLeave).toHaveBeenCalledTimes(1);
    expect(router.push).not.toHaveBeenCalled();
    await act(async () => finish());
    expect(router.push).toHaveBeenCalledWith(SETUP_STEPS[0].href);
    fireEvent.click(within(bar).getByRole("button", { name: "Continue with 2 ads" }));
    await act(async () => finish());
    expect(router.push).toHaveBeenLastCalledWith("/campaigns");
  });

  it("a failed save keeps the owner on the step", async () => {
    render(<SetupSpine step={2} beforeLeave={() => Promise.reject(new Error("offline"))} primary={{ label: "Continue", href: "/campaigns" }}><p /></SetupSpine>);
    await act(async () => fireEvent.click(within(screen.getByRole("navigation", { name: "Setup steps" })).getByRole("button", { name: "Back" })));
    expect(router.push).not.toHaveBeenCalled();
  });

  it("the primary can be an action and can be disabled", () => {
    const onClick = vi.fn();
    const { rerender } = render(<SetupSpine step={3} primary={{ label: "Go live · ₹300 a day", onClick }}><p /></SetupSpine>);
    fireEvent.click(screen.getByRole("button", { name: "Go live · ₹300 a day" }));
    expect(onClick).toHaveBeenCalledTimes(1);
    rerender(<SetupSpine step={3} primary={{ label: "Go live · ₹300 a day", onClick, disabled: true }}><p /></SetupSpine>);
    expect(screen.getByRole("button", { name: "Go live · ₹300 a day" })).toBeDisabled();
  });

  it("first-timer means no campaign has ever gone live", () => {
    expect(firstTimer([])).toBe(true);
    expect(firstTimer([{ launched_at: null }, { launched_at: null }])).toBe(true);
    expect(firstTimer([{ launched_at: null }, { launched_at: "2026-10-27T15:29:00Z" }])).toBe(false);
  });
});
