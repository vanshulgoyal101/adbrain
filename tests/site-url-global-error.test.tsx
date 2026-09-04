// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import GlobalError from "@/app/global-error";
import { normalizeSiteUrl } from "@/lib/site";

describe("normalizeSiteUrl", () => {
  const fallback = "https://adbrain.vanshul.com";

  it("keeps a valid origin and strips the trailing slash", () => {
    expect(normalizeSiteUrl("https://adbrain.vanshul.com/")).toBe(fallback);
    expect(normalizeSiteUrl("  https://staging.example.com  ")).toBe(
      "https://staging.example.com",
    );
  });

  it("preserves a base path", () => {
    expect(normalizeSiteUrl("https://example.com/app/")).toBe(
      "https://example.com/app",
    );
  });

  it("falls back when the scheme is missing", () => {
    // The real hazard: `new URL()` throws on this while rendering the root
    // layout's metadataBase, which no error.tsx can catch.
    expect(normalizeSiteUrl("adbrain.vanshul.com")).toBe(fallback);
    expect(normalizeSiteUrl("not a url")).toBe(fallback);
  });

  it("rejects non-http(s) schemes that would poison canonical URLs", () => {
    expect(normalizeSiteUrl("ftp://example.com")).toBe(fallback);
    expect(normalizeSiteUrl("javascript:alert(1)")).toBe(fallback);
  });

  it("falls back on empty or missing input", () => {
    expect(normalizeSiteUrl(undefined)).toBe(fallback);
    expect(normalizeSiteUrl("   ")).toBe(fallback);
  });

  it("always yields something new URL() accepts", () => {
    for (const input of [undefined, "", "x", "ftp://a.b", "https://ok.com/"]) {
      expect(() => new URL(normalizeSiteUrl(input))).not.toThrow();
    }
  });
});

describe("<GlobalError>", () => {
  it("renders a branded recovery screen and retries on click", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const reset = vi.fn();
    const user = userEvent.setup();

    render(<GlobalError error={new Error("boom")} reset={reset} />);

    expect(
      screen.getByRole("heading", { name: /something went wrong/i }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /try again/i }));

    expect(reset).toHaveBeenCalledTimes(1);
    consoleError.mockRestore();
  });
});
