import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GRAPH, GRAPH_VERSION } from "@/lib/meta/graph-version";

// #1208: a Graph version bump changes GRAPH_VERSION; every literal pin in code, tests and recorders must follow it.
const PIN = /facebook\.com\/(v\d+\.\d+)\b|["'`]\/(v\d+\.\d+)\//g;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" || name === "fixtures" ? [] : files(path);
    return /\.(ts|tsx|mjs|js)$/.test(name) ? [path] : [];
  });
}

describe("Graph API version (#1208)", () => {
  it("is one constant", () => {
    expect(GRAPH_VERSION).toMatch(/^v\d+\.0$/);
    expect(GRAPH).toBe(`https://graph.facebook.com/${GRAPH_VERSION}`);
  });

  it("every Graph version literal in src, tests and scripts matches GRAPH_VERSION", () => {
    const stale = ["src", "tests", "scripts"].flatMap(files).flatMap((path) =>
      [...readFileSync(path, "utf8").matchAll(PIN)].map((m) => m[1] ?? m[2]).filter((v) => v !== GRAPH_VERSION).map((v) => `${path}: ${v}`));
    expect(stale).toEqual([]);
  });
});
