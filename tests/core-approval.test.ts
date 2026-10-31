import { describe, expect, it } from "vitest";
import { coreApproval, coreFiles, syncExempt } from "../scripts/core-approval.mjs";

const head = "7612817abcdef0123456789abcdef0123456789";
const at = (body: string, createdAt = "2026-10-27T10:00:00Z") => ({ body, createdAt, url: "u" });

describe("core-approval required check (#926)", () => {
  it("gates launch, Meta, money and migration paths, not tests or UI", () => {
    expect(coreFiles([
      "src/lib/campaign/create-service.ts",
      "src/lib/campaign/whatsapp-greeting.ts",
      "src/lib/meta/client.ts",
      "src/app/api/campaigns/[id]/route.ts",
      "src/lib/payments/razorpay.ts",
      "db/migrations/20261027_x.sql",
      "tests/whatsapp-greeting.test.ts",
      "src/components/home.tsx",
      "docs/RELEASING.md",
    ])).toHaveLength(6);
  });

  it("passes PRs without core files and the deploy train", () => {
    expect(coreApproval({ files: ["src/components/a.tsx"], head, headRef: "x", comments: [] }).state).toBe("success");
    expect(coreApproval({ files: ["src/lib/meta/client.ts"], head, headRef: "next", comments: [] }).state).toBe("success");
  });

  it("#1740: only this repo's next → main is the train; a fork's `next` or another base waits for a verdict", () => {
    const pr = { files: ["src/lib/meta/client.ts"], head, headRef: "next", comments: [] };
    expect(coreApproval({ ...pr, headRepo: "vanshulgoyal101/adbrain", baseRef: "main" }).state).toBe("success");
    expect(coreApproval({ ...pr, headRepo: "someone/adbrain", baseRef: "main" }).state).toBe("pending");
    expect(coreApproval({ ...pr, headRepo: "", baseRef: "main" }).state).toBe("pending");
    expect(coreApproval({ ...pr, headRepo: "vanshulgoyal101/adbrain", baseRef: "next" }).state).toBe("pending");
  });

  it("#1740: gates the ₹999 plan as money and tenant/auth boundaries as core", () => {
    expect(coreFiles([
      "src/lib/plan/webhook.ts",
      "src/app/api/cron/plan-links/route.ts",
      "src/app/api/cron/refresh-results/route.ts",
      "src/app/api/whatsapp/webhook/route.ts",
      "src/lib/alerts/owner-alerts.ts",
      "src/lib/security/cron-auth.ts",
      "src/lib/internal-accounts.ts",
      "src/lib/internal-accounts.json",
      "src/app/api/privacy-requests/route.ts",
      "src/lib/privacy-requests.ts",
      "src/lib/internal-accounts-helper.ts",
      "src/lib/securityish.ts",
    ])).toHaveLength(10);
    const cto = at(`CTO review of ${head.slice(0, 7)}: **approved**.`);
    expect(coreApproval({ files: ["src/lib/plan/gate.ts"], head, headRef: "b", comments: [cto] }).state).toBe("pending");
  });

  it("holds #914's shape (core Meta change, no approval at the head) until QA, the Reviewer or the CTO approves it", () => {
    const pr = { files: ["src/lib/campaign/create-service.ts"], head, headRef: "dev/914" };
    expect(coreApproval({ ...pr, comments: [] }).state).toBe("pending");
    expect(coreApproval({ ...pr, comments: [at("Reviewer review of 1111111: **approved**.")] }).state).toBe("pending");
    expect(coreApproval({ ...pr, comments: [at("Reviewer review of 7612817: **changes requested**.")] }).state).toBe("pending");
    expect(coreApproval({ ...pr, comments: [at("QA: please verify 7612817 once you can")] }).state).toBe("pending");
    expect(coreApproval({ ...pr, comments: [at("Reviewer review of 7612817: **approved**.")] })).toMatchObject({ state: "success", description: "Reviewer approved 7612817" });
    expect(coreApproval({ ...pr, comments: [at("CTO review of 7612817: **approved**. Fine.")] }).description).toBe("CTO approved 7612817");
    expect(coreApproval({ ...pr, comments: [at("QA (headless): **approved** at head `7612817`.")] }).description).toBe("QA approved 7612817");
  });

  it("the latest Reviewer verdict wins, and an approval of an earlier head with the same patch still counts", () => {
    const pr = { files: ["src/lib/meta/client.ts"], head, headRef: "b" };
    const approvedThenRevoked = [at("Reviewer review of 7612817: **approved**.", "2026-10-27T10:00:00Z"), at("Reviewer review of 7612817: **changes requested**.", "2026-10-27T11:00:00Z")];
    expect(coreApproval({ ...pr, comments: approvedThenRevoked }).state).toBe("pending");
    const earlier = [at("Reviewer review of 2222222: **approved**.")];
    expect(coreApproval({ ...pr, comments: earlier, samePatch: (sha: string) => sha === "2222222" || head.startsWith(sha) }).state).toBe("success");
    expect(coreApproval({ ...pr, comments: earlier }).state).toBe("pending");
  });

  it("consumes the recorded signed Reviewer approval at the named head (#2054)", () => {
    const pr = { files: ["src/lib/campaign/ledger.ts"], head: "f784739f36d8e2957ccd0497f349c32fe4431a48", headRef: "work/issue-1786" };
    const approval = at("Reviewer: review of f784739f36d8e2957ccd0497f349c32fe4431a48: **approved** (core-approval).");
    expect(coreApproval({ ...pr, comments: [approval] })).toMatchObject({
      state: "success", description: "Reviewer approved f784739",
    });
    expect(coreApproval({ ...pr, head, comments: [approval] }).state).toBe("pending");
    expect(coreApproval({ ...pr, comments: [
      approval, at("Reviewer: review of f784739f36d8e2957ccd0497f349c32fe4431a48: **changes requested**.", "2026-10-29T06:00:00Z"),
    ] }).state).toBe("pending");
  });

  it("lets a labelled revert through so rollback never waits", () => {
    const pr = { files: ["src/lib/campaign/create-service.ts"], head, headRef: "r", comments: [] };
    expect(coreApproval({ ...pr, labels: ["rollback"], title: "Revert #914: ice breakers" }).state).toBe("success");
    expect(coreApproval({ ...pr, labels: ["rollback"], title: "Fix ice breakers" }).state).toBe("pending");
    expect(coreApproval({ ...pr, labels: [], title: "Revert #914" }).state).toBe("pending");
  });
});

describe("money and migrations need QA and the CTO/Reviewer (#1083)", () => {
  const pr = { files: ["src/lib/campaign/funding-check.ts", "src/lib/campaign/activation.ts"], head, headRef: "dev4/x" };
  const cto = at("CTO review of 7612817: **approved** (money).", "2026-10-27T10:00:00Z");
  const qaOk = at("QA verdict at 7612817: **approved**.", "2026-10-27T10:05:00Z");
  const qaNo = at("QA verdict at 7612817: changes requested (2 items).", "2026-10-27T10:05:00Z");
  it("holds a money PR on the CTO's approval alone, and passes with both", () => {
    expect(coreApproval({ ...pr, comments: [cto] })).toMatchObject({ state: "pending", description: expect.stringMatching(/needs QA approval/) });
    expect(coreApproval({ ...pr, comments: [qaOk] })).toMatchObject({ state: "pending", description: expect.stringMatching(/needs CTO\/Reviewer approval/) });
    expect(coreApproval({ ...pr, comments: [cto, qaOk] }).state).toBe("success");
  });
  it("a QA 'changes requested' at the head holds any core PR, whoever else approved", () => {
    expect(coreApproval({ ...pr, comments: [cto, qaNo] })).toMatchObject({ state: "pending", description: "QA requested changes at 7612817" });
    expect(coreApproval({ files: ["src/lib/meta/client.ts"], head, headRef: "b", comments: [cto, qaNo] }).state).toBe("pending");
  });
  it("treats migrations like money", () => {
    expect(coreApproval({ files: ["db/migrations/20261027_x.sql"], head, headRef: "b", comments: [cto] }).state).toBe("pending");
  });
  it("still requires QA alongside a signed Reviewer money verdict", () => {
    const reviewer = at("Reviewer: review of 7612817: **approved** (money).");
    expect(coreApproval({ ...pr, comments: [reviewer] }).state).toBe("pending");
    expect(coreApproval({ ...pr, comments: [reviewer, qaOk] })).toMatchObject({
      state: "success", description: "QA and Reviewer approved 7612817 (money/migration)",
    });
    expect(coreApproval({ ...pr, comments: [reviewer, qaNo] }).state).toBe("pending");
  });
});

describe("a main → next sync merge isn't held on main's own gated files (#2147)", () => {
  const pr = { files: ["db/migrations/20261029_lead_erase.sql", "docs/architecture/migrations.md"], head, headRef: "devops/sync-main-next", comments: [] };

  it("passes when every core file equals main's copy", () => {
    expect(coreApproval({ ...pr, onMain: () => true })).toMatchObject({ state: "success", description: expect.stringContaining("identical to main") });
  });

  it("still holds a core file that differs from main, and applies the money/migration rule to it alone", () => {
    const both = { ...pr, files: [...pr.files, "src/lib/meta/client.ts"] };
    const verdict = coreApproval({ ...both, onMain: (f: string) => f.startsWith("db/") });
    expect(verdict.state).toBe("pending");
    expect(verdict.description).toContain("src/lib/meta/client.ts");
    expect(verdict.description).not.toContain("Money/migration");
    expect(coreApproval({ ...pr, onMain: () => false }).description).toContain("Money/migration");
  });

  it("exempts a file only if next hasn't changed it since the merge base", () => {
    // main-only file (e.g. a released migration that isn't on next or the base): exempt
    expect(syncExempt({ head: "m", main: "m", next: null, base: null })).toBe(true);
    // main changed it, next didn't: taking main's copy drops nothing
    expect(syncExempt({ head: "m", main: "m", next: "b", base: "b" })).toBe(true);
    // next changed it and the head took main's copy: a gated next change would be dropped
    expect(syncExempt({ head: "m", main: "m", next: "n", base: "b" })).toBe(false);
    // both changed it (a real merge): gated
    expect(syncExempt({ head: "x", main: "m", next: "n", base: "b" })).toBe(false);
    // deleted at head: gated
    expect(syncExempt({ head: null, main: null, next: null, base: null })).toBe(false);
    expect(syncExempt({ head: null, main: "m", next: "b", base: "b" })).toBe(false);
  });
});

describe("words-only gate (#364)", () => {
  it("ships core wording on green CI; money wording needs one approval; migrations stay gated", () => {
    const file = "src/lib/campaign/ad-pause-service.ts";
    const meta = { files: [file], head, headRef: "b", comments: [], wordsFiles: new Set([file]) };
    expect(coreApproval(meta).state).toBe("success");
    expect(coreApproval({ ...meta, comments: [at("QA: changes requested at 7612817")] }).state).toBe("pending");
    expect(coreApproval({ ...meta, wordsFiles: new Set<string>() }).state).toBe("pending");
    const money = { files: ["src/lib/payments/plan.ts"], head, headRef: "b", comments: [], wordsFiles: new Set(["src/lib/payments/plan.ts"]) };
    expect(coreApproval(money).state).toBe("pending");
    expect(coreApproval({ ...money, comments: [at("Reviewer review of 7612817: **approved**.")] }).state).toBe("success");
    const sql = { files: ["db/migrations/20261031_x.sql"], head, headRef: "b", comments: [at("Reviewer review of 7612817: **approved**.")], wordsFiles: new Set(["db/migrations/20261031_x.sql"]) };
    expect(coreApproval(sql).state).toBe("pending");
    expect(coreApproval({ ...meta, files: [file, "src/lib/meta/client.ts"] }).state).toBe("pending");
    expect(coreFiles(["src/lib/campaign/README.md", "src/lib/meta/README.md"])).toHaveLength(0);
  });
});
