// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdAssistant } from "@/components/ad-assistant";
import type { Business, Creative } from "@/lib/types";

const { setCreativeStatus, updateCreativeCopy } = vi.hoisted(() => ({ setCreativeStatus: vi.fn(), updateCreativeCopy: vi.fn() }));
vi.mock("@/app/(app)/studio/actions", () => ({ setCreativeStatus, updateCreativeCopy }));

const business = { id: "biz-1", name: "Cedar Ridge Chiro" } as Business;
const key = `adbrain:assistant:${business.id}`;

const ad = (id: string): Creative => ({ id, headline: `Headline ${id}`, primary_text: "Book a visit.", status: "draft" }) as Creative;

function doneDraft(creatives: Creative[]) {
  sessionStorage.setItem(key, JSON.stringify({
    goal: "Invite enquiries", started: true, answers: [], phase: "done",
    turns: [{ role: "user", text: "Invite enquiries" }, { role: "result", creatives }],
  }));
}

describe("<AdAssistant> next step after Create", () => {
  beforeEach(() => {
    sessionStorage.clear();
    setCreativeStatus.mockReset();
    updateCreativeCopy.mockReset();
    Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: vi.fn() });
  });
  afterEach(() => {
    sessionStorage.clear();
    Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
  });

  it("keeps a selected ad selected after leaving and returning", async () => {
    setCreativeStatus.mockResolvedValue({ ok: true });
    doneDraft([ad("ad-1"), ad("ad-2"), ad("ad-3")]);
    const user = userEvent.setup();
    const first = render(<AdAssistant business={business} />);
    await user.click((await screen.findAllByRole("button", { name: "Use this ad" }))[1]);
    await waitFor(() => expect(setCreativeStatus).toHaveBeenCalledWith("ad-2", "approved"));
    await waitFor(() => expect(JSON.parse(sessionStorage.getItem(key)!).turns[1].creatives[1].status).toBe("approved"));
    first.unmount();

    render(<AdAssistant business={business} />);
    expect(await screen.findByRole("button", { name: "Selected" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Use this ad" })).toHaveLength(2);
  });

  it("edits an ad's text in place and keeps the edit after leaving and returning (#280)", async () => {
    updateCreativeCopy.mockResolvedValue({
      ok: true,
      warnings: ["\"20%\" isn't in your Brand. Check it's true, or add it to your Brand's offers."],
      creative: { headline: "20% off your first visit", primary_text: "Book a visit.", cta: "Book Now", generation: { concept: { description: "Austin chiropractic" } } },
    });
    doneDraft([{ ...ad("ad-1"), status: "approved", cta: "Book Now" } as Creative]);
    const user = userEvent.setup();
    const first = render(<AdAssistant business={business} />);
    await user.click(await screen.findByRole("button", { name: "Edit" }));
    await user.clear(screen.getByLabelText("Headline"));
    await user.type(screen.getByLabelText("Headline"), "20% off your first visit");
    await user.type(screen.getByLabelText("Description"), "Austin chiropractic");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(updateCreativeCopy).toHaveBeenCalledWith("ad-1", {
      headline: "20% off your first visit", primary_text: "Book a visit.", description: "Austin chiropractic", cta: "Book Now",
    });
    expect(await screen.findByText(/"20%" isn't in your Brand/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "20% off your first visit" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Selected" })).toBeInTheDocument();
    expect(setCreativeStatus).not.toHaveBeenCalled();
    await waitFor(() => expect(JSON.parse(sessionStorage.getItem(key)!).turns[1].creatives[0].headline).toBe("20% off your first visit"));
    first.unmount();

    render(<AdAssistant business={business} />);
    expect(await screen.findByRole("heading", { name: "20% off your first visit" })).toBeInTheDocument();
    expect(sessionStorage.getItem(key)).toContain("Austin chiropractic");
  });

  it("rolls the selection back when saving fails", async () => {
    setCreativeStatus.mockResolvedValue({ ok: false, error: "nope" });
    doneDraft([ad("ad-1")]);
    const user = userEvent.setup();
    render(<AdAssistant business={business} />);
    await user.click(await screen.findByRole("button", { name: "Use this ad" }));
    expect(await screen.findByText("Your choice wasn't saved. Tap it again.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use this ad" })).toBeInTheDocument();
    expect(JSON.parse(sessionStorage.getItem(key)!).turns[1].creatives[0].status).toBe("draft");
    expect(screen.queryByRole("link", { name: /create campaign/i })).toBeNull();
  });

  it("keeps the ad visible when saving throws", async () => {
    setCreativeStatus.mockRejectedValueOnce(new Error("offline"));
    doneDraft([ad("ad-1")]);
    const user = userEvent.setup();
    render(<AdAssistant business={business} />);
    await user.click(await screen.findByRole("button", { name: "Use this ad" }));
    expect(await screen.findByText("Your choice wasn't saved. Tap it again.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use this ad" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Headline ad-1" })).toBeInTheDocument();
    expect(JSON.parse(sessionStorage.getItem(key)!).turns[1].creatives[0].status).toBe("draft");
  });

  it("links the selected ads to a new campaign in the Review format", async () => {
    setCreativeStatus.mockResolvedValue({ ok: true });
    doneDraft([ad("ad-1"), ad("ad-2"), ad("ad-3")]);
    const user = userEvent.setup();
    render(<AdAssistant business={business} />);
    await screen.findAllByRole("button", { name: "Use this ad" });
    expect(screen.queryByRole("link", { name: /create campaign/i })).toBeNull();
    expect(screen.getByRole("link", { name: /review ads/i })).toHaveAttribute("href", "/studio");

    await user.click(screen.getAllByRole("button", { name: "Use this ad" })[2]);
    // #1152: one primary step after selection, not a second "Review" beside "Review ads".
    expect(await screen.findByRole("link", { name: "Next: set up campaign" })).toHaveAttribute("href", "/campaigns?new=1&creatives=ad-3&review=1");
    expect(screen.queryByRole("link", { name: "Review campaign" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /review/i }).map((link) => link.textContent)).toEqual(["Review ads"]);
    expect(screen.getByRole("link", { name: /review ads/i })).toBeInTheDocument();
  });

  it("uses the plural heading for several ads and the singular for one", async () => {
    doneDraft([ad("ad-1"), ad("ad-2"), ad("ad-3")]);
    const first = render(<AdAssistant business={business} />);
    expect(await screen.findByText("Your ads are ready. Pick the ones you like.")).toBeInTheDocument();
    first.unmount();

    doneDraft([ad("ad-1")]);
    render(<AdAssistant business={business} />);
    expect(await screen.findByText("Your ad is ready. Use it if you like it.")).toBeInTheDocument();
  });

  it("shows the small thumbnail and falls back to the original image", async () => {
    const base = "https://example.supabase.co/storage/v1/object/public/creatives/biz-1/group-1";
    doneDraft([{ ...ad("ad-1"), image_url: `${base}/originals-v1/value-ad-1.png` } as Creative]);
    render(<AdAssistant business={business} />);
    const image = await screen.findByRole("img", { name: "Headline ad-1" });
    expect(image).toHaveAttribute("src", `${base}/thumbnails-v1/value-ad-1.webp`);

    fireEvent.error(image);
    expect(image).toHaveAttribute("src", `${base}/originals-v1/value-ad-1.png`);
    fireEvent.error(image);
    expect(screen.queryByRole("img", { name: "Headline ad-1" })).toBeNull();
  });
});
