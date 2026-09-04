// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ColorField } from "@/components/ui/color-field";
import { TokenField } from "@/components/ui/token-field";
import { BRAND_FONTS, brandFontId, fontFamilyFor } from "@/lib/brand/fonts";
import {
  isValidEmail,
  isValidHttpUrl,
  isValidPhone,
  isValidWebsite,
  validateBrandFields,
} from "@/lib/brand/validation";

describe("brand fonts", () => {
  it("maps every choice to a family the renderer can resolve", () => {
    for (const font of BRAND_FONTS) {
      expect(["sans-serif", "serif", "monospace"]).toContain(font.cssFamily);
      expect(fontFamilyFor(font.id)).toBe(font.cssFamily);
    }
  });

  it("falls back for free-text fonts saved before the picker existed", () => {
    // Older brands stored things like "Inter", which Satori cannot resolve.
    expect(fontFamilyFor("Inter")).toBe("sans-serif");
    expect(fontFamilyFor(null)).toBe("sans-serif");
    expect(brandFontId("Inter")).toBe("sans");
    expect(brandFontId("serif")).toBe("serif");
  });
});

describe("brand validation", () => {
  it("accepts real emails and rejects malformed ones", () => {
    expect(isValidEmail("hello@cedarridgechiro.com")).toBe(true);
    expect(isValidEmail("a.b+tag@sub.example.co.uk")).toBe(true);
    for (const bad of ["hello@", "@x.com", "no-at.com", "a b@x.com", "a@b"]) {
      expect(isValidEmail(bad), bad).toBe(false);
    }
  });

  it("allows a bare domain for websites but not for logo URLs", () => {
    // hostFromUrl() prepends the scheme, so bare domains are legitimate.
    expect(isValidWebsite("solaride.in")).toBe(true);
    expect(isValidWebsite("https://solaride.in")).toBe(true);
    expect(isValidWebsite("not a site")).toBe(false);
    // A logo is used directly as an <img src>, so it needs a real URL.
    expect(isValidHttpUrl("cdn.example.com/logo.png")).toBe(false);
    expect(isValidHttpUrl("https://cdn.example.com/logo.png")).toBe(true);
    expect(isValidHttpUrl("javascript:alert(1)")).toBe(false);
  });

  it("checks phone digit counts", () => {
    expect(isValidPhone("+1 512 555 0134")).toBe(true);
    expect(isValidPhone("+91 98765 43210")).toBe(true);
    expect(isValidPhone("12345")).toBe(false);
    expect(isValidPhone("call me")).toBe(false);
  });

  it("ignores empty optional fields and reports each problem once", () => {
    expect(validateBrandFields({})).toEqual([]);
    expect(validateBrandFields({ email: "", website: "" })).toEqual([]);
    const issues = validateBrandFields({ email: "nope", phone: "abc" });
    expect(issues.map((i) => i.field).sort()).toEqual(["email", "phone"]);
  });
});

describe("<ColorField>", () => {
  it("keeps the swatch and hex box in sync", async () => {
    const onChange = vi.fn();
    render(
      <ColorField name="primary_color" value="#0F766E" onChange={onChange} />,
    );
    const swatch = screen.getByLabelText(/pick colour/i) as HTMLInputElement;
    expect(swatch.value).toBe("#0f766e");
  });

  it("flags an unusable hex instead of silently ignoring it", () => {
    render(<ColorField name="primary_color" value="teal-ish" onChange={vi.fn()} />);
    expect(screen.getByText(/use a hex colour/i)).toBeInTheDocument();
  });

  it("shows no error while the field is empty", () => {
    render(<ColorField name="primary_color" value="" onChange={vi.fn()} />);
    expect(screen.queryByText(/use a hex colour/i)).not.toBeInTheDocument();
  });
});

describe("<TokenField>", () => {
  it("adds a value on Enter and keeps the comma-separated contract", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <TokenField name="languages" value="English" onChange={onChange} placeholder="Add" />,
    );
    await user.type(screen.getByPlaceholderText("Add"), "Hindi{Enter}");
    expect(onChange).toHaveBeenCalledWith("English, Hindi");
  });

  it("renders existing values as removable chips", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <TokenField name="languages" value="English, Hindi" onChange={onChange} />,
    );
    await user.click(screen.getByRole("button", { name: /remove english/i }));
    expect(onChange).toHaveBeenCalledWith("Hindi");
  });

  it("refuses duplicates regardless of case", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <TokenField name="languages" value="English" onChange={onChange} placeholder="Add" />,
    );
    await user.type(screen.getByPlaceholderText("Add"), "english{Enter}");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("submits the raw comma-separated value for the server action", () => {
    const { container } = render(
      <TokenField name="languages" value="English, Hindi" onChange={vi.fn()} />,
    );
    const hidden = container.querySelector<HTMLInputElement>(
      'input[type="hidden"][name="languages"]',
    );
    expect(hidden?.value).toBe("English, Hindi");
  });
});
