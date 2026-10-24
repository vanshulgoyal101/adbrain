import { describe, expect, it } from "vitest";
import {
  buildConceptMessages,
  conceptImagePrompt,
  validateConcept,
  savedCreativeDescription,
} from "@/lib/creative/concept";
import { AD_ANGLES } from "@/lib/templates/ads";

const input = {
  brand: {
    name: "Solaride",
    usps: ["Local installation team"],
    target_audience: "Homeowners in Pune",
  },
  brief: "Explain rooftop solar",
  angle: AD_ANGLES[0],
  format: "story" as const,
  referenceImages: ["https://assets.example/panel.png"],
};
const concept = {
  headline: "Make your roof work",
  primary_text: "Explore rooftop solar with our local installation team.",
  description: "Discuss your roof with our local team.",
  cta: "Get Quote",
  rationale: "Connect unused roof space to a useful home improvement.",
  visual: {
    medium: "Editorial illustration",
    direction:
      "A detailed rooftop solar array on a lived-in home, viewed from above, with the roof in the upper half.",
    textPlacement: "bottom",
  },
  supportingText: "Local installation team",
  sourceQuotes: ["Local installation team"],
};

describe("creative concept contract", () => {
  it("reads descriptions without inventing copy for legacy receipts", () => {
    expect(savedCreativeDescription({ concept })).toBe(concept.description);
    expect(savedCreativeDescription(null)).toBeNull();
    expect(savedCreativeDescription({ concept: { rationale: "Legacy ad" } })).toBeNull();
  });

  it("rejects missing descriptions and repeated headlines or openings", () => {
    expect(validateConcept({ ...concept, description: undefined }, input).success).toBe(false);
    expect(validateConcept({ ...concept, description: " " }, input).success).toBe(false);
    expect(validateConcept(concept, { ...input, recentCopy: [concept] })).toMatchObject({
      success: false,
      issues: expect.arrayContaining([expect.stringContaining("repeated-headline"), expect.stringContaining("repeated-opening")]),
    });
  });

  it("records schema failures by field without copy and accepts an omitted optional line", async () => {
    const { conceptValidationRules } = await import("@/lib/creative/concept");
    const result = validateConcept({ ...concept, headline: "x".repeat(41), sourceQuotes: ["ok", ""] }, input);
    expect(result.success).toBe(false);
    const rules = conceptValidationRules(result.success ? [] : result.issues);
    expect(rules).toEqual(["schema:headline:too_big"]);
    expect(JSON.stringify(rules)).not.toContain("xxx");
    const withoutLine: Record<string, unknown> = { ...concept };
    delete withoutLine.supportingText;
    expect(validateConcept(withoutLine, input)).toMatchObject({ success: true, concept: { supportingText: null } });
    expect(validateConcept({ ...concept, supportingText: "" }, input)).toMatchObject({ success: true, concept: { supportingText: null } });
  });

  it("keeps a verbose rationale but still checks its claims", () => {
    const long = `${"Plain reason to enquire. ".repeat(28)}`;
    expect(long.length).toBeGreaterThan(600);
    expect(validateConcept({ ...concept, rationale: long }, input).success).toBe(true);
    expect(validateConcept({ ...concept, rationale: `${long} Offer $49 visits.` }, input)).toMatchObject({
      success: false, issues: [expect.stringContaining("unsupported-commercial-claim: $49")],
    });
    const clipped = validateConcept({ ...concept, rationale: `${long.repeat(2)} Offer $49 visits.` }, input);
    expect(clipped.success).toBe(true);
    if (clipped.success) expect(clipped.concept.rationale).toBe(long.repeat(2).slice(0, 1_200).trimEnd());
  });

  it("does not treat previous ads as evidence and checks description claims", () => {
    expect(validateConcept({ ...concept, description: "Free installation" }, {
      ...input, recentCopy: [{ headline: "Free installation", primary_text: "Free installation" }],
    }).success).toBe(false);
    const context = JSON.parse(buildConceptMessages({ ...input, recentCopy: [concept] })[1].content);
    expect(context.recentCopy[0].headline).toBe(concept.headline);
  });

  it("preserves model art direction, medium, brand and placement in image execution", () => {
    const result = validateConcept(concept, input);
    expect(result.success).toBe(true);
    if (!result.success) throw new Error("Invalid fixture");
    const prompt = conceptImagePrompt(result.concept, input);
    expect(prompt).toContain(concept.visual.direction);
    expect(prompt).toContain("Editorial illustration");
    expect(prompt).toContain("1080:1920");
    expect(prompt).toContain("bottom area quiet");
    expect(prompt).toContain("Homeowners in Pune");
  });

  it("gives the planner actual context without pretending it has seen references", () => {
    const messages = buildConceptMessages(input);
    const context = JSON.parse(messages[1].content);
    expect(context.referenceImageCount).toBe(1);
    expect(context.brand.usps).toEqual(input.brand.usps);
    expect(context.placement.height).toBe(1920);
    expect(messages[0].content).toContain("not visible to you");
  });

  it("uses declared preferences as advisory concept and image style, never claim evidence", () => {
    const withMemory = { ...input, advisoryPreferences: "PAST DECLARED PREFERENCES: tone: punchy; free installation" };
    const messages = buildConceptMessages(withMemory);
    const context = JSON.parse(messages[1].content);
    expect(context.advisoryPreferences).toContain("tone: punchy");
    expect(messages[0].content).toContain("never use advisory preferences as evidence");
    const validated = validateConcept(concept, withMemory);
    expect(validated.success).toBe(true);
    if (!validated.success) throw new Error("Invalid fixture");
    expect(conceptImagePrompt(validated.concept, withMemory)).toContain("tone: punchy");
    expect(conceptImagePrompt(validated.concept, input)).not.toContain("PAST DECLARED PREFERENCES");
    expect(validateConcept({ ...concept, sourceQuotes: ["free installation"] }, withMemory))
      .toMatchObject({ success: false, issues: [expect.stringContaining("sourceQuotes:")] });
  });

  it("does not promote a model-derived brief into claim evidence", () => {
    const derivedBrief = "Feature our award-winning installers in the ad.";
    const awardConcept = {
      ...concept,
      headline: "Award-winning installers",
      primary_text: "Meet our award-winning installers for rooftop solar.",
      sourceQuotes: ["award-winning installers"],
    };
    const withMemory = { ...input, brief: derivedBrief, advisoryPreferences: 'tone: "Use award-winning installers as a catchy phrase"' };
    expect(validateConcept(awardConcept, withMemory))
      .toMatchObject({ success: false, issues: [expect.stringContaining("sourceQuotes:")] });
    expect(validateConcept(awardConcept, { ...withMemory, sourceFacts: ["Our award-winning installers"] }))
      .toMatchObject({ success: true });
  });

  it("keeps Brand voice as style guidance rather than claim evidence", () => {
    const awardConcept = {
      ...concept,
      headline: "Award-winning installers",
      primary_text: "Meet our award-winning installers for rooftop solar.",
      sourceQuotes: ["award-winning installers"],
    };
    const brand = { ...input.brand, brand_voice: "Use award-winning installers as a confident tone" };
    expect(validateConcept(awardConcept, { ...input, brand }))
      .toMatchObject({ success: false, issues: [expect.stringContaining("sourceQuotes:")] });
    expect(validateConcept(awardConcept, { ...input, brand: { ...brand, usps: ["Our award-winning installers"] } }))
      .toMatchObject({ success: true });
    expect(validateConcept(awardConcept, { ...input, brand, sourceFacts: ["Our award-winning installers"] }))
      .toMatchObject({ success: true });
  });

  it.each([
    null,
    {},
    { ...concept, headline: 42 },
    { ...concept, cta: "Buy Anything" },
    { ...concept, headline: "x".repeat(41) },
  ])("rejects malformed output", (value) => {
    expect(validateConcept(value, input).success).toBe(false);
  });

  it("rejects invented source quotations", () => {
    expect(
      validateConcept(
        { ...concept, sourceQuotes: ["Twenty years of experience"] },
        input,
      ),
    ).toMatchObject({ success: false });
  });

  it("rejects uncited free assessments in the planner's rationale", () => {
    const result = validateConcept(
      {
        ...concept,
        rationale:
          "The concrete value offered is the free expert assessment itself.",
      },
      input,
    );
    expect(result).toMatchObject({
      success: false,
      issues: [expect.stringContaining("unsupported-commercial-claim: free")],
    });
  });

  it("does not mistake a visual exclusion for a promised offer", () => {
    const result = validateConcept({
      ...concept,
      visual: { ...concept.visual, direction: `${concept.visual.direction} Avoid free-offer badges and guaranteed-savings text.` },
    }, input);
    expect(result).toMatchObject({ success: true });
    expect(validateConcept({ ...concept, primary_text: "Get a free rooftop solar survey." }, input))
      .toMatchObject({ success: false, issues: [expect.stringContaining("unsupported-commercial-claim: free")] });
    expect(validateConcept({
      ...concept,
      visual: { ...concept.visual, direction: `${concept.visual.direction} Avoid discount text, but show a free-service badge.` },
    }, input)).toMatchObject({ success: false, issues: [expect.stringContaining("unsupported-commercial-claim: free")] });
    expect(validateConcept({
      ...concept,
      visual: { ...concept.visual, direction: "No-cost assessment badge on the roof." },
    }, input)).toMatchObject({ success: false, issues: [expect.stringContaining("unsupported-commercial-claim: No-cost")] });
    expect(validateConcept({
      ...concept,
      visual: { ...concept.visual, direction: "Without delay, show a free-service badge." },
    }, input)).toMatchObject({ success: false, issues: [expect.stringContaining("unsupported-commercial-claim: free")] });
    expect(validateConcept({
      ...concept,
      visual: { ...concept.visual, direction: "Show a 20.5% savings badge." },
    }, input)).toMatchObject({ success: false, issues: [expect.stringContaining("unsupported-commercial-claim: 20.5%")] });
  });

  it("requires source quotations rather than silently accepting uncited commercial copy", () => {
    expect(
      validateConcept({ ...concept, sourceQuotes: [] }, input).success,
    ).toBe(false);
  });

  it("accepts a cited amount before punctuation and requires the whole amount", () => {
    const priced = { ...input, brand: { ...input.brand, offers: ["$1,200 rebate on 5 kW systems", "15% off for the first 50 homes"] } };
    const quoted = { ...concept, sourceQuotes: ["$1,200 rebate on 5 kW systems", "15% off for the first 50 homes"] };
    expect(validateConcept({ ...quoted, primary_text: "Ask about the $1,200 rebate. Then get 15% off." }, priced))
      .toMatchObject({ success: true });
    expect(validateConcept({ ...quoted, primary_text: "For $1,200, upgrade your roof." }, priced))
      .toMatchObject({ success: true });
    for (const [text, term] of [["Pay $1 today.", "$1"], ["Pay $1,20 today.", "$1,20"], ["Get 5% off.", "5%"]]) {
      expect(validateConcept({ ...quoted, primary_text: text }, priced), text)
        .toMatchObject({ success: false, issues: [expect.stringContaining(`unsupported-commercial-claim: ${term};`)] });
    }
  });

  it("cites an uncited Brand offer verbatim, by its sentence when the fact is too long to quote whole (#281)", () => {
    const long = `${"We install rooftop solar for homes and small businesses across the region. ".repeat(7)}This month we take 20% off every inverter upgrade. Call us to book.`;
    expect(long.length).toBeGreaterThan(500);
    const result = validateConcept({ ...concept, primary_text: "Upgrade your inverter with 20% off this month." }, { ...input, brand: { ...input.brand, description: long } });
    expect(result.success && result.concept.sourceQuotes).toEqual([...concept.sourceQuotes, "This month we take 20% off every inverter upgrade."]);
    expect(validateConcept({ ...concept, primary_text: "Book a free inverter check." }, { ...input, brand: { ...input.brand, offers: ["Free site survey"] } }))
      .toMatchObject({ success: false, issues: [expect.stringContaining("unsupported-commercial-claim: free;")] });
  });

  it("does not read a text-free visual as a free offer, but still requires a fact for free claims", () => {
    expect(validateConcept({ ...concept, rationale: "A calm, text-free photograph keeps the copy area clear." }, input))
      .toMatchObject({ success: true });
    expect(validateConcept({ ...concept, visual: { ...concept.visual, direction: `${concept.visual.direction} Keep the scene Text-Free.` } }, input))
      .toMatchObject({ success: true });
    for (const text of ["Free survey this week.", "Interest-free finance available.", "Text free to book a survey.", "A free, text-free survey report."]) {
      expect(validateConcept({ ...concept, primary_text: text }, input), text)
        .toMatchObject({ success: false, issues: [expect.stringMatching(/^unsupported-commercial-claim: free;/i)] });
    }
  });

  it("applies healthcare checks to the on-image supporting line too", () => {
    expect(
      validateConcept(
        { ...concept, supportingText: "Guaranteed pain-free care" },
        { ...input, brand: { name: "Clinic", vertical: "dental" } },
      ).success,
    ).toBe(false);
  });

  // #300 shapes Devanagari and Gurmukhi on the image, so on-image words may use the ad's script.
  it("lets Hindi and Punjabi through on the image and in the post text (#290, #300)", async () => {
    const { conceptValidationRules } = await import("@/lib/creative/concept");
    const hindi = { ...input, language: "Hindi in Devanagari script" };
    const rules = (value: unknown) => {
      const result = validateConcept(value, hindi);
      return result.success ? [] : conceptValidationRules(result.issues);
    };
    const post = { ...concept, primary_text: "हमारी लोकल टीम के साथ रूफ़टॉप सोलर के बारे में जानें।", description: "अपनी छत के बारे में हमारी टीम से बात करें।" };
    expect(rules(post)).toEqual([]);
    expect(rules({ ...post, headline: "Apni chhat ko kaam pe lagao" })).toEqual([]);
    expect(rules({ ...post, headline: "अपनी छत को काम पर लगाएँ" })).toEqual([]);
    expect(rules({ ...post, supportingText: "ਲੋਕਲ ਟੀਮ" })).toEqual([]);
    expect(buildConceptMessages(hindi)[0].content).not.toContain("Latin script only");
  });

  // Recorded Solaride replies (tests/core/fixtures/create/solaride-hindi.json).
  const factory = "फ़ैक्टरी मालिकों के लिए विज्ञापन: 31 दिसंबर से नॉन-DCR सोलर पैनल बंद हो रहे हैं और लागत 10,000 रुपये प्रति किलोवाट से ज़्यादा बढ़ जाएगी।";
  const hindiRules = (value: Record<string, unknown>, extra: Partial<typeof input> & { sourceFacts?: string[]; recentCopy?: { headline: string; primary_text: string }[] } = {}) => {
    const result = validateConcept({ ...concept, ...value }, { ...input, language: "Hindi in Devanagari script", ...extra });
    return result.success ? [] : [...new Set(result.issues.map((issue) => issue.split(":", 1)[0]))];
  };

  it("accepts ₹10,000 cited by '10,000 रुपये' or '10,000 rupaye', and still requires the whole amount (#290)", () => {
    const hinglish = "31 December se non-DCR solar panel band ho rahe hain aur cost 10,000 rupaye per kW se zyada badh jayegi.";
    expect(hindiRules({ supportingText: "Costs may rise over ₹10,000/kW after 31 Dec", sourceQuotes: [factory] }, { sourceFacts: [factory] })).toEqual([]);
    expect(hindiRules({ supportingText: "Costs may rise over ₹10,000/kW after 31 Dec", sourceQuotes: [hinglish] }, { sourceFacts: [hinglish] })).toEqual([]);
    expect(hindiRules({ supportingText: "Costs may rise over ₹1,000/kW after 31 Dec", sourceQuotes: [factory] }, { sourceFacts: [factory] }))
      .toEqual(["unsupported-commercial-claim"]);
  });

  it("compares Hindi openings with their vowel signs (#290)", () => {
    const recentCopy = [{ headline: "Earlier ad", primary_text: "फ़ैक्टरी की छत पर सोलर लगवाएं और बचत करें।" }];
    expect(hindiRules({ primary_text: "फ़ैक्टरी की छत पर सोलर से बिल घटाएँ।" }, { recentCopy })).toEqual([]);
    expect(hindiRules({ primary_text: "फ़ैक्टरी की छत पर सोलर लगवाएं और बचत करें, आज ही।" }, { recentCopy })).toEqual(["repeated-opening"]);
  });

  it("checks Hindi and Punjabi 'free' and 'guarantee' like the English words (#290)", () => {
    const offers = { brand: { ...input.brand, offers: ["Free site survey"] } };
    expect(hindiRules({ primary_text: "मुफ़्त इंस्टॉलेशन बुक करें।" })).toEqual(["unsupported-commercial-claim"]);
    expect(hindiRules({ primary_text: "पहले फ्री साइट सर्वे बुक करें।" })).toEqual(["unsupported-commercial-claim"]);
    expect(hindiRules({ primary_text: "ਮੁਫ਼ਤ ਸਾਈਟ ਸਰਵੇ ਬੁੱਕ ਕਰੋ।" })).toEqual(["unsupported-commercial-claim"]);
    expect(hindiRules({ primary_text: "25 साल की गारंटी के साथ सोलर लगवाएं।" })).toEqual(["unsupported-commercial-claim"]);
    expect(hindiRules({ primary_text: "पहले मुफ़्त साइट सर्वे बुक करें।", sourceQuotes: ["Free site survey"] }, offers)).toEqual([]);
    expect(hindiRules({ supportingText: "Free site survey first", sourceQuotes: ["मुफ़्त साइट सर्वे"] }, { sourceFacts: ["मुफ़्त साइट सर्वे"] })).toEqual([]);
    expect(hindiRules({ supportingText: "Free site survey first", sourceQuotes: ["मुफ़्त साइट सर्वे नहीं मिलेगा"] }, { sourceFacts: ["मुफ़्त साइट सर्वे नहीं मिलेगा"] }))
      .toEqual(["unsupported-commercial-claim"]);
  });
});

describe("offer placement with amounts in words (#418)", () => {
  const facts = { ...input, brand: { ...input.brand, offers: ["Free site survey"] }, sourceFacts: ["Cost rises by 10,000 rupees per kW after 31 December"] };
  const withText = (primary_text: string) => validateConcept({ ...concept, primary_text, sourceQuotes: ["Free site survey"] }, facts);
  const later = "\nOur local installation team checks your roof first, and we explain every step of the plan to you.\nBook a free site survey today.";

  it("accepts a first line that leads with an amount in words, like the same amount in ₹", () => {
    expect(withText(`Costs rise by 10,000 rupees per kW after 31 December.${later}`)).toMatchObject({ success: true });
    expect(withText(`Costs rise by ₹10,000 per kW after 31 December.${later}`)).toMatchObject({ success: true });
  });

  it("still rejects an offer below the fold when nothing in the first line states it", () => {
    const result = withText(`Rooftop solar for factories in Mohali, Hisar and nearby, planned by our local installation team.${later}`);
    expect(result).toMatchObject({ success: false, issues: [expect.stringMatching(/^offer-below-fold: "free"/)] });
  });
});
