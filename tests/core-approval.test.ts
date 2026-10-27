import { describe, expect, it } from "vitest";
import { coreApproval, coreFiles } from "../scripts/core-approval.mjs";

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

  it("lets a labelled revert through so rollback never waits", () => {
    const pr = { files: ["src/lib/campaign/create-service.ts"], head, headRef: "r", comments: [] };
    expect(coreApproval({ ...pr, labels: ["rollback"], title: "Revert #914: ice breakers" }).state).toBe("success");
    expect(coreApproval({ ...pr, labels: ["rollback"], title: "Fix ice breakers" }).state).toBe("pending");
    expect(coreApproval({ ...pr, labels: [], title: "Revert #914" }).state).toBe("pending");
  });
});
