import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// #1503: Hindi and Punjabi need taller lines than Latin, or matras above and below the letters touch the next line.
const css = readFileSync("src/app/globals.css", "utf8");
const indicBlock = css.match(/:lang\(hi\)[^{]*\{([^}]*)\}/)?.[1] ?? "";
const leading = (block: string, size: string) => Number(block.match(new RegExp(`--text-${size}--line-height:\\s*([\\d.]+)`))?.[1]);

describe("Indian scripts in the type system (#1503)", () => {
  it("one font stack: DM Sans for Latin, then the phone's own Devanagari and Gurmukhi faces", () => {
    const stack = css.match(/--font-sans:\s*([^;]+);/)?.[1] ?? "";
    expect(stack).toMatch(/^"DM Sans Variable", "Noto Sans Devanagari", "Kohinoor Devanagari", "Noto Sans Gurmukhi", "Mukta Mahee", sans-serif$/);
    expect(css).toMatch(/body\s*\{[^}]*font-family:\s*var\(--font-sans\);/);
  });

  it("Hindi, Marathi and Punjabi text gets taller lines at every size", () => {
    expect(css).toMatch(/:lang\(hi\),\s*:lang\(mr\),\s*:lang\(pa\)\s*\{/);
    for (const size of ["xs", "sm", "base"]) expect(leading(indicBlock, size), size).toBeGreaterThanOrEqual(1.6);
    for (const size of ["lg", "xl"]) expect(leading(indicBlock, size), size).toBeGreaterThanOrEqual(1.5);
    for (const size of ["2xl", "3xl", "4xl"]) expect(leading(indicBlock, size), size).toBeGreaterThanOrEqual(1.35);
    expect(indicBlock).toMatch(/line-height:\s*1\.7/);
  });
});
