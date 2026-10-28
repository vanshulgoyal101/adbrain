// @vitest-environment jsdom
// #1841 (Designer's walk of /settings/verdicts): every action a card can offer shows on the walk page, and the newer states are there.
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { VerdictGalleryCard } from "@/components/verdict-gallery-card";
import { galleryCards } from "@/lib/campaign/verdict-gallery";

vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const card = (name: string) => galleryCards(Date.parse("2026-10-28T12:00:00Z")).find((item) => item.name === name)!;

describe("walk page cards (#1841)", () => {
  it("'Ended, it worked' offers Run this again, as an outline button", () => {
    render(<VerdictGalleryCard card={card("Ended, it worked")} />);
    expect(screen.getByText(/^10 chats at ₹150 each\. Run it again with the best ad first\?$/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run this again" }).className).toMatch(/border/);
  });

  it("'No chats, people opened WhatsApp' offers Edit the ad", () => {
    render(<VerdictGalleryCard card={card("No chats, people opened WhatsApp")} />);
    expect(screen.getByRole("button", { name: "Edit the ad" })).toBeInTheDocument();
  });

  it("'Early days' says the stage once: in the status line, not the sentence", () => {
    render(<VerdictGalleryCard card={card("Early days")} />);
    expect(screen.getByText("Running · Early days")).toBeInTheDocument();
    expect(screen.getByText("2 chats so far. AdBrain will tell you if it's working after 5.")).toBeInTheDocument();
  });

  it("the newer states: deleted in Meta, and a new audience waiting", () => {
    const { unmount } = render(<VerdictGalleryCard card={card("Deleted in Meta")} />);
    expect(screen.getByText(/deleted in Meta Ads Manager, so it can't run or be changed here/)).toBeInTheDocument();
    unmount();
    render(<VerdictGalleryCard card={card("New audience waiting")} />);
    expect(screen.getByText("New audience ready")).toBeInTheDocument();
  });

  it("one Details per card, also with a rejected ad", () => {
    render(<VerdictGalleryCard card={card("1 of 3 ads rejected")} />);
    expect(screen.getAllByText("Details")).toHaveLength(1);
  });
});
