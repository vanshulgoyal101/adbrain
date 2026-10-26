import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { classify, operationKey, probeResult } from "../scripts/reconcile-operation.mjs";

// Shapes recorded from Graph v21.0 reads of a stuck operation's objects (#734); ids are fake.
const recorded = {
  campaign: { ok: true, body: { id: "1001", name: "TEST AdBrain core loop - delete", status: "DELETED", effective_status: "DELETED", objective: "OUTCOME_LEADS", created_time: "2026-10-21T23:38:12+0530" } },
  campaignAsAd: { ok: false, body: { error: { message: "(#100) Tried accessing nonexisting field (adset_id) on node type (Campaign)", type: "OAuthException", code: 100 } } },
  leadFormAsAd: { ok: true, body: { id: "2002", name: "New-Patient Exam with Posture Scan", status: "ACTIVE" } },
  gone: { ok: false, body: { error: { message: "Unsupported get request.", type: "GraphMethodException", code: 100, error_subcode: 33 } } },
  denied: { ok: false, body: { error: { message: "(#10) Application does not have permission for this action", code: 10 } } },
};

describe("reconcile-operation (#734)", () => {
  it("uses the alert's key: sha256 of the operation id, 12 hex", () => {
    expect(operationKey("d88f0502-0000-0000-0000-000000000000"))
      .toBe(createHash("sha256").update("d88f0502-0000-0000-0000-000000000000").digest("hex").slice(0, 12));
  });

  it("types an object only by a field that came back (lead forms ignore unknown fields)", () => {
    expect(probeResult(recorded.campaign, "objective")).toBe("ok");
    expect(probeResult(recorded.campaignAsAd, "adset_id")).toBe("wrong_type");
    expect(probeResult(recorded.leadFormAsAd, "adset_id")).toBe("wrong_type");
    expect(probeResult(recorded.leadFormAsAd, "id")).toBe("ok");
    expect(probeResult(recorded.gone, "adset_id")).toBe("missing");
    expect(probeResult(recorded.denied, "adset_id")).toBe("error");
  });

  it("closes only when nothing can spend", () => {
    const deletedTree = [
      { id: "1001", type: "campaign", status: "DELETED" },
      { id: "1002", type: "adset", status: "DELETED" },
      { id: "2002", type: "other", status: "ACTIVE" },
      { id: "abc", type: "image_hash" },
      { id: "3003", type: "unknown", missing: true },
    ];
    expect(classify(deletedTree)).toBe("nothing_live");
    expect(classify([])).toBe("nothing_live");
    expect(classify([{ id: "1001", type: "campaign", status: "PAUSED" }, { id: "1002", type: "adset", status: "PAUSED" }])).toBe("paused");
    expect(classify([{ id: "1001", type: "campaign", status: "PAUSED" }, { id: "4004", type: "ad", status: "ACTIVE" }])).toBe("active");
  });

  it("fails closed on anything it couldn't read or type", () => {
    expect(classify([{ id: "1001", type: "unknown", error: "10/-" }])).toBe("unreadable");
    expect(classify([{ id: "1001", type: "unknown", error: "untyped" }, { id: "1002", type: "campaign", status: "DELETED" }])).toBe("unreadable");
    expect(classify([{ id: "1001/adsets", type: "adset", error: "read" }])).toBe("unreadable");
  });
});
