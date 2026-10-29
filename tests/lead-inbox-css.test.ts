import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// #1819: jsdom has no layout, so guard the cascade order. `tr[data-actions="none"] .followUp` and
// `tr:not([data-state="new"]) .followUp` have equal specificity; if the :not() rule comes later it wins, and a
// test lead's ⋯ lands alone on a line above the name (seen live at 390 and 1440).
const css = readFileSync("src/components/lead-inbox.module.css", "utf8");

function mediaBlock(query: string) {
  const start = css.indexOf(`@media (${query})`);
  expect(start).toBeGreaterThan(-1);
  const end = css.indexOf("\n}\n", start);
  return css.slice(start, end);
}

describe("lead inbox rows without actions (#1819)", () => {
  it.each([
    ["max-width: 900px", ""],
    ["min-width: 1280px", ".panes "],
  ])("keeps ⋯ on the name row in the %s layout", (query, prefix) => {
    const block = mediaBlock(query);
    const actionsNone = block.indexOf(`${prefix}tr[data-actions="none"] .followUp`);
    const notNew = block.indexOf(`${prefix}tr:not([data-state="new"]) .followUp`);
    expect(actionsNone).toBeGreaterThan(-1);
    expect(notNew).toBeGreaterThan(-1);
    expect(actionsNone).toBeGreaterThan(notNew);
  });
});
