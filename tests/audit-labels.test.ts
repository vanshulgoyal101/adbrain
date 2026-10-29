import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { auditActionLabel, describeAuditEvent, isBackgroundAuditAction } from "@/lib/audit-labels";

describe("auditActionLabel", () => {
  it("gives plain wording for internal action keys", () => {
    expect(auditActionLabel("creative.unapprove")).toBe(
      "Ad moved back to drafts",
    );
    expect(auditActionLabel("creatives.generate")).toBe(
      "New ads made",
    );
    expect(auditActionLabel("campaigns.sync")).toBe("Campaigns updated from Meta");
    expect(auditActionLabel("leads.sync")).toBe("Enquiries checked in Meta");
  });

  it("degrades readably for an action added later", () => {
    expect(auditActionLabel("campaign.some_new_thing")).toBe(
      "Campaign some new thing",
    );
    expect(auditActionLabel("")).toBe("Activity");
  });
});

describe("describeAuditEvent", () => {
  it("appends a short, human reason", () => {
    expect(describeAuditEvent("campaign.pause", "Spend cap reached")).toBe(
      "Campaign paused — Spend cap reached",
    );
  });

  // #763: the sync log ("Imported 0 new lead(s); 0 form(s) failed") stays out of the owner's activity.
  it("marks background syncs so the activity feed can leave them out", () => {
    expect(isBackgroundAuditAction("leads.sync")).toBe(true);
    expect(isBackgroundAuditAction("campaigns.sync")).toBe(true);
    expect(isBackgroundAuditAction("campaign.pause")).toBe(false);
  });

  it("drops a long reason instead of dumping it at the user", () => {
    // Older rows stored the whole generated brief here.
    const prompt = "A calm, bright, professional photograph of the clinic ".repeat(6);
    expect(describeAuditEvent("creatives.generate", prompt)).toBe(
      "New ads made",
    );
  });

  it("handles a missing reason and avoids repeating the label", () => {
    expect(describeAuditEvent("creative.approve", null)).toBe("Ad approved");
    expect(describeAuditEvent("creative.approve", "   ")).toBe("Ad approved");
    expect(describeAuditEvent("creative.approve", "Ad approved")).toBe(
      "Ad approved",
    );
  });
});

// #2321: an automatic pause says why, in both languages, without the internal "(cron sweep)" note.
describe("describeAuditEvent for automatic pauses", () => {
  const cases: [string, string, string][] = [
    ["Weekly spend cap of ₹5000 reached (cron sweep)", "Campaign paused: your weekly cap of ₹5,000 was reached", "कैंपेन रुका: हफ़्ते की ₹5,000 की खर्च सीमा पूरी हुई"],
    ["Weekly spend cap of ₹5000 reached", "Campaign paused: your weekly cap of ₹5,000 was reached", "कैंपेन रुका: हफ़्ते की ₹5,000 की खर्च सीमा पूरी हुई"],
    ["Weekly spend observation could not be verified (cron sweep)", "Campaign paused: this week's spend couldn't be checked", "कैंपेन रुका: इस हफ़्ते का खर्च जाँचा नहीं जा सका"],
    ["Customer advertising funds or attributed costs require reconciliation (cron sweep)", "Campaign paused: your AdBrain balance needs a check", "कैंपेन रुका: आपके AdBrain बैलेंस की जाँच होनी है"],
    ["Customer advertising funds require reconciliation (managed ad account stopped)", "Campaign paused: your AdBrain balance needs a check", "कैंपेन रुका: आपके AdBrain बैलेंस की जाँच होनी है"],
    ["No advertising allowance left (managed ad account stopped)", "Campaign paused: your AdBrain balance ran out", "कैंपेन रुका: आपका AdBrain बैलेंस खत्म हो गया"],
    ["Capped run reached its end time (cron sweep)", "Campaign paused: its run reached the end date", "कैंपेन रुका: रन अपनी आख़िरी तारीख तक पहुँच गया"],
  ];

  it.each(cases)("%s", (reason, english, hindi) => {
    expect(describeAuditEvent("spend.auto_paused", reason)).toBe(english);
    expect(describeAuditEvent("spend.auto_paused", reason, "hi")).toBe(hindi);
  });

  it("keeps today's label for an unknown or missing reason", () => {
    expect(describeAuditEvent("spend.auto_paused", "Something new")).toBe("Campaigns auto-paused at your cap — Something new");
    expect(describeAuditEvent("spend.auto_paused", null)).toBe("Campaigns auto-paused at your cap");
    expect(describeAuditEvent("spend.auto_paused", "Something new", "hi")).toBe("आपकी खर्च सीमा पूरी होने पर कैंपेन अपने-आप रुक गए");
  });
});

describe("page titles", () => {
  const appDir = join(process.cwd(), "src", "app");

  it("never repeats the site name the layout template already adds", () => {
    // layout.tsx sets template "%s — AdBrain", so "Dashboard — AdBrain" rendered
    // as "Dashboard — AdBrain — AdBrain". OpenGraph/Twitter titles are exempt:
    // they stand alone on a social card and should carry the brand.
    // `${...}` inside the block carries its own braces, so allow them.
    const social = /\b(?:openGraph|twitter)\s*:\s*\{(?:[^{}]|\$\{[^{}]*\})*\}/g;
    const offenders: string[] = [];
    for (const file of readdirSync(appDir, { recursive: true, encoding: "utf8" })) {
      if (!file.endsWith("page.tsx") || file === "layout.tsx") continue;
      const text = readFileSync(join(appDir, file), "utf8").replace(social, "");
      for (const m of text.matchAll(/title:\s*["'`]([^"'`]+)["'`]/g)) {
        if (/AdBrain/.test(m[1])) offenders.push(`${file}: ${m[1]}`);
      }
    }
    expect(offenders, `titles duplicating the site name:\n${offenders.join("\n")}`).toEqual([]);
  });
});
