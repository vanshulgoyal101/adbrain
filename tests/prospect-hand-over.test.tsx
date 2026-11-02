// @vitest-environment jsdom
// #1670 (Designer #1736 frames 1–4): the rep hands a prepared business to its owner; the owner signs in on their own
// phone and Home asks "Make {business} yours?".
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ClaimBusiness } from "@/components/claim-business";
import { ProspectHandOver } from "@/components/prospect-hand-over";
import { transferChecks } from "@/lib/prospect/transfer";

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
const fetcher = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  fetcher.mockResolvedValue(Response.json({ ok: true }));
  vi.stubGlobal("fetch", fetcher);
});
const sent = () => fetcher.mock.calls.map(([url, init]) => [url, init?.method, JSON.parse(init?.body ?? "null")]);

describe("ClaimBusiness: the owner's question on Home (frame 3)", () => {
  const claim = { transferId: "11111111-1111-4111-8111-111111111111", businessName: "Nook and Grain Modular Kitchens", ads: 3, images: ["https://x.supabase.co/a.png", "https://x.supabase.co/b.png"] };

  it("asks with the business's name, shows the ads, and Make it mine takes it", async () => {
    render(<ClaimBusiness claim={claim} email="gurpreet@example.com" />);
    expect(screen.getByRole("heading", { name: "Make Nook and Grain Modular Kitchens yours?" })).toBeInTheDocument();
    expect(screen.getByText(/your business details and 3 ads\. Making it yours signs everyone else out of it\./)).toBeInTheDocument();
    expect(screen.getAllByRole("img")).toHaveLength(2);
    expect(screen.getByText("Signed in as gurpreet@example.com")).toBeInTheDocument();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Make it mine" })));
    expect(sent()).toEqual([["/api/prospect/claim", "POST", { transferId: claim.transferId, decision: "accept" }]]);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/dashboard?handed=1"));
  });

  it("'This isn't my business' turns it down", async () => {
    render(<ClaimBusiness claim={claim} email="gurpreet@example.com" />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "This isn't my business" })));
    expect(sent()).toEqual([["/api/prospect/claim", "POST", { transferId: claim.transferId, decision: "decline" }]]);
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
  });

  it("says why when it can't", async () => {
    fetcher.mockResolvedValueOnce(Response.json({ error: "This email already has an AdBrain business; use another email or ask AdBrain" }, { status: 409 }));
    render(<ClaimBusiness claim={claim} email="gurpreet@example.com" />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Make it mine" })));
    expect(await screen.findByRole("alert")).toHaveTextContent("This email already has an AdBrain business");
    expect(router.replace).not.toHaveBeenCalled();
  });
});

describe("ProspectHandOver: the rep's Settings (frames 1, 1b, 2)", () => {
  const base = { businessId: "22222222-2222-4222-8222-222222222222", businessName: "Nook and Grain Modular Kitchens", ads: 3 };

  it("both checks pass: the owner's email enables Hand to owner, which starts it", async () => {
    render(<ProspectHandOver {...base} checks={transferChecks(null)} latest={null} />);
    expect(screen.getByRole("heading", { name: "Hand this account to the owner" })).toBeInTheDocument();
    expect(screen.getByText("Nook and Grain Modular Kitchens · 3 ads")).toBeInTheDocument();
    expect(screen.getByText("No Meta account connected")).toBeInTheDocument();
    expect(screen.getByText("No campaigns made")).toBeInTheDocument();
    const hand = screen.getByRole("button", { name: "Hand to owner" });
    expect(hand).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Owner's email"), { target: { value: "gurpreet@example.com" } });
    expect(hand).toBeEnabled();
    await act(async () => fireEvent.click(hand));
    expect(sent()).toEqual([["/api/prospect/transfer", "POST", { businessId: base.businessId, ownerEmail: "gurpreet@example.com" }]]);
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
  });

  it("a failed check says what to do, and Hand to owner stays off", () => {
    render(<ProspectHandOver {...base} checks={transferChecks("public.meta_connections")} latest={null} />);
    fireEvent.change(screen.getByLabelText("Owner's email"), { target: { value: "gurpreet@example.com" } });
    expect(screen.getByText(/A Meta account is connected\. The owner connects their own after taking over\./)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hand to owner" })).toBeDisabled();
  });

  it("waiting: who, until when, the owner's three steps, and Cancel hand-over", async () => {
    const latest = { targetEmail: "gurpreet@example.com", state: "pending" as const, expiresAt: "2026-10-28T11:12:00Z", updatedAt: "2026-10-28T10:42:00Z" };
    render(<ProspectHandOver {...base} checks={transferChecks(null)} latest={latest} />);
    expect(screen.getByRole("heading", { name: "Waiting for the owner" })).toBeInTheDocument();
    expect(screen.getByText("gurpreet@example.com")).toBeInTheDocument();
    expect(screen.getByText(/^Ends at /)).toBeInTheDocument();
    expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "Open adbrain.vanshul.com/login", "Continue with Google, or Email me a sign-in link, as this email", "Tap Make it mine",
    ]);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Cancel hand-over" })));
    expect(sent()).toEqual([["/api/prospect/transfer", "DELETE", { businessId: base.businessId }]]);
  });

  it("an owner who said it isn't theirs is shown, and the rep can start again", () => {
    const latest = { targetEmail: "wrong@example.com", state: "declined" as const, expiresAt: "2026-10-28T11:12:00Z", updatedAt: "2026-10-28T10:50:00Z" };
    render(<ProspectHandOver {...base} checks={transferChecks(null)} latest={latest} />);
    expect(screen.getByText("wrong@example.com said this isn't their business. Check the email with the owner.")).toBeInTheDocument();
    expect(screen.getByLabelText("Owner's email")).toBeInTheDocument();
  });
});
