import { describe, expect, it } from "vitest";
import { parseLeadFields } from "@/lib/leads/parse";
import { buildLeadDigest, relativeAge } from "@/lib/leads/digest";

describe("parseLeadFields", () => {
  it("extracts common fields regardless of exact field names", () => {
    const parsed = parseLeadFields([
      { name: "full_name", values: ["Rahul Sharma"] },
      { name: "phone_number", values: ["+91 98765 43210"] },
      { name: "email", values: ["Rahul@Example.COM"] },
      { name: "city", values: ["Jaipur"] },
    ]);
    expect(parsed.fullName).toBe("Rahul Sharma");
    expect(parsed.phone).toBe("+919876543210");
    expect(parsed.email).toBe("rahul@example.com");
    expect(parsed.city).toBe("Jaipur");
  });

  it("falls back to first + last name", () => {
    const parsed = parseLeadFields([
      { name: "first_name", values: ["Asha"] },
      { name: "last_name", values: ["Verma"] },
    ]);
    expect(parsed.fullName).toBe("Asha Verma");
  });

  it("keeps the raw normalized field map and handles empties", () => {
    const parsed = parseLeadFields([
      { name: "What is your budget?", values: ["₹2,00,000"] },
      { name: "", values: ["ignored"] },
    ]);
    expect(parsed.fields["what is your budget?"]).toBe("₹2,00,000");
    expect(parsed.fullName).toBeNull();
    expect(parsed.phone).toBeNull();
  });

  it("tolerates null/undefined input", () => {
    expect(parseLeadFields(null).fullName).toBeNull();
    expect(parseLeadFields(undefined).fields).toEqual({});
  });
});

describe("relativeAge", () => {
  const now = new Date("2026-08-12T12:00:00Z");
  it("formats compact ages", () => {
    expect(relativeAge("2026-08-12T11:59:40Z", now)).toBe("just now");
    expect(relativeAge("2026-08-12T11:30:00Z", now)).toBe("30m ago");
    expect(relativeAge("2026-08-12T09:00:00Z", now)).toBe("3h ago");
    expect(relativeAge("2026-08-10T12:00:00Z", now)).toBe("2d ago");
  });
  it("returns empty for missing/invalid", () => {
    expect(relativeAge(null, now)).toBe("");
    expect(relativeAge("not-a-date", now)).toBe("");
  });
});

describe("buildLeadDigest", () => {
  const now = new Date("2026-08-12T12:00:00Z");
  const businessName = "Solaride";

  it("summarizes recent leads with names, phones and ages", () => {
    const out = buildLeadDigest(
      [
        {
          fullName: "Rahul Sharma",
          phone: "+919876543210",
          city: "Jaipur",
          createdTime: "2026-08-12T10:00:00Z",
        },
        {
          fullName: "Asha Verma",
          phone: null,
          city: "Kota",
          createdTime: "2026-08-11T12:00:00Z",
        },
      ],
      { businessName, now, windowDays: 7 },
    );
    expect(out).toContain("Solaride: 2 new leads");
    expect(out).toContain("1. Rahul Sharma — +919876543210 — Jaipur (2h ago)");
    expect(out).toContain("2. Asha Verma — Kota (1d ago)");
    expect(out).toMatch(/go cold/i);
  });

  it("uses singular wording for a single lead", () => {
    const out = buildLeadDigest(
      [{ fullName: "Solo", phone: null, city: null, createdTime: "2026-08-12T11:00:00Z" }],
      { businessName, now },
    );
    expect(out).toContain("1 new lead in");
  });

  it("excludes leads outside the window", () => {
    const out = buildLeadDigest(
      [{ fullName: "Old", phone: null, city: null, createdTime: "2026-07-01T12:00:00Z" }],
      { businessName, now, windowDays: 7 },
    );
    expect(out).toMatch(/no new leads/i);
  });

  it("caps the list and reports overflow", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      fullName: `Lead ${i}`,
      phone: null,
      city: null,
      createdTime: "2026-08-12T11:00:00Z",
    }));
    const out = buildLeadDigest(many, { businessName, now, maxList: 10 });
    expect(out).toContain("…and 2 more.");
  });
});
