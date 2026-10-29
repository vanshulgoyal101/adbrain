import { describe, expect, it } from "vitest";
import { checkFile, compare, lineCount, newRules, readBaseline, report, violationsOf } from "../scripts/check-boundaries.mjs";

const edge = (rule: string, from: string, to: string) => ({ rule, from, to });
const ui = edge("R1-ui-no-channels", "src/components/a.tsx", "src/lib/meta/client.ts");
const money = edge("R6-money-not-in-adapters", "src/lib/meta/connection-access.ts", "src/lib/managed/spend-cap-wiring.ts");

describe("check-boundaries (#2070)", () => {
  it("reads dependency-cruiser JSON into sorted, de-duplicated edges", () => {
    const raw = { summary: { violations: [
      { rule: { name: money.rule }, from: money.from, to: money.to },
      { rule: { name: ui.rule }, from: ui.from, to: ui.to },
      { rule: { name: ui.rule }, from: ui.from, to: ui.to },
      { rule: {}, from: "x", to: "y" },
    ] } };
    expect(violationsOf(raw)).toEqual([ui, money]);
    expect(violationsOf({})).toEqual([]);
  });

  it("passes when the code matches the baseline", () => {
    const result = compare([ui, money], [ui, money], [ui, money]);
    expect(result.ok).toBe(true);
    expect(result.perRule).toEqual([
      { rule: ui.rule, now: 1, baseline: 1, base: 1 },
      { rule: money.rule, now: 1, baseline: 1, base: 1 },
    ]);
  });

  it("fails a new edge that the baseline doesn't list", () => {
    const fresh = edge("R1-ui-no-channels", "src/components/b.tsx", "src/lib/meta/client.ts");
    const result = compare([ui, fresh], [ui]);
    expect(result.ok).toBe(false);
    expect(result.added).toEqual([fresh]);
    expect(report(result)).toContain("New violations (1)");
  });

  it("fails a fixed edge still in the baseline, so every fix shows as −N", () => {
    const result = compare([ui], [ui, money]);
    expect(result.ok).toBe(false);
    expect(result.fixed).toEqual([money]);
    expect(report(result)).toContain("baseline −1");
  });

  it("fails a baseline that grew against the base branch, even when it matches the code", () => {
    const result = compare([ui, money], [ui, money], [ui]);
    expect(result.ok).toBe(false);
    expect(result.grown).toEqual([money]);
    expect(report(result)).toContain("| R6-money-not-in-adapters | 1 | 1 | +1 |");
  });

  it("passes a slice that shrinks the baseline and prints the shrink", () => {
    const result = compare([ui], [ui], [ui, money]);
    expect(result.ok).toBe(true);
    expect(report(result)).toContain("| R6-money-not-in-adapters | 0 | 0 | −1 |");
  });
});

describe("source checks C1–C5 (#2071, #2330)", () => {
  const rules = (file: string, text: string) => checkFile(file, text).map(v => `${v.rule} ${v.to}`);
  const graphCall = "const r = await fetch(`${GRAPH}/me`);\n";

  it("C1: Graph URLs only in Meta's adapter (and the CSP)", () => {
    expect(rules("src/lib/alerts/x.ts", graphCall)).toContain("C1-graph-urls-in-meta graph.facebook.com");
    expect(rules("src/app/api/x/route.ts", 'fetch("https://graph.facebook.com/v26.0/me")')).toContain("C1-graph-urls-in-meta graph.facebook.com");
    expect(rules("src/lib/meta/x.ts", graphCall + "appSecretProof(t)")).toEqual([]);
    expect(rules("src/channels/meta/x.ts", graphCall + "appSecretProof(t)")).toEqual([]);
    expect(rules("src/lib/security/headers.ts", '"connect-src https://graph.facebook.com"')).toEqual([]);
  });

  it("C2: an adapter touches only its channel's tables and RPCs", () => {
    const text = 'db.from("meta_connections"); db.from(\n  "businesses"); db.rpc("meta_token_get"); db.rpc("plan_reserve"); Array.from(x);';
    expect(rules("src/lib/meta/x.ts", text)).toEqual(["C2-adapter-own-data rpc:plan_reserve", "C2-adapter-own-data table:businesses"]);
    expect(rules("src/channels/google/x.ts", 'db.from("meta_connections")')).toEqual(["C2-adapter-own-data table:meta_connections"]);
    expect(rules("src/services/x.ts", 'db.from("businesses")')).toEqual([]);
  });

  it("C3: every file that calls Graph references appsecret_proof", () => {
    expect(rules("src/lib/meta/x.ts", graphCall)).toEqual(["C3-appsecret-proof appSecretProof"]);
    expect(rules("src/lib/meta/x.ts", graphCall + "url += `&appsecret_proof=${p}`")).toEqual([]);
    expect(rules("src/lib/meta/graph-version.ts", "export const GRAPH = `https://graph.facebook.com/${V}`;")).toEqual([]);
  });

  it("C4: files over 400 lines are listed with their size", () => {
    expect(lineCount("")).toBe(0);
    expect(lineCount("a\nb\n")).toBe(2);
    expect(lineCount("a\nb")).toBe(2);
    expect(checkFile("src/a.ts", "x\n".repeat(400))).toEqual([]);
    expect(checkFile("src/a.ts", "x\n".repeat(401))).toEqual([{ rule: "C4-file-size", from: "src/a.ts", to: "> 400 lines", lines: 401 }]);
  });

  const big = (lines: number) => ({ rule: "C4-file-size", from: "src/big.ts", to: "> 400 lines", lines });

  it("C4: a listed big file may shrink but not grow past its ceiling", () => {
    expect(compare([big(900)], [big(900)]).ok).toBe(true);
    expect(compare([big(850)], [big(900)]).ok).toBe(true);
    const grew = compare([big(910)], [big(900)]);
    expect(grew.ok).toBe(false);
    expect(report(grew)).toContain("`src/big.ts` → `> 400 lines` (900 → 910 lines)");
  });

  it("C4: raising a ceiling in the baseline fails against the base branch", () => {
    const result = compare([big(910)], [big(910)], [big(900)]);
    expect(result.ok).toBe(false);
    expect(result.grown).toEqual([big(910)]);
    expect(compare([big(850)], [big(850)], [big(900)]).ok).toBe(true);
  });

  const english = (lines: number, from = "src/app/api/x/route.ts") => ({ rule: "C5-english-errors", from, to: "English error literals", lines });

  it("C5: counts a route's English error literals; ownerError keys, cron and internal don't count", () => {
    const text = 'json({ error: "Could not fetch" }); json({ error:\n `Site returned ${s}` }); json({ error: `${e.message} Moved.` });\n'
      + 'json({ error: await ownerError("siteRefused") }); json({ error: err.message }); const error: string = x;';
    expect(checkFile("src/app/api/x/route.ts", text)).toEqual([english(3)]);
    expect(checkFile("src/app/api/cron/x/route.ts", text)).toEqual([]);
    expect(checkFile("src/app/api/internal/x/route.ts", text)).toEqual([]);
    expect(checkFile("src/lib/x.ts", text)).toEqual([]);
  });

  it("C5: a new English error fails, in a new route or a listed one; fewer pass", () => {
    const fresh = compare([english(1, "src/app/api/y/route.ts")], []);
    expect(fresh.ok).toBe(false);
    expect(report(fresh)).toContain("New English-only errors (1)");
    const more = compare([english(4)], [english(3)]);
    expect(more.ok).toBe(false);
    expect(report(more)).toContain("(3 → 4 errors)");
    expect(report(more)).not.toContain("Big files that grew");
    expect(compare([english(2)], [english(3)]).ok).toBe(true);
    expect(compare([english(4)], [english(4)], [english(3)]).ok).toBe(false);
  });

  it("a rule the base branch's checker doesn't define yet is compared with itself", () => {
    expect(newRules('const x = "C4-file-size";', [big(900), english(3)])).toEqual([english(3)]);
    expect(newRules('"C4-file-size", "C5-english-errors"', [big(900), english(3)])).toEqual([]);
  });

  it("reads a baseline with checks, and one that predates them", () => {
    expect(readBaseline(JSON.stringify({ cruiser: [ui], checks: [big(900)] }))).toEqual({ cruiser: [ui], checks: [big(900)] });
    expect(readBaseline(JSON.stringify({ cruiser: [ui] }))).toEqual({ cruiser: [ui], checks: null });
    expect(() => readBaseline("{}")).toThrow();
    expect(() => readBaseline(JSON.stringify({ cruiser: [], checks: [{ ...big(900), lines: undefined }] }))).toThrow(/ceiling/);
  });
});
