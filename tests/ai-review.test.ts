import { describe, expect, it } from "vitest";
import { HIGH_RISK, MARKER, MODEL, highRiskDiff, renderComment } from "../scripts/ai-review.mjs";

const file = (path: string, body = "+x\n") => `diff --git a/${path} b/${path}\nindex 1..2 100644\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n${body}`;

describe("advisory AI review (#423)", () => {
  it("covers money, Meta, migrations, auth and tenant paths only", () => {
    for (const p of ["db/migrations/20261025_x.sql", "src/lib/meta/client.ts", "src/lib/payments/x.ts", "src/lib/managed/spend-cap.ts", "src/lib/supabase/admin.ts", "src/lib/security/ssrf.ts", "src/app/api/auth/callback/route.ts", "src/app/api/meta/managed/provision/route.ts", "src/middleware.ts"]) expect(HIGH_RISK.test(p), p).toBe(true);
    for (const p of ["src/components/campaigns.tsx", "docs/RELEASING.md", "tests/core/x.test.ts", "src/lib/creative/concept.ts"]) expect(HIGH_RISK.test(p), p).toBe(false);
    expect(MODEL).not.toMatch(/qwen/);
  });

  it("keeps only high-risk files and skips ones that would overflow the budget", () => {
    const big = "+" + "y".repeat(20_000) + "\n";
    const { paths, diff, skipped } = highRiskDiff(file("src/components/a.tsx") + file("src/lib/meta/client.ts") + file("db/migrations/1_big.sql", big));
    expect(paths).toEqual(["src/lib/meta/client.ts"]);
    expect(diff).toContain("src/lib/meta/client.ts");
    expect(diff).not.toContain("components/a.tsx");
    expect(skipped).toEqual(["db/migrations/1_big.sql"]);
  });

  it("renders one marked, clearly advisory comment that can't be read as a QA or CTO verdict", () => {
    const text = renderComment({ model: MODEL, paths: ["src/lib/meta/client.ts"], skipped: [], body: "No high-confidence findings." });
    expect(text.startsWith(MARKER)).toBe(true);
    expect(text).toContain("advisory, not a verdict");
    expect(text).not.toMatch(/^[*_\s]*(QA|CTO)\b/m);
    expect(renderComment({ model: MODEL, paths: [], skipped: ["db/migrations/x.sql"], body: null, note: "Skipped: too large." })).toContain("Not reviewed (diff too large): `db/migrations/x.sql`");
  });
});
