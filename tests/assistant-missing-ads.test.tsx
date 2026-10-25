// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdAssistant } from "@/components/ad-assistant";
import type { Business, Creative } from "@/lib/types";

const actions = vi.hoisted(() => ({ setCreativeStatus: vi.fn(), updateCreativeCopy: vi.fn() }));
vi.mock("@/app/(app)/studio/actions", () => actions);

// #634 (QA 2, production): "Generate 3 ads" made one; two image failures vanished without a word,
// and "Creating your campaign images and copy…" stayed on screen after generation ended.
const business = { id: "biz-1", name: "Cedar Ridge Chiropractic" } as Business;
const ad = (id: string, angle: string) => ({ id, headline: `${angle} headline`, primary_text: "Book a visit.", status: "draft", angle }) as Creative;
const pain = ad("creative-pain", "Solve a pain point");
const feature = ad("creative-feature", "Feature");
const offer = ad("creative-offer", "Special offer");

function reviewDraft() {
  sessionStorage.setItem(`adbrain:assistant:${business.id}`, JSON.stringify({
    goal: "Feature: $49 new-patient exam", started: true, turns: [], answers: [], phase: "review",
    prepared: { brief: "Feature the $49 new-patient exam." },
  }));
}

function createReplies(...replies: { creatives: Creative[]; failures?: { angle: string; error: string }[] }[]) {
  const posts: { count: number; generationId: string; brief: string }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/creatives/generate" && init?.method === "POST") {
      posts.push(JSON.parse(String(init.body)));
      return Response.json({ variantGroup: posts.at(-1)!.generationId, failures: [], ...replies[posts.length - 1] });
    }
    return new Response(null, { status: 404 });
  }));
  return posts;
}

const imageFailure = (angle: string) => ({ angle, error: "The picture couldn't be made." });

describe("<AdAssistant> ads that couldn't be made (#634)", () => {
  beforeEach(() => {
    sessionStorage.clear();
    Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: vi.fn() });
    reviewDraft();
  });
  afterEach(() => {
    sessionStorage.clear();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
  });

  it("names the missing ads, clears the progress line, and makes only the missing ones into the same result", async () => {
    const posts = createReplies(
      { creatives: [pain], failures: [imageFailure("Feature"), imageFailure("Special offer")] },
      { creatives: [feature, offer] },
    );
    render(<AdAssistant business={business} />);
    await act(async () => { fireEvent.click(await screen.findByRole("button", { name: "Generate 3 ads" })); });

    expect(await screen.findByText("2 of 3 ads couldn't be made this time.")).toBeInTheDocument();
    expect(screen.queryByText(/Creating your campaign images and copy/)).not.toBeInTheDocument();
    expect(screen.getAllByText("Solve a pain point headline").length).toBeGreaterThan(0);

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Make 2 more ads" })); });
    await waitFor(() => expect(screen.queryByText(/couldn't be made/)).not.toBeInTheDocument());
    expect(posts.map(({ count }) => count)).toEqual([3, 2]);
    expect(posts[1].brief).toBe(posts[0].brief);
    expect(posts[1].generationId).not.toBe(posts[0].generationId);
    for (const headline of ["Solve a pain point headline", "Feature headline", "Special offer headline"]) {
      expect(screen.getAllByText(headline).length).toBeGreaterThan(0);
    }
    expect(screen.getAllByText(/Your ads are ready/)).toHaveLength(1);
    expect(screen.queryByText(/Creating your campaign images and copy/)).not.toBeInTheDocument();
  });

  it("keeps counting what is still missing when a second try also falls short", async () => {
    createReplies(
      { creatives: [pain], failures: [imageFailure("Feature"), imageFailure("Special offer")] },
      { creatives: [feature], failures: [imageFailure("Special offer")] },
    );
    render(<AdAssistant business={business} />);
    await act(async () => { fireEvent.click(await screen.findByRole("button", { name: "Generate 3 ads" })); });
    await act(async () => { fireEvent.click(await screen.findByRole("button", { name: "Make 2 more ads" })); });
    expect(await screen.findByText("1 of 3 ads couldn't be made this time.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Make 1 more ad" })).toBeInTheDocument();
  });

  it("says nothing extra when all three ads are made", async () => {
    createReplies({ creatives: [pain, feature, offer] });
    render(<AdAssistant business={business} />);
    await act(async () => { fireEvent.click(await screen.findByRole("button", { name: "Generate 3 ads" })); });
    expect(await screen.findByText(/Your ads are ready/)).toBeInTheDocument();
    expect(screen.queryByText(/couldn't be made/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Creating your campaign images and copy/)).not.toBeInTheDocument();
  });
});
