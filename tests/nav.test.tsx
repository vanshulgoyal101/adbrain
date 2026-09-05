// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Nav } from "@/components/nav";

const pathname = vi.fn();
vi.mock("next/navigation", () => ({ usePathname: () => pathname() }));

const ACTIVE = "bg-blue-50";

beforeEach(() => pathname.mockReturnValue("/dashboard"));

describe("<Nav>", () => {
  it("links to every section of the app", () => {
    render(<Nav />);
    const expected: [string, string][] = [
      ["Home", "/dashboard"],
      ["Create", "/create"],
      ["Brand Brain", "/brand"],
      ["Review", "/studio"],
      ["Launch", "/campaigns"],
      ["Results", "/leads"],
      ["Assets", "/assets"],
      ["Settings", "/settings"],
    ];
    for (const [label, href] of expected) {
      expect(screen.getByRole("link", { name: label })).toHaveAttribute("href", href);
    }
  });

  it("highlights only the current section", () => {
    pathname.mockReturnValue("/campaigns");
    render(<Nav />);
    expect(screen.getByRole("link", { name: "Launch" })).toHaveClass(ACTIVE);
    expect(screen.getByRole("link", { name: "Home" })).not.toHaveClass(ACTIVE);
  });

  it("keeps the section highlighted on nested routes", () => {
    pathname.mockReturnValue("/campaigns/abc123");
    render(<Nav />);
    expect(screen.getByRole("link", { name: "Launch" })).toHaveClass(ACTIVE);
  });

  it("does not highlight a section that merely shares a prefix", () => {
    // "/create" must not light up "/campaigns" (or vice versa).
    pathname.mockReturnValue("/create");
    render(<Nav />);
    expect(screen.getByRole("link", { name: "Create" })).toHaveClass(ACTIVE);
    expect(screen.getByRole("link", { name: "Launch" })).not.toHaveClass(ACTIVE);
  });

  it("switches to a horizontal layout for the mobile header", () => {
    const { container } = render(<Nav orientation="horizontal" />);
    expect(container.querySelector("nav")).toHaveClass("flex-row");
  });
});
