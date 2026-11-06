import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { compareScreenshots, isHydrationError, isVisualRegression, missingScreens } from "../scripts/lib/ui-visual.mjs";

async function image(width: number, height: number, pixels: Uint8Array) {
  return sharp(pixels, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

describe("phone screenshot comparison (#2748)", () => {
  it("counts meaningful pixel changes, not identical images or tiny channel noise", async () => {
    const base = new Uint8Array(100 * 10 * 3);
    const changed = base.slice();
    changed[0] = 8;
    changed[3] = 9;
    const before = await image(100, 10, base);
    expect(await compareScreenshots(before, before)).toMatchObject({ changedPixels: 0, totalPixels: 1000, dimensionsChanged: false });
    expect(await compareScreenshots(before, await image(100, 10, changed))).toMatchObject({
      changedPixels: 1, totalPixels: 1000, dimensionsChanged: false,
    });
  });

  it("fails when more than 0.1% of pixels differ or the screenshot dimensions change", async () => {
    const pixels = new Uint8Array(100 * 10 * 3);
    const before = await image(100, 10, pixels);
    const one = pixels.slice();
    one[0] = 255;
    const two = one.slice();
    two[3] = 255;
    expect(isVisualRegression(await compareScreenshots(before, await image(100, 10, one)))).toBe(false);
    expect(isVisualRegression(await compareScreenshots(before, await image(100, 10, two)))).toBe(true);
    expect(isVisualRegression(await compareScreenshots(before, await image(50, 20, pixels)))).toBe(true);
  });

  it("does not turn a missing or invalid screenshot into a passing comparison", async () => {
    const before = await image(1, 1, new Uint8Array(3));
    await expect(compareScreenshots(before, Buffer.from("not an image"))).rejects.toThrow();
    await expect(compareScreenshots(before, "/missing/phone-screenshot.png")).rejects.toThrow();
  });

  it("recognizes hydration failures without treating unrelated console errors as hydration", () => {
    expect(isHydrationError("Hydration failed because the server rendered HTML didn't match the client")).toBe(true);
    expect(isHydrationError("Minified React error #418")).toBe(true);
    expect(isHydrationError("Text content did not match. Server: a Client: b")).toBe(true);
    expect(isHydrationError("Failed to load resource")).toBe(false);
  });

  it("reports required screens missing from either side of the comparison", () => {
    expect(missingScreens(["brand@360", "review@360"], { "brand@360": {} }, { "review@360": {} })).toEqual([
      "baseline: review@360", "head: brand@360",
    ]);
  });

  it("makes screenshot and hydration regressions fail the actual comparison command", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ui-gate-test-"));
    const before = join(directory, "before");
    const after = join(directory, "after");
    const names = ["home", "login", "ideas", "idea", "privacy", "terms", "guides", "dashboard", "brand", "create", "review", "campaigns", "enquiries", "assets", "settings", "connect", "menu"];
    const metric = { axe: 0, lcpMs: 100, cls: 0, under44: 0, overflowPx: 0, pageErrors: 0, hydrationErrors: 0 };
    const pages = Object.fromEntries(names.map((name) => [`${name}@360`, { ...metric }]));
    const run = (...extra: string[]) => spawnSync(process.execPath, [
      "scripts/ui-gate.mjs", "--synthetic", "--low-end", "--visual", "--compare-only",
      "--compare", before, "--out", after, ...extra,
    ], { cwd: process.cwd(), encoding: "utf8" });
    try {
      await Promise.all([mkdir(before), mkdir(after)]);
      const black = await image(1, 1, new Uint8Array(3));
      const white = await image(1, 1, new Uint8Array([255, 255, 255]));
      await Promise.all(names.flatMap((name) => [
        writeFile(join(before, `${name}-360.png`), black),
        writeFile(join(after, `${name}-360.png`), name === "brand" ? white : black),
      ]));
      await Promise.all([before, after].map((dir) => writeFile(join(dir, "report.json"), JSON.stringify({ pages }))));

      expect(run().status).toBe(1);
      expect(run("--allow-visual-changes").status).toBe(0);
      pages["review@360"].hydrationErrors = 1;
      delete pages["connect@360"];
      await writeFile(join(after, "report.json"), JSON.stringify({ pages }));
      const failures = run("--allow-visual-changes");
      expect(failures.status).toBe(1);
      expect(failures.stdout).toMatch(/review@360.*WORSE: hydration/);
      expect(failures.stdout).toContain("missing screen: head: connect@360");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 90_000);
});
