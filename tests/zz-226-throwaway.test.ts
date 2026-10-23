import { expect, it } from "vitest";

it("#226 throwaway: a failing shard must fail the required test check", () => {
  expect(1).toBe(2);
});
