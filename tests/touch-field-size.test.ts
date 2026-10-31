import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// #1793: iOS Safari zooms the page into any focused field under 16px, and our xs/sm/base sizes are 13/15/15px.
// jsdom has no layout or media queries, so guard the CSS itself.
const globals = readFileSync("src/app/globals.css", "utf8");
const inbox = readFileSync("src/components/lead-inbox.module.css", "utf8");

function coarseBlock() {
  const start = globals.indexOf("@media (pointer: coarse)");
  expect(start).toBeGreaterThan(-1);
  return globals.slice(start, globals.indexOf("\n}\n", start));
}

describe("form fields on touch screens (#1793)", () => {
  it("lifts the small text sizes to 16px inside inputs, textareas and selects", () => {
    const block = coarseBlock();
    for (const field of ["input", "textarea", "select"]) expect(block).toMatch(new RegExp(`\\b${field}\\b`));
    for (const size of ["xs", "sm", "base"]) expect(block).toContain(`--text-${size}: 1rem`);
  });

  it("keeps the enquiry search and filter on the theme sizes the touch rule lifts", () => {
    expect(inbox).toMatch(/\.search input \{[^}]*font-size: var\(--text-sm\)/);
    expect(inbox).toMatch(/\.toolbar select \{[^}]*font-size: var\(--text-xs\)/);
  });

  // The variables only lift a field that reads them itself; a field inheriting a parent's 15px still zooms.
  it("gives fields that would inherit 15px their own theme size", () => {
    expect(inbox).toMatch(/\.editor select, \.editor textarea \{[^}]*font-size: var\(--text-sm\)/);
    const ageInputs = readFileSync("src/components/targeting-controls.tsx", "utf8").match(/className="h-10 w-20 [^"]*"/g) ?? [];
    expect(ageInputs).toHaveLength(2);
    for (const className of ageInputs) expect(className).toContain(" text-sm ");
  });
});
