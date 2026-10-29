import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import recorded from "./fixtures/meta/whatsapp-number.json";
import { prepareCampaignReview, type PreflightLoaders } from "@/lib/campaign/preflight-service";
import { buildCreativeReviewPayload, type PreflightCreative } from "@/lib/campaign/preflight";
import type { DraftRecord } from "@/lib/campaign/draft-store";
import { chatNumberNotice, chatNumberStaleNotice, printedNumberDiffers } from "@/lib/creative/chat-number";

// #2274: the picture printed the Brand phone while the WhatsApp ad's chat opened the Page's number.
// Both numbers are Meta's recorded answers for Solaride's WhatsApp accounts (#157, digits replaced).
const displayed = recorded.tape.flatMap((entry) => JSON.stringify(entry.body).match(/\+91 \d{5} \d{5}/g) ?? []);
const chatShown = displayed.find((number) => number.endsWith("4842"))!;
const otherShown = displayed.find((number) => !number.endsWith("4842"))!;
const chatNumber = chatShown.replace(/\s/g, "");

const actor = { businessId: "b123b123-b123-4123-8123-b123b123b123", userId: "u123u123-u123-4123-8123-u123u123u123" };
const creativeId = "c123c123-c123-4123-8123-c123c123c123";
const sha = (payload: string) => createHash("sha256").update(payload).digest("hex");

function draft(destination: "whatsapp" | "instant_form"): DraftRecord {
  return {
    id: "d123d123-d123-4123-8123-d123d123d123",
    businessId: actor.businessId,
    ownerId: actor.userId,
    version: 2,
    input: {
      businessId: actor.businessId,
      name: "Solar chats",
      goal: "Generate leads",
      mode: "manual",
      creativeIds: [creativeId],
      dailyBudgetRupees: 500,
      destination,
      ...(destination === "whatsapp" ? { whatsappNumber: chatNumber, leadFormId: null } : { leadFormId: "form-1" }),
      targeting: { age: { mode: "manual", min: 25, max: 65 } },
      abTest: false,
    },
    expiresAt: "2026-11-14T10:00:00.000Z",
    createdAt: "2026-11-07T10:00:00.000Z",
    updatedAt: "2026-11-07T10:00:00.000Z",
  };
}

const creative = (printedPhone: string | null): PreflightCreative => ({
  id: creativeId,
  businessId: actor.businessId,
  approved: true,
  imageUrl: "https://example.supabase.co/storage/v1/object/public/creatives/b/old-ad.png",
  headline: "Solar for your roof",
  asksWhatsApp: true,
  printedPhone,
});

async function prepare(destination: "whatsapp" | "instant_form", printed: string | null, redrawn: string | null | Error = "https://example.supabase.co/storage/v1/object/public/creatives/b/new-ad.png") {
  const redraw = vi.fn(async () => {
    if (redrawn instanceof Error) throw redrawn;
    return redrawn;
  });
  const loaders: PreflightLoaders = {
    findDraft: async () => draft(destination),
    findCreatives: async () => [creative(printed)],
    findForm: async () => ({ id: "form-1", businessId: actor.businessId, active: true }),
    findWhatsAppNumber: async () => chatNumber,
    redrawPictureNumber: redraw,
    getConnection: async () => ({
      generation: 4,
      selected: { metaBusinessId: null, adAccountId: "act_1", accountName: "Solaride", pageId: "page_1", pageName: "Solaride", currency: "INR", timezoneName: "Asia/Kolkata" },
      canCreatePaused: true,
    }),
    resolveGeo: async () => ({ resolvedAreaLabel: "Jaipur", unresolvedNames: [], explicitlyNationwide: false }),
    hash: sha,
  };
  const result = await prepareCampaignReview(loaders, { actor, draftId: "d123d123-d123-4123-8123-d123d123d123", requestedDraftVersion: 2, now: "2026-11-08T10:00:00.000Z" });
  if (result.kind !== "review") throw new Error(`Expected a review, got ${result.kind}`);
  return { review: result.review, redraw };
}

describe("WhatsApp ad pictures print the number the chat opens (#2274)", () => {
  it("redraws a picture printing another number, and Review hashes the redrawn picture", async () => {
    const { review, redraw } = await prepare("whatsapp", otherShown);
    expect(redraw).toHaveBeenCalledWith(actor, creativeId, chatShown);
    expect(review.planWarnings?.[0]).toBe(chatNumberNotice(chatNumber));
    expect(review.planWarnings?.[0]).toContain("…4842");
    expect(review.creativeHash).toBe(sha(JSON.stringify(buildCreativeReviewPayload([{ ...creative(chatShown), imageUrl: "https://example.supabase.co/storage/v1/object/public/creatives/b/new-ad.png" }]))));
    expect(review.blockers.map((item) => item.reason)).not.toContain("REVIEW_CREATIVES");
  });

  it("leaves a picture that already prints the chat number, with or without the country code", async () => {
    for (const printed of [chatShown, chatShown.replace("+91 ", ""), `0${chatShown.replace("+91 ", "")}`]) {
      const { review, redraw } = await prepare("whatsapp", printed);
      expect(redraw).not.toHaveBeenCalled();
      expect(review.planWarnings ?? []).not.toContain(chatNumberNotice(chatNumber));
    }
  });

  it("leaves a picture that prints no phone", async () => {
    const { review, redraw } = await prepare("whatsapp", null);
    expect(redraw).not.toHaveBeenCalled();
    expect(review.creativeHash).toBe(sha(JSON.stringify(buildCreativeReviewPayload([creative(null)]))));
  });

  it("leaves lead-form ads alone: the form has no chat number", async () => {
    const { redraw } = await prepare("instant_form", otherShown);
    expect(redraw).not.toHaveBeenCalled();
  });

  it("never blocks when the redraw fails: the ad stays as it was and Review says so in one line", async () => {
    for (const failure of [null, new Error("render failed")]) {
      const { review } = await prepare("whatsapp", otherShown, failure);
      expect(review.planWarnings?.[0]).toBe(chatNumberStaleNotice(chatNumber));
      expect(review.creativeHash).toBe(sha(JSON.stringify(buildCreativeReviewPayload([creative(otherShown)]))));
      expect(review.blockers.map((item) => item.reason)).not.toContain("REVIEW_CREATIVES");
    }
  });

  it("compares numbers by their digits", () => {
    expect(printedNumberDiffers(otherShown, chatNumber)).toBe(true);
    expect(printedNumberDiffers("+1 999 999 4842", chatNumber)).toBe(true);
    expect(printedNumberDiffers("(99999) 94842", chatNumber)).toBe(false);
    expect(printedNumberDiffers("", chatNumber)).toBe(false);
  });
});
