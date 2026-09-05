import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { auditActionLabel, describeAuditEvent } from "@/lib/audit-labels";

describe("auditActionLabel", () => {
  it("gives plain wording for internal action keys", () => {
    expect(auditActionLabel("creative.unapprove")).toBe(
      "Creative moved back to drafts",
    );
    expect(auditActionLabel("creatives.generate")).toBe(
      "New creatives generated",
    );
    expect(auditActionLabel("campaigns.sync")).toBe("Campaigns synced from Meta");
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
    expect(describeAuditEvent("campaigns.sync", "Synced 28 campaign(s) from Meta")).toBe(
      "Campaigns synced from Meta — Synced 28 campaign(s) from Meta",
    );
  });

  it("drops a long reason instead of dumping it at the user", () => {
    // Older rows stored the whole generated brief here.
    const prompt = "A calm, bright, professional photograph of the clinic ".repeat(6);
    expect(describeAuditEvent("creatives.generate", prompt)).toBe(
      "New creatives generated",
    );
  });

  it("handles a missing reason and avoids repeating the label", () => {
    expect(describeAuditEvent("creative.approve", null)).toBe("Creative approved");
    expect(describeAuditEvent("creative.approve", "   ")).toBe("Creative approved");
    expect(describeAuditEvent("creative.approve", "Creative approved")).toBe(
      "Creative approved",
    );
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
