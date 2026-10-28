import { describe, expect, it } from "vitest";
import { GONE_LINES, goneInMeta, recentlyDeletedInMeta } from "@/lib/campaign/gone-in-meta";

// #1600 (CPO #1601): words for a campaign deleted in Meta Ads Manager.
describe("gone in Meta (#721, #1600)", () => {
  it("names DELETED, ARCHIVED and the scheduled refresh's MISSING (100/33)", () => {
    expect(goneInMeta({ raw: { metaStatus: "DELETED" } })).toBe("Deleted in Meta");
    expect(goneInMeta({ raw: { metaStatus: "ARCHIVED" } })).toBe("Archived in Meta");
    expect(goneInMeta({ raw: { metaStatus: "MISSING" } })).toBe("Not found in Meta");
    expect(goneInMeta({ raw: null })).toBeNull();
  });

  it("Home names a deleted campaign for a week after AdBrain found it, and only when Meta said DELETED", () => {
    const now = Date.parse("2026-10-28T18:00:00Z");
    const raw = (metaStatus: string, days: number) => ({ metaStatus, metaGoneAt: new Date(now - days * 86_400_000).toISOString() });
    expect(recentlyDeletedInMeta({ raw: raw("DELETED", 1) }, now)).toBe(true);
    expect(recentlyDeletedInMeta({ raw: raw("DELETED", 8) }, now)).toBe(false);
    expect(recentlyDeletedInMeta({ raw: raw("MISSING", 1) }, now)).toBe(false);
    expect(recentlyDeletedInMeta({ raw: { metaStatus: "DELETED" } }, now)).toBe(false);
  });

  it("the card line is the CPO's", () => {
    expect(GONE_LINES.deleted).toBe("This campaign was deleted in Meta Ads Manager, so it can't run or be changed here. Nothing more will spend. Its results up to then stay below.");
  });
});
