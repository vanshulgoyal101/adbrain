import { describe, expect, it } from "vitest";
import { buildAttemptBlockers } from "@/lib/meta/attempt-recovery";
import { blockerSchema } from "@/lib/meta/connect-contracts";

const setup = {
  state: "action_required" as const,
  errorCode: "SETUP_REQUIRED",
  discoveryComplete: true,
  snapshot: { adAccounts: [], pages: [] },
  candidates: [],
};

describe("Meta attempt recovery", () => {
  it("distinguishes missing account and Page access without claiming they do not exist", () => {
    const blockers = buildAttemptBlockers(setup);
    expect(blockers.map(blocker => blocker.message)).toEqual([
      expect.stringContaining("Meta shared no ad account with AdBrain"),
      expect.stringContaining("Meta shared no Facebook Page with AdBrain"),
    ]);
    for (const blocker of blockers) {
      // #679: a one-person shop is its own admin, so the fix is to tick the asset when reconnecting.
      expect(blocker.message).toContain("Reconnect Meta and tick your");
      expect(blocker.message).not.toMatch(/business admin/i);
      expect(blockerSchema.safeParse(blocker).success).toBe(true);
      expect(blocker.action).toMatchObject({ kind: "open_meta", url: "https://business.facebook.com/settings/" });
    }
  });

  it("does not diagnose missing assets from incomplete discovery", () => {
    expect(buildAttemptBlockers({ ...setup, discoveryComplete: false })).toEqual([
      expect.objectContaining({ code: "DISCOVERY_INCOMPLETE", action: { kind: "retry_check" } }),
    ]);
  });

  it("identifies Page task access separately from missing Pages", () => {
    const blockers = buildAttemptBlockers({ ...setup, snapshot: { adAccounts: [{ id: "act_1" }], pages: [{ tasks: ["ANALYZE"] }] } });
    expect(blockers).toHaveLength(1);
    expect(blockers[0]).toMatchObject({ code: "MISSING_PERMISSION", action: { kind: "open_meta" } });
  });

  it.each(["expired", "cancelled"] as const)("reconnects %s attempts instead of rediscovering", state => {
    expect(buildAttemptBlockers({ ...setup, state })[0].action).toEqual({ kind: "reconnect" });
  });

  it("requests fresh consent when permission was not granted", () => {
    expect(buildAttemptBlockers({ ...setup, errorCode: "MISSING_PERMISSION" })[0].action).toEqual({ kind: "reconnect" });
  });

  it("keeps legacy snapshots recoverable and does not leak their contents", () => {
    const blockers = buildAttemptBlockers({ ...setup, snapshot: [{ token: "not-a-real-token" }] });
    expect(blockers[0].code).toBe("SETUP_REQUIRED");
    expect(JSON.stringify(blockers)).not.toContain("not-a-real-token");
  });

  it("adds the business-settings link to a candidate's portfolio blocker", () => {
    const candidate = {
      pairId: "act_1:page_1",
      assets: { metaBusinessId: null, adAccountId: "act_1", accountName: "Shop", pageId: "page_1", pageName: "Shop", currency: "INR", timezoneName: "Asia/Kolkata" },
      eligible: false,
      blockers: [{ code: "SETUP_REQUIRED" as const, message: "Put both in one portfolio.", action: null }],
    };
    const blockers = buildAttemptBlockers({ ...setup, snapshot: { adAccounts: [{ id: "act_1" }], pages: [{ tasks: ["ADVERTISE"] }] }, candidates: [candidate] });
    expect(blockers).toEqual([expect.objectContaining({ code: "SETUP_REQUIRED", message: "Put both in one portfolio.",
      action: { kind: "open_meta", url: "https://business.facebook.com/settings/", label: "Open business settings" } })]);
  });

  it("names currency or time zone when assets exist but no pair can be checked", () => {
    const [blocker] = buildAttemptBlockers({ ...setup, snapshot: { adAccounts: [{ id: "act_1" }], pages: [{ tasks: ["ADVERTISE"] }] } });
    expect(blocker.message).toContain("currency or time zone");
    expect(blocker.message).not.toMatch(/business admin/i);
  });

  it("does not show setup advice after a successful connection", () => {
    expect(buildAttemptBlockers({ ...setup, state: "connected" })).toEqual([]);
  });
});