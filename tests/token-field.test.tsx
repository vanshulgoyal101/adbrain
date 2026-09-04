// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TokenField } from "@/components/ui/token-field";
import { fieldList } from "@/lib/brand/fields";

/**
 * Regression guard: a location is routinely "City, State" ("Austin, Texas"), so
 * a comma cannot separate tokens. Comma-splitting silently turned one location
 * into two on every save — which would have targeted an entire US state.
 */

function view(value = "") {
  const onChange = vi.fn();
  const utils = render(
    <TokenField name="locations" value={value} onChange={onChange} placeholder="Add a city" />,
  );
  return { onChange, ...utils };
}

describe("TokenField separator", () => {
  it("keeps a comma-bearing token whole", () => {
    view("Austin, Texas\nRound Rock");
    expect(screen.getByText("Austin, Texas")).toBeInTheDocument();
    expect(screen.getByText("Round Rock")).toBeInTheDocument();
    expect(screen.queryByText("Texas")).toBeNull();
  });

  it("serialises tokens newline-separated for the form post", () => {
    const { container } = view("Austin, Texas\nRound Rock");
    const hidden = container.querySelector('input[type="hidden"][name="locations"]');
    expect(hidden).toHaveValue("Austin, Texas\nRound Rock");
  });

  it("adds a typed location containing a comma as ONE token", () => {
    const { onChange } = view("");
    const input = screen.getByPlaceholderText("Add a city");
    fireEvent.change(input, { target: { value: "Austin, Texas" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("Austin, Texas");
  });

  it("appends without merging existing tokens", () => {
    const { onChange } = view("Austin, Texas");
    const input = screen.getByPlaceholderText("Add a city");
    fireEvent.change(input, { target: { value: "Cedar Park" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("Austin, Texas\nCedar Park");
  });

  it("removes only the chosen token", () => {
    const { onChange } = view("Austin, Texas\nRound Rock");
    fireEvent.click(screen.getByRole("button", { name: /remove austin, texas/i }));
    expect(onChange).toHaveBeenCalledWith("Round Rock");
  });

  it("ignores a duplicate", () => {
    const { onChange } = view("Austin, Texas");
    const input = screen.getByPlaceholderText("Add a city");
    fireEvent.change(input, { target: { value: "austin, texas" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("locations parsing on save", () => {
  it("splits on newline only, so a US City, State survives", () => {
    expect(fieldList("Austin, Texas\nRound Rock\nCedar Park", /\n/)).toEqual([
      "Austin, Texas",
      "Round Rock",
      "Cedar Park",
    ]);
  });

  it("would have corrupted the same value under comma splitting", () => {
    // Documents the bug this replaced.
    expect(fieldList("Austin, Texas\nRound Rock", /[\n,]/)).toEqual([
      "Austin",
      "Texas",
      "Round Rock",
    ]);
  });
});
