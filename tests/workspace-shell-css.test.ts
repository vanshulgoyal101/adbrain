import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("src/components/workspace-shell.module.css", "utf8");

describe("workspace drawer touch targets (#2748)", () => {
  it("gives the drawer logo link a 44px hit area", () => {
    expect(css).toMatch(/\.drawerHeading \.logo \{[^}]*min-height: 44px/);
  });
});
