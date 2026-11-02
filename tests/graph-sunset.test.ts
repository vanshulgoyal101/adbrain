import { describe, expect, it } from "vitest";
import { configuredVersion, parseChangelog, sunsetProblems } from "../scripts/graph-sunset.mjs";

const row = (v: string, from: string, until: string) =>
  `<tr><td><a href="/x">v${v}</a></td><td><p>${from}</p></td><td><p>${until}</p></td></tr>`;
const html = `<h2>Available Graph API Versions</h2>${row("26.0", "July 29, 2026", "TBD")}${row("25.0", "February 18, 2026", "July 29, 2028")}`
  + `<h2>Available Marketing API Versions</h2>${row("26.0", "July 29, 2026", "TBD")}${row("24.0", "October 8, 2025", "October 6, 2026")}`;

describe("Meta API version retirement check (#1857)", () => {
  it("reads our configured version", () => {
    expect(configuredVersion('export const GRAPH_VERSION = "v26.0";')).toBe("26.0");
    expect(configuredVersion()).toMatch(/^\d+\.\d$/);
  });
  it("parses both tables", () => {
    expect(parseChangelog(html)).toEqual({ graph: { "26.0": "TBD", "25.0": "2028-07-29" }, marketing: { "26.0": "TBD", "24.0": "2026-10-06" } });
  });
  it("warns inside 90 days, when missing, and when unreadable", () => {
    const now = Date.parse("2026-08-01T00:00:00Z");
    expect(sunsetProblems(parseChangelog(html), "26.0", now)).toEqual([]);
    expect(sunsetProblems(parseChangelog(html), "24.0", now)).toEqual(["graph: v24.0 isn't in Meta's table (retired?)", "marketing: v24.0 is retired on 2026-10-06 (66 days)"]);
    expect(sunsetProblems({ graph: {}, marketing: {} }, "26.0", now)).toEqual(["graph: couldn't read Meta's version table", "marketing: couldn't read Meta's version table"]);
  });
});
