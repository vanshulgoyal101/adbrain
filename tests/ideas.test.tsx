// @vitest-environment jsdom
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import IdeasPage from "@/app/ideas/page";
import IdeaPage, { generateStaticParams } from "@/app/ideas/[slug]/page";
import { IDEAS } from "@/lib/ideas";
import { takePendingIdea } from "@/lib/ideas/pending";

beforeEach(() => localStorage.clear());

describe("/ideas gallery (#289)", () => {
  it("has 10 industries with 3 real ads each, every image shipped, and no phone numbers on them", () => {
    expect(IDEAS).toHaveLength(10);
    for (const idea of IDEAS) {
      expect(idea.ads, idea.slug).toHaveLength(3);
      for (const ad of idea.ads) {
        expect(existsSync(join(process.cwd(), "public", ad.image)), ad.image).toBe(true);
        expect(`${ad.headline} ${ad.primaryText}`).not.toMatch(/\+?\d[\d\s-]{8,}\d/);
      }
      expect(idea.brand.phone ?? null).toBeNull();
    }
    expect(generateStaticParams().map(({ slug }) => slug)).toEqual(IDEAS.map(({ slug }) => slug));
  });

  it("labels the businesses as examples and links each industry", () => {
    render(<IdeasPage />);
    expect(screen.getByText(/example businesses, not customers/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Coaching/ })).toHaveAttribute("href", "/ideas/coaching-institute");
  });

  it("'Make one like this' carries the idea's goal into Create once", async () => {
    render(await IdeaPage({ params: Promise.resolve({ slug: "gym" }) }));
    expect(screen.getAllByRole("img", { name: /^Ad \d: / })).toHaveLength(3);
    const make = screen.getByRole("link", { name: "Make one like this" });
    expect(make).toHaveAttribute("href", "/create");
    fireEvent.click(make);
    expect(takePendingIdea()).toBe(IDEAS.find((idea) => idea.slug === "gym")!.goal);
    expect(takePendingIdea()).toBeNull();
  });
});
