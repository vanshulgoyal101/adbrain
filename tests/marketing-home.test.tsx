// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { MarketingHome } from "@/components/marketing-home";
import { LEGAL_LINKS } from "@/lib/legal-links";

describe("public product example", () => {
  it("labels the example without claiming a live generation or customer result", () => {
    render(<MarketingHome />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("AdBrain");
    expect(screen.getByText(/Not a customer campaign or a live AI generation/)).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /illustrative ad photograph/ })).toHaveAttribute("src");
    expect(screen.getByRole("heading", { name: "Created paused" })).toBeInTheDocument();
  });

  it("switches the headline, copy, and call to action together", async () => {
    const user = userEvent.setup();
    render(<MarketingHome />);
    const ad = within(screen.getByRole("article", { name: "Sample ad" }));
    expect(ad.getByRole("heading")).toHaveTextContent("A sunny day. A new possibility.");
    await user.click(screen.getByRole("radio", { name: "Answer a question" }));
    expect(ad.getByRole("heading")).toHaveTextContent("Is your home ready for solar?");
    expect(ad.getByText(/Every home is different/)).toBeInTheDocument();
    expect(ad.getByText("Explore your options")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Answer a question" })).toBeChecked();
    await user.keyboard("{ArrowLeft}");
    expect(screen.getByRole("radio", { name: "Start a conversation" })).toBeChecked();
    expect(ad.getByText("Book a consultation")).toBeInTheDocument();
  });

  it("keeps conversion, example, and legal navigation accessible", () => {
    const { container } = render(<MarketingHome />);
    expect(screen.getByRole("link", { name: "Create your first ad" })).toHaveAttribute("href", "/login");
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
    expect(screen.getByRole("link", { name: "Explore an example" })).toHaveAttribute("href", "#example");
    expect(container.querySelector("#example")).toBeInTheDocument();
    expect(container.querySelector("a button")).toBeNull();
    for (const link of LEGAL_LINKS) expect(screen.getByRole("link", { name: link.label })).toHaveAttribute("href", link.href);
  });
});