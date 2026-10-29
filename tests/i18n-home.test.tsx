// @vitest-environment jsdom
// #1438 slice 1: Home in Hindi behind the owner's language choice; English stays the default.
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import en from "../messages/en.json";
import hi from "../messages/hi.json";
import { LOCALE_COOKIE, toLocale } from "@/i18n/locale";
import { RecentActivity, WorkspaceHome } from "@/components/workspace-home";
import { describeAuditEvent } from "@/lib/audit-labels";
import { formatDate } from "@/lib/format";
import { buildWorkQueue } from "@/lib/work-queue";
import type { Business, Campaign, Creative } from "@/lib/types";

vi.mock("next/navigation", async (actual) => ({ ...(await actual<typeof import("next/navigation")>()), useRouter: () => ({ refresh: () => {} }) }));

type Tree = { [key: string]: string | Tree };
function leaves(tree: Tree, prefix = ""): Record<string, string> {
  return Object.fromEntries(Object.entries(tree).flatMap(([key, value]) =>
    typeof value === "string" ? [[`${prefix}${key}`, value]] : Object.entries(leaves(value, `${prefix}${key}.`))));
}
// ICU argument names ({n}, {time}); plural branches' own words are not arguments.
// A brace right after a selector (`one {it}`, `=0 {none}`) opens a branch, so `{it}` is a word, not an argument.
// A selector follows the `plural,` or the branch before it, so prose like "too few {units}" keeps its argument.
const args = (message: string) => [...new Set([...message.matchAll(/(?<![,}]\s*(?:zero|one|two|few|many|other|=\d+)\s*)\{\s*([a-zA-Z]+)\s*[,}]/g)].map((m) => m[1]))].sort();

describe("messages", () => {
  const english = leaves(en as Tree);
  const hindi = leaves(hi as Tree);

  it("every English key has a Hindi string, and no Hindi key is left over", () => {
    expect(Object.keys(hindi).sort()).toEqual(Object.keys(english).sort());
    for (const [key, value] of Object.entries(hindi)) expect(value.trim(), key).not.toBe("");
  });

  it("each Hindi string takes the same placeholders as its English", () => {
    for (const [key, value] of Object.entries(english)) expect(args(hindi[key]), key).toEqual(args(value));
  });
});

describe("toLocale", () => {
  it("reads the saved choice and falls back to English", () => {
    expect(LOCALE_COOKIE).toBe("adbrain_lang");
    expect(toLocale("hi")).toBe("hi");
    expect(toLocale("en")).toBe("en");
    expect(toLocale("pa")).toBe("en");
    expect(toLocale(undefined)).toBe("en");
  });
});

const business = { id: "b", name: "Solaride", vertical: "", description: "Solar", brand_voice: "Direct", target_audience: "Homeowners", locations: ["Mohali"] } as Business;
const wentLive = { id: "c", name: "", status: "paused", launched_at: "2026-10-01T10:00:00Z", meta_campaign_id: null, creative_ids: [] } as unknown as Campaign;
const draft = { id: "d", status: "draft", headline: "Cut your bill", image_url: null } as Creative;
const props = { business: null, creatives: [], campaigns: [], audit: [], metaReady: false, spend: null };

describe("Home in Hindi", () => {
  it("shows the CPO's Hindi when the owner picked Hindi", () => {
    render(<WorkspaceHome {...props} business={business} campaigns={[wentLive]} creatives={[draft]} locale="hi" />);
    expect(screen.getByText("लोकल बिज़नेस · Mohali")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "कैंपेन" })).toBeInTheDocument();
    expect(screen.getByText("बिना नाम का कैंपेन")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "नए विज्ञापन" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "सब देखें" })).toBeInTheDocument();
    expect(screen.getByText("जाँचना बाकी")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "1 विज्ञापन जाँचना बाकी है" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "विज्ञापन जाँचें" })).toBeInTheDocument();
    expect(document.querySelector("[lang='hi']")).not.toBeNull();
  });

  it("a new owner with no business gets the Hindi welcome", () => {
    render(<WorkspaceHome {...props} locale="hi" />);
    expect(screen.getByRole("heading", { name: "AdBrain में आपका स्वागत है" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "अपना बिज़नेस सेट करें" })).toBeInTheDocument();
  });

  it("stays in English without a choice", () => {
    render(<WorkspaceHome {...props} />);
    expect(screen.getByRole("heading", { name: "Welcome to AdBrain" })).toBeInTheDocument();
    expect(document.querySelector("[lang='hi']")).toBeNull();
  });
});

describe("work queue in Hindi", () => {
  const base = { business, creatives: [], campaigns: [], metaReady: true };

  it("pluralises ads waiting for review", () => {
    const [one] = buildWorkQueue({ ...base, creatives: [draft], locale: "hi" });
    expect(one.title).toBe("1 विज्ञापन जाँचना बाकी है");
    const [two] = buildWorkQueue({ ...base, creatives: [draft, { ...draft, id: "e" }], locale: "hi" });
    expect(two.title).toBe("2 विज्ञापन जाँचना बाकी हैं");
  });

  it("fills counts into the campaigns line", () => {
    const item = buildWorkQueue({ ...base, campaigns: [wentLive], locale: "hi" }).find((entry) => entry.id === "campaigns");
    expect(item?.title).toBe("अपने रुके हुए कैंपेन देखें");
    expect(item?.detail).toBe("1 रुके हुए, 0 शुरू नहीं हुए। विज्ञापन, इलाका और बजट देखें, फिर तैयार होने पर एक चालू करें।");
    expect(item?.action).toBe("कैंपेन जाँचें");
  });

  it("keeps the English words unchanged by default", () => {
    const [one] = buildWorkQueue({ ...base, creatives: [draft, { ...draft, id: "e" }] });
    expect(one.title).toBe("2 ads need review");
  });
});

// #1877: Recent activity in Hindi: the CPO's labels, no stored English note, and Hindi day words with Latin digits.
describe("Hindi Recent activity (#1877)", () => {
  const now = new Date("2026-10-29T06:00:00Z");
  it("names each action in Hindi and drops the English note", () => {
    expect(describeAuditEvent("creatives.generate", "Generated 3 creatives", "hi")).toBe("नए विज्ञापन बने");
    expect(describeAuditEvent("creative.approve", null, "hi")).toBe("विज्ञापन मंज़ूर हुआ");
    expect(describeAuditEvent("creatives.export", null, "hi")).toBe("विज्ञापन डाउनलोड किए गए");
    expect(describeAuditEvent("something.new", null, "hi")).toBe("गतिविधि");
    expect(describeAuditEvent("creatives.generate", "Generated 3 creatives")).toBe("New ads made — Generated 3 creatives");
  });

  it("says today and yesterday in Hindi, with Latin digits", () => {
    expect(formatDate("2026-10-28T18:20:00Z", now, "hi")).toBe("कल, 11:50 pm");
    expect(formatDate("2026-10-29T04:05:00Z", now, "hi")).toBe("आज, 9:35 am");
    expect(formatDate("2026-10-20T04:05:00Z", now, "hi")).toMatch(/^20 \S+, 9:35 am$/);
    expect(formatDate("2026-10-28T18:20:00Z", now)).toBe("yesterday, 11:50 pm");
  });

  it("renders the Hindi lines on Home", () => {
    vi.useFakeTimers({ now, toFake: ["Date"] });
    try {
      render(<RecentActivity locale="hi" audit={[{ id: "1", action: "creative.approve", reason: "Ad approved", authority: "server", created_at: "2026-10-28T18:20:00Z" } as Parameters<typeof RecentActivity>[0]["audit"][number]]} />);
      expect(screen.getByText("विज्ञापन मंज़ूर हुआ")).toBeInTheDocument();
      expect(screen.getByText("कल, 11:50 pm")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
