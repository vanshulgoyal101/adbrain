// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CreateFlow } from "@/components/create-flow";
import type { Business } from "@/lib/types";

// #760 (CPO walk): "Brief ✓" ticked while the owner was still typing. The stepper now follows the assistant.
vi.mock("@/app/(app)/studio/actions", () => ({ setCreativeStatus: vi.fn(), updateCreativeCopy: vi.fn() }));

const business = { id: "biz-760", name: "Cedar Ridge Chiro" } as Business;
const current = () => screen.getByRole("list", { name: "Steps to an ad" }).querySelector('[aria-current="step"]')?.textContent;

describe("<CreateFlow> stepper (#760)", () => {
  beforeEach(() => {
    sessionStorage.clear();
    Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: vi.fn() });
  });
  afterEach(() => {
    sessionStorage.clear();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
  });

  it("stays on Brief while the owner answers, and moves to Create once ads are being made", async () => {
    sessionStorage.setItem(`adbrain:assistant:${business.id}`, JSON.stringify({
      goal: "Invite enquiries", started: true, turns: [], answers: [], phase: "review", prepared: { brief: "Use saved brand facts." },
    }));
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
    render(<CreateFlow business={business} opening={null}><aside>Brand context</aside></CreateFlow>);
    expect(current()).toBe("Brief");
    expect(screen.getByText("Brand context")).toBeInTheDocument();
    await act(async () => { fireEvent.click(await screen.findByRole("button", { name: "Generate 3 ads" })); });
    expect(current()).toBe("Create");
  });
});
