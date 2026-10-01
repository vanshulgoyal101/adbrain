// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Nav } from "@/components/nav";
import { WorkspaceShell } from "@/components/workspace-shell";

const pathname = vi.fn();
const linkState = vi.hoisted(() => ({ pending: false }));
vi.mock("next/link", async (importOriginal) => ({
  ...await importOriginal<typeof import("next/link")>(),
  default: ({ href, prefetch, ...props }: React.ComponentProps<"a"> & { prefetch?: boolean | null }) => <a href={href} data-prefetch={String(prefetch)} {...props} />,
  useLinkStatus: () => linkState,
}));
vi.mock("next/navigation", () => ({ usePathname: () => pathname() }));
vi.mock("@/components/sign-out-button", () => ({ SignOutButton: () => null }));

const ACTIVE = "bg-blue-50";

beforeEach(() => { pathname.mockReturnValue("/dashboard"); linkState.pending = false; localStorage.clear(); });

describe("<Nav>", () => {
  it("shows saved enquiries before the first visit", async () => {
    const fetcher = vi.fn<(url: string) => Promise<Response>>(async () => Response.json({ count: 4 }));
    vi.stubGlobal("fetch", fetcher);
    render(<WorkspaceShell email={null} businessName="Fixture" ownerId="owner" businessId="business"><p>Workspace</p></WorkspaceShell>);
    expect(await within(screen.getByRole("navigation", { name: "Workspace navigation" })).findByText("4")).toBeInTheDocument();
    expect(new URL(fetcher.mock.calls[0][0], "http://localhost").searchParams.get("since")).toBe("1970-01-01T00:00:00.000Z");
  });

  it("shows the owner-scoped new enquiry count and clears it after viewing the inbox", async () => {
    const key = "lead-viewed:owner:business";
    const importedAt = Date.now() - 5_000;
    localStorage.setItem(key, new Date(importedAt - 60_000).toISOString());
    const fetcher = vi.fn(async (url: string) => Response.json({ count: new Date(new URL(url, "http://localhost").searchParams.get("since")!).getTime() < importedAt ? 2 : 0 }));
    vi.stubGlobal("fetch", fetcher);
    const shell = () => <WorkspaceShell email="owner@example.invalid" businessName="Fixture" ownerId="owner" businessId="business"><p>Workspace</p></WorkspaceShell>;
    const view = render(shell());
    const navigation = within(screen.getByRole("navigation", { name: "Workspace navigation" }));
    expect(await navigation.findByText("2")).toBeInTheDocument();
    expect(fetcher.mock.calls[0][0]).toContain("/api/leads/unseen?since=");
    pathname.mockReturnValue("/leads");
    view.rerender(shell());
    await waitFor(() => expect(navigation.queryByText("2")).toBeNull());
    expect(new Date(localStorage.getItem(key)!).getTime()).toBeGreaterThan(importedAt);
    pathname.mockReturnValue("/dashboard");
    view.rerender(shell());
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    expect(navigation.queryByText("2")).toBeNull();
  });

  it("ignores an old business count that resolves after switching workspaces", async () => {
    const oldViewedAt = new Date(Date.now() - 60_000).toISOString();
    localStorage.setItem("lead-viewed:owner:business-a", oldViewedAt);
    localStorage.setItem("lead-viewed:owner:business-b", new Date().toISOString());
    let finishOld!: (response: Response) => void;
    let oldSignal: AbortSignal | undefined;
    vi.stubGlobal("fetch", vi.fn((url: string, options: RequestInit) => {
      if (new URL(url, "http://localhost").searchParams.get("since") === oldViewedAt) {
        oldSignal = options.signal as AbortSignal;
        return new Promise<Response>(resolve => { finishOld = resolve; });
      }
      return Promise.resolve(Response.json({ count: 0 }));
    }));
    const shell = (businessId: string) => <WorkspaceShell email={null} businessName="Fixture" ownerId="owner" businessId={businessId}><p>Workspace</p></WorkspaceShell>;
    const view = render(shell("business-a"));
    await waitFor(() => expect(oldSignal).toBeDefined());
    view.rerender(shell("business-b"));
    expect(oldSignal?.aborted).toBe(true);
    await act(async () => finishOld(Response.json({ count: 7 })));
    expect(within(screen.getByRole("navigation", { name: "Workspace navigation" })).queryByText("7")).toBeNull();
  });

  it.each(["mouseEnter", "focus", "touchStart"] as const)("enables full destination prefetch on %s while leaving other links at their default", (event) => {
    render(<Nav />);
    const link = screen.getByRole("link", { name: "Campaigns" });
    expect(link).toHaveAttribute("data-prefetch", "null");
    fireEvent[event](link);
    fireEvent.focus(link);
    expect(link).toHaveAttribute("data-prefetch", "true");
    expect(screen.getByRole("link", { name: "Review" })).toHaveAttribute("data-prefetch", "null");
  });

  it("does not warm the current section", () => {
    render(<Nav />);
    fireEvent.mouseEnter(screen.getByRole("link", { name: "Home" }));
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("data-prefetch", "null");
  });

  it("acknowledges pending navigation without changing the link label or icon dimensions", () => {
    linkState.pending = true;
    render(<Nav />);
    const link = screen.getByRole("link", { name: "Home" });
    expect(screen.getByText("Home")).toHaveAttribute("aria-busy", "true");
    expect(link.querySelector("svg")).toHaveClass("h-4", "w-4", "animate-spin");
  });

  it("links to every section of the app", () => {
    render(<Nav />);
    const expected: [string, string][] = [
      ["Home", "/dashboard"],
      ["Create", "/create"],
      ["Brand Brain", "/brand"],
      ["Review", "/studio"],
      ["Campaigns", "/campaigns"],
      ["Enquiries", "/leads"],
      ["Assets", "/assets"],
      ["Settings", "/settings"],
    ];
    for (const [label, href] of expected) {
      expect(screen.getByRole("link", { name: label })).toHaveAttribute(
        "href",
        href,
      );
    }
  });

  it("highlights only the current section", () => {
    pathname.mockReturnValue("/campaigns");
    render(<Nav />);
    expect(screen.getByRole("link", { name: "Campaigns" })).toHaveClass(ACTIVE);
    expect(screen.getByRole("link", { name: "Campaigns" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Home" })).not.toHaveAttribute(
      "aria-current",
    );
    expect(screen.getByRole("link", { name: "Home" })).not.toHaveClass(ACTIVE);
  });

  it("keeps the section highlighted on nested routes", () => {
    pathname.mockReturnValue("/campaigns/abc123");
    render(<Nav />);
    expect(screen.getByRole("link", { name: "Campaigns" })).toHaveClass(ACTIVE);
  });

  it("does not highlight a section that merely shares a prefix", () => {
    // "/create" must not light up "/campaigns" (or vice versa).
    pathname.mockReturnValue("/create");
    render(<Nav />);
    expect(screen.getByRole("link", { name: "Create" })).toHaveClass(ACTIVE);
    expect(screen.getByRole("link", { name: "Campaigns" })).not.toHaveClass(
      ACTIVE,
    );
  });

  it("switches to a horizontal layout for the mobile header", () => {
    const { container } = render(<Nav orientation="horizontal" />);
    expect(container.querySelector("nav")).toHaveClass("flex-row");
    expect(screen.getByRole("link", { name: "Create" })).toHaveClass(
      "text-slate-700",
    );
    expect(screen.getByRole("navigation")).toHaveAttribute(
      "aria-label",
      "Workspace navigation",
    );
  });
});
