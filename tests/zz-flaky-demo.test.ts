import { expect, it } from "vitest";
// TEMPORARY #618 demo commit, removed before merge.
let tries = 0;
it("#618 demo: fails once, passes on retry", () => {
  tries += 1;
  expect(tries).toBeGreaterThan(1);
});
it("#618 demo: real failure still blocks", () => {
  expect(1).toBe(2);
});
