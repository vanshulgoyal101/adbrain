import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// #1101: recorded Meta tapes are scrubbed (metaScrubber(), #1040): the business's real ad account and Page ids
// become the pinned fakes act_9000000000000001 and 900000000000002. Only their SHA-256 lives here, so this test
// itself doesn't carry them.
const REAL_ID_HASHES = new Set([
  "a0dc603d0e190a7eacebca04c08c809ba4c0951895ff796c4c8b2de6494363fb", // ad account
  "3a8fc2c12bb9f7d872e13cea2633261d30f29b13494c2d218d0310a30e8db08b", // Page
]);
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

describe("core: recorded fixtures carry no real Meta account or Page id (#1101)", () => {
  it("finds no number in any fixture that hashes to the real ad account or Page", () => {
    const leaks = ["tests/core/fixtures", "tests/fixtures"].flatMap(files)
      .filter(path => /\.(json|txt|ts|html)$/.test(path))
      .filter(path => [...new Set(readFileSync(path, "utf8").match(/\d{10,}/g) ?? [])].some(id => REAL_ID_HASHES.has(sha256(id))));
    expect(leaks).toEqual([]);
  });

  it("recognises the real ids by hash (the check can fail)", () => {
    expect([...REAL_ID_HASHES].every(hash => /^[0-9a-f]{64}$/.test(hash))).toBe(true);
    expect(REAL_ID_HASHES.has(sha256("9000000000000001"))).toBe(false);
  });
});
