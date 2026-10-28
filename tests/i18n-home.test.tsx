// @vitest-environment jsdom
// #1438 slice 1: Home in Hindi behind the owner's language choice; English stays the default.
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import en from "../messages/en.json";
import hi from "../messages/hi.json";
import { LOCALE_COOKIE, toLocale } from "@/i18n/locale";
import { WorkspaceHome } from "@/components/workspace-home";
import { buildWorkQueue } from "@/lib/work-queue";
import type { Business, Campaign, Creative } from "@/lib/types";

vi.mock("next/navigation", async (actual) => ({ ...(await actual<typeof import("next/navigation")>()), useRouter: () => ({ refresh: () => {} }) }));

type Tree = { [key: string]: string | Tree };
function leaves(tree: Tree, prefix = ""): Record<string, string> {
  return Object.fromEntries(Object.entries(tree).flatMap(([key, value]) =>
    typeof value === "string" ? [[`${prefix}${key}`, value]] : Object.entries(leaves(value, `${prefix}${key}.`))));
}
// ICU argument names ({n}, {time}); plural branches' own words are not arguments.
const args = (message: string) => [...new Set([...message.matchAll(/\{\s*([a-zA-Z]+)\s*[,}]/g)].map((m) => m[1]))].sort();

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
    expect(item?.title).toBe("चालू करने से पहले कैंपेन जाँचें");
    expect(item?.detail).toBe("1 रुके हुए, 0 ड्राफ़्ट। विज्ञापन, ग्राहक और बजट जाँचें; तैयार होने तक रुका रहने दें।");
    expect(item?.action).toBe("कैंपेन जाँचें");
  });

  it("keeps the English words unchanged by default", () => {
    const [one] = buildWorkQueue({ ...base, creatives: [draft, { ...draft, id: "e" }] });
    expect(one.title).toBe("2 ads need review");
  });
});
