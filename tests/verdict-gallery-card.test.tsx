// @vitest-environment jsdom
// #1841 (Designer's walk of /settings/verdicts): every action a card can offer shows on the walk page, and the newer states are there.
import { fireEvent, render, screen } from "@testing-library/react";
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

  it("#1795: no 'Ended · Ended' or 'Paused · Live': a word that only restates the status is dropped", () => {
    render(<><VerdictGalleryCard card={card("Ended, it worked")} /><VerdictGalleryCard card={card("New audience waiting")} /></>);
    expect(screen.getByText("Ended")).toBeInTheDocument();
    expect(screen.getByText("Paused")).toBeInTheDocument();
    expect(screen.queryByText(/· (Live|Ended)$/)).not.toBeInTheDocument();
  });

  it("the newer states: deleted in Meta, and a new audience waiting", () => {
    const { unmount } = render(<VerdictGalleryCard card={card("Deleted in Meta")} />);
    expect(screen.getByText(/deleted in Meta Ads Manager, so it can't run or be changed here/)).toBeInTheDocument();
    unmount();
    render(<VerdictGalleryCard card={card("New audience waiting")} />);
    expect(screen.getByText("New audience ready")).toBeInTheDocument();
  });

  it("#1854: an IELTS job/visa rejection says so, and Edit the words shows the hint the editor opens with", async () => {
    render(<VerdictGalleryCard card={card("IELTS: read as a job or visa offer")} />);
    expect(screen.getByText(/Meta read this as a job or visa offer\. Keep it about the course/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit the words" }));
    expect(screen.getByRole("status")).toHaveTextContent("Opens the words editor with: Add your licence number as the last line, e.g. 'Punjab licence no. 123'.");
  });

  it("#1854: interiors' property reading is fixed by editing the words", () => {
    render(<VerdictGalleryCard card={card("Interiors: read as a property ad")} />);
    expect(screen.getByText(/Meta read this as a property ad\./)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit the words" })).toBeInTheDocument();
  });

  it("one Details per card, also with a rejected ad", () => {
    render(<VerdictGalleryCard card={card("1 of 3 ads rejected")} />);
    expect(screen.getAllByText("Details")).toHaveLength(1);
  });
});
