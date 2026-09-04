import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guards the "referenced but never served" class of bug: an icon, image or
 * internal link that looks fine in source but 404s in production, silently
 * degrading to a browser default. Both checks are derived from the source tree,
 * so new references are covered automatically.
 */

const root = process.cwd();
const srcDir = join(root, "src");
const appDir = join(srcDir, "app");
const publicDir = join(root, "public");

const sourceFiles = readdirSync(srcDir, { recursive: true, encoding: "utf8" })
  .filter((f) => /\.tsx?$/.test(f))
  .map((f) => join(srcDir, f));

/** Metadata routes Next generates at request time rather than serving from public/. */
const GENERATED_ROUTES: Record<string, string> = {
  "/sitemap.xml": "sitemap.ts",
  "/robots.txt": "robots.ts",
  "/manifest.webmanifest": "manifest.ts",
};

const ASSET_REF = /["'](\/[A-Za-z0-9._/-]+\.(?:png|jpe?g|svg|ico|webp|webmanifest|txt|xml|woff2?))["']/g;
const HREF_REF = /href=["'](\/[a-z0-9-]*)["']/g;

function collect(pattern: RegExp): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const file of sourceFiles) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(pattern)) {
      const ref = m[1];
      found.set(ref, [...(found.get(ref) ?? []), file.replace(`${root}/`, "")]);
    }
  }
  return found;
}

/** `src/app/(app)/brand/page.tsx` -> `/brand` (route groups aren't part of the URL). */
function routeOf(pageFile: string): string {
  return (
    pageFile
      .replace(/\/page\.tsx$/, "")
      .replace(/\([^/]+\)\/?/g, "")
      .replace(/\/$/, "")
      .replace(/^(?!\/)/, "/") || "/"
  );
}

const routes = new Set(
  readdirSync(appDir, { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith("page.tsx"))
    .map((f) => routeOf(`/${f}`)),
);

describe("static asset references", () => {
  const refs = collect(ASSET_REF);

  it("finds asset references to check", () => {
    expect(refs.size).toBeGreaterThan(0);
  });

  it("resolves every referenced asset to a real file or generator", () => {
    const missing: string[] = [];
    for (const [ref, files] of refs) {
      const generator = GENERATED_ROUTES[ref];
      const ok = generator
        ? existsSync(join(appDir, generator))
        : existsSync(join(publicDir, ref));
      if (!ok) missing.push(`${ref} (referenced in ${files.join(", ")})`);
    }
    expect(missing, `unresolvable asset references:\n${missing.join("\n")}`).toEqual([]);
  });
});

describe("internal links", () => {
  const refs = collect(HREF_REF);

  it("finds internal links to check", () => {
    expect(refs.size).toBeGreaterThan(0);
  });

  it("points every internal link at a route that exists", () => {
    const broken: string[] = [];
    for (const [ref, files] of refs) {
      if (!routes.has(ref)) broken.push(`${ref} (linked from ${files.join(", ")})`);
    }
    expect(broken, `links to non-existent routes:\n${broken.join("\n")}`).toEqual([]);
  });
});
