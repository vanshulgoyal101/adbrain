import { describe, expect, it } from "vitest";
import { z } from "zod";
import { fitHeadline } from "@/lib/creative/fit-headline";
import recorded from "./core/fixtures/gemini/flash-lite-batch-replies.json";

const recordedHeadlines = recorded.batches.flatMap((batch) => batch.calls)
  .filter((call) => call.status === 200)
  .map((call) => z.object({ headline: z.string() }).parse(JSON.parse(call.text)).headline);

describe("fitHeadline (#2543)", () => {
  it.each([
    ["Book a $49 exam in Cedar Park. Learn more.", "Book a $49 exam in Cedar Park."],
    ["$49 new-patient exam in Austin, made simple", "$49 new-patient exam in Austin"],
    ["Free solar site survey. Message us to learn more.", "Free solar site survey."],
    ["Free solar site survey — without the hassle", "Free solar site survey"],
    ["₹499 में सोलर सर्वे। पूरी जानकारी के लिए संपर्क करें।", "₹499 में सोलर सर्वे।"],
    ["दिल्ली में फ्री सोलर सर्वे। अधिक जानकारी के लिए संपर्क करें।", "दिल्ली में फ्री सोलर सर्वे।"],
  ])("fits boilerplate without losing the offer or place: %s", (text, expected) => {
    expect(text.length).toBeGreaterThan(40);
    expect(fitHeadline(text)).toBe(expected);
    expect(fitHeadline(text)!.length).toBeLessThanOrEqual(40);
  });

  it.each([
    "Start with a $49 new-patient exam in Cedar Park",
    "A $49 new-patient exam, only for Austin residents",
    "Free solar site survey in Austin. Book now for ₹499.",
    "Free solar site survey. Limited to 10 installations.",
    "Free solar site survey, not available in Austin",
    "Free solar site survey, only if you buy 10 panels",
    "₹499 में सोलर सर्वे, केवल दिल्ली के निवासियों के लिए",
    "दिल्ली में सोलर सर्वे। केवल १० ग्राहकों के लिए फ्री।",
    "Free solar site survey, with guaranteed savings",
    "A headline with no clause boundary or optional words",
    "SupercalifragilisticexpialidociousSupercalifragilisticexpialidocious",
  ])("leaves a material or inseparable overrun for repair: %s", (text) => {
    expect(text.length).toBeGreaterThan(40);
    expect(fitHeadline(text)).toBeNull();
  });

  it("does not leave a dangling thought even at a sentence boundary", () => {
    expect(fitHeadline("Your first exam is for. Learn more.", 24)).toBeNull();
  });

  it("does not drop the rest of a long core when boilerplate is removed", () => {
    expect(fitHeadline("Start with a $49 new-patient exam in Cedar Park. Learn more.")).toBeNull();
  });

  it.each([
    "31 दिसंबर से पहले फैक्ट्री में सोलर लगवाएं!",
    "31 दिसंबर तक पाएं सोलर इंस्टॉलेशन पर 10% छूट",
  ])("keeps the recorded flash-lite deadline/offer overrun for repair: %s", (text) => {
    expect(recordedHeadlines).toContain(text);
    expect(fitHeadline(text)).toBeNull();
  });

  it.each(recordedHeadlines.filter((text) => text.length <= 40))(
    "does not change a recorded headline that already fits: %s", (text) => {
      expect(fitHeadline(text)).toBe(text);
    },
  );

  it("can remove stacked boilerplate without inventing or changing text", () => {
    expect(fitHeadline("$49 exam in Austin, made simple. Learn more.", 20)).toBe("$49 exam in Austin");
  });

  it("keeps a qualifier if removing only the CTA already fits", () => {
    expect(fitHeadline("$49 exam in Austin, made simple. Learn more.")).toBe("$49 exam in Austin, made simple.");
  });

  it("does not turn a boilerplate-only headline into an empty success", () => {
    expect(fitHeadline(", made simple", 8)).toBeNull();
  });

  it.each(["$49 new-patient exam", "x".repeat(40), "दिल्ली में फ्री सोलर सर्वे", "Care 🧑‍⚕️"])(
    "keeps already-fitting headlines unchanged: %s", (text) => {
      expect(fitHeadline(text)).toBe(text);
    },
  );

  it("does not split an emoji or a Hindi word to meet a custom cap", () => {
    expect(fitHeadline("Care 🧑‍⚕️. Learn more.", 8)).toBeNull();
    expect(fitHeadline("दिल्ली में सोलर। अधिक जानकारी के लिए संपर्क करें।", 8)).toBeNull();
  });

  it("returns null for an empty headline", () => {
    expect(fitHeadline("")).toBeNull();
  });

  it.each([0, -1, 1.5, NaN, Infinity])("rejects an invalid cap %s", (max) => {
    expect(() => fitHeadline("A headline", max)).toThrow(RangeError);
  });
});
