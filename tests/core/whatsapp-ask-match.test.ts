import { describe, expect, it } from "vitest";
import story from "./fixtures/meta/story-validate.json";
import { runPreflight } from "@/lib/campaign/preflight";
import { askMismatchWarning, askWithQuestionsWarning } from "@/lib/campaign/plan-check";
import { campaignWhatsAppMessage } from "@/lib/campaign/campaign-whatsapp-message";
import { quotedAsk } from "@/lib/campaign/whatsapp-greeting";

// #418 rule 7 ("say exactly what to send; the last line matches the button"). The recorded copy is
// Solaride's approved ad (story-validate.json): its last line asks to message on WhatsApp but quotes
// no words, like all 41 recorded Create ads today (0 of 41 quote what to send). Once Create's prompt
// quotes the words (Dev's prompt line), the WhatsApp pre-typed message uses exactly those words.
const recorded = story.inputs.message;
const quoting = recorded.replace(/Message Solaride on WhatsApp to book your free site survey\.$/, "WhatsApp “Free site survey” to book yours.");
const solaride = { name: "Solaride", offers: ["Free site survey", "PM Surya Ghar subsidy help"], locations: ["Chandigarh", "Mohali", "Panchkula"] };
const draft = {
  businessId: "ea6ea561-5d0d-428c-b3bf-d75ae67eca60", name: "Lever 2", goal: "Enquiries", mode: "manual" as const, destination: "whatsapp" as const,
  creativeIds: ["c1"], dailyBudgetRupees: 450, abTest: false,
  targeting: { location: { mode: "manual" as const, includedNames: ["Mohali"] }, age: { mode: "manual" as const, min: 25, max: 55 }, audience: { interestNames: ["Solar energy"], rationale: "Homeowners near Mohali." } },
};
const message = (primaryText: string, saved?: unknown) => campaignWhatsAppMessage({ draft: draft as never, business: { ...solaride, whatsapp_template: saved }, creatives: [{ headline: story.inputs.headline, primary_text: primaryText }] });
const review = (primaryText: string, saved?: unknown) => runPreflight({
  draft: draft as never, draftId: "90d1d2bb-466c-4889-9af2-edb533e82531", draftVersion: 1,
  connection: { generation: 1, canCreatePaused: true, selected: { metaBusinessId: null, adAccountId: "act_9000000000000001", accountName: "Solaride 101", pageId: "900000000000002", pageName: "Solaride Energy", currency: "INR", timezoneName: "Asia/Kolkata" } },
  creatives: [{ id: "c1", businessId: draft.businessId, approved: true, imageUrl: "https://example.com/ad.png", headline: story.inputs.headline, primaryText, storyReady: true }],
  form: null, whatsappNumber: "+919999994842", whatsappMessage: message(primaryText, saved),
  geo: { resolvedAreaLabel: "Mohali", unresolvedNames: [], explicitlyNationwide: false, audienceInterests: [{ id: "6003384248805", name: "Solar energy" }] },
  hash: () => "a".repeat(64),
});
const owners = { greeting: "Hi! Thanks for messaging Solaride. This is your first step in getting free electricity.", opening: { kind: "prefill", prefill: "Can I get more info on this", callButton: true }, language: "en" };

describe("core: the ad's last line and the WhatsApp message use the same words (#418 rule 7)", () => {
  it("leaves today's recorded ads as they are: no quoted ask, the usual suggestion, no warning", () => {
    expect(quotedAsk(recorded)).toBeNull();
    expect(message(recorded).opening.autofill).toBe("Hi! I'd like a free site survey in Mohali.");
    expect(review(recorded).planWarnings ?? []).toEqual([]);
  });

  it("pre-types exactly the words an ad quotes, and Review has nothing to warn about", () => {
    expect(quotedAsk(quoting)).toBe("Free site survey");
    expect(message(quoting)).toMatchObject({ source: "suggested", opening: { autofill: "Free site survey" } });
    expect(review(quoting).planWarnings ?? []).toEqual([]);
  });

  it("warns, never blocks, when the owner's saved message differs from what the ad asks for", () => {
    const result = review(quoting, owners);
    expect(result.planWarnings).toEqual([askMismatchWarning("Free site survey", "Can I get more info on this")]);
    expect(result.blockers).toEqual([]);
    expect(result.canCreatePaused).toBe(true);
    expect(result.planHash).toBe(review(recorded, owners).planHash);
  });

  // #680 W1: Quick questions have no pre-typed text, so an ad that quotes words to send promises something that isn't there.
  const questions = (list: string[]) => ({ greeting: owners.greeting, opening: { kind: "ice_breakers", questions: list }, language: "en" });
  const w1 = ["How much subsidy can I get?", "Can I book a free site survey?", "How much will my bill go down?"];
  it("with Quick questions, warns (never blocks) when an ad quotes words that aren't one of the questions", () => {
    const result = review(quoting, questions(w1));
    expect(result.planWarnings).toEqual([askWithQuestionsWarning("Free site survey")]);
    expect(result.blockers).toEqual([]);
    expect(result.canCreatePaused).toBe(true);
    expect(review(quoting, questions([...w1.slice(0, 2), "Free site survey"])).planWarnings ?? []).toEqual([]);
    expect(review(recorded, questions(w1)).planWarnings ?? []).toEqual([]);
    expect(review(recorded.replace(/Message Solaride on WhatsApp to book your free site survey\.$/, "Tap, then pick a question to send."), questions(w1)).planWarnings ?? []).toEqual([]);
  });

  it("reads only paired quotes on the last line", () => {
    expect(quotedAsk("Solaride's engineers check it's safe.\nMessage us on WhatsApp.")).toBeNull();
    expect(quotedAsk("“Survey” first.\nMessage us on WhatsApp.")).toBeNull();
    expect(quotedAsk("Free survey.\nWhatsApp \"SURVEY\" now")).toBe("SURVEY");
    expect(quotedAsk("मुफ़्त सर्वे।\nWhatsApp पर “सर्वे” भेजें")).toBe("सर्वे");
    expect(quotedAsk(null)).toBeNull();
  });
});
