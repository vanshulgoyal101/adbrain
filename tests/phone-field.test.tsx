// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PhoneField } from "@/components/ui/phone-field";
import {
  COUNTRIES,
  DEFAULT_COUNTRY_CODE,
  flagEmoji,
  formatPhone,
  getCountry,
  parsePhone,
} from "@/lib/brand/countries";
import { isValidPhone } from "@/lib/brand/validation";

describe("country data", () => {
  it("has unique ISO codes and digit-only dialling codes", () => {
    const codes = COUNTRIES.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const c of COUNTRIES) {
      expect(c.code, c.name).toMatch(/^[A-Z]{2}$/);
      expect(c.dial, c.name).toMatch(/^\d{1,4}$/);
      expect(c.name.trim().length).toBeGreaterThan(0);
    }
  });

  it("lists the default country", () => {
    expect(getCountry(DEFAULT_COUNTRY_CODE).code).toBe(DEFAULT_COUNTRY_CODE);
    expect(getCountry("does-not-exist").code).toBe(DEFAULT_COUNTRY_CODE);
  });

  it("derives flags from the ISO code", () => {
    expect(flagEmoji("IN")).toBe("🇮🇳");
    expect(flagEmoji("us")).toBe("🇺🇸");
    expect(flagEmoji("bad")).toBe("");
  });
});

describe("parsePhone", () => {
  it("prefers the longest dialling code", () => {
    // "+91..." must be India, not the US (+1) swallowing the leading 9.
    expect(parsePhone("+91 98765 43210")).toEqual({
      countryCode: "IN",
      national: "98765 43210",
    });
    expect(parsePhone("+1 512 555 0134")).toEqual({
      countryCode: "US",
      national: "512 555 0134",
    });
    expect(parsePhone("+971 50 123 4567").countryCode).toBe("AE");
  });

  it("falls back to the default country when there's no code", () => {
    expect(parsePhone("98765 43210")).toEqual({
      countryCode: DEFAULT_COUNTRY_CODE,
      national: "98765 43210",
    });
    expect(parsePhone("")).toEqual({
      countryCode: DEFAULT_COUNTRY_CODE,
      national: "",
    });
    expect(parsePhone(null).national).toBe("");
  });

  it("round-trips every country without corrupting the number", () => {
    for (const c of COUNTRIES) {
      const stored = formatPhone(c.code, "12345678");
      const parsed = parsePhone(stored);
      expect(parsed.national, c.name).toBe("12345678");
      // Shared codes (+1, +7) resolve to the first listed country by design.
      expect(getCountry(parsed.countryCode).dial, c.name).toBe(c.dial);
    }
  });
});

describe("formatPhone", () => {
  it("joins the country code and number", () => {
    expect(formatPhone("IN", "98765 43210")).toBe("+91 98765 43210");
  });

  it("stores nothing when the number is blank", () => {
    // Otherwise clearing the field would save a bare "+91".
    expect(formatPhone("IN", "")).toBe("");
    expect(formatPhone("IN", "   ")).toBe("");
  });

  it("produces values the validator accepts", () => {
    expect(isValidPhone(formatPhone("US", "512 555 0134"))).toBe(true);
    expect(isValidPhone(formatPhone("IN", "98765 43210"))).toBe(true);
  });
});

describe("<PhoneField>", () => {
  it("shows the stored country and national number separately", () => {
    render(
      <PhoneField name="phone" value="+1 512 555 0134" onChange={vi.fn()} />,
    );
    expect(
      (screen.getByLabelText(/country calling code/i) as HTMLSelectElement).value,
    ).toBe("US");
    expect(screen.getByDisplayValue("512 555 0134")).toBeInTheDocument();
  });

  it("keeps the number when the country changes", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <PhoneField name="phone" value="+91 98765 43210" onChange={onChange} />,
    );
    await user.selectOptions(
      screen.getByLabelText(/country calling code/i),
      "US",
    );
    expect(onChange).toHaveBeenCalledWith("+1 98765 43210");
  });

  it("submits one combined value for the server action", () => {
    const { container } = render(
      <PhoneField name="phone" value="+91 98765 43210" onChange={vi.fn()} />,
    );
    const hidden = container.querySelector<HTMLInputElement>(
      'input[type="hidden"][name="phone"]',
    );
    expect(hidden?.value).toBe("+91 98765 43210");
  });
});
