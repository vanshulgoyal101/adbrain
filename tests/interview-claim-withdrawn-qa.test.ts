import { beforeEach, describe, expect, it, vi } from "vitest";
import { complete } from "@/lib/llm";
import { InterviewValidationError, runInterview, type InterviewInput } from "@/lib/creative/interview";

// QA red test, #613 follow-up to #636: support now needs an un-negated occurrence of the term, but
// only a negation just before the term counts. A Brand fact that withdraws the offer after the term
// ("Free survey no longer offered") or with a contraction ("isn't free") still supports "free", so the
// assistant can promise an offer the business says it doesn't make.
vi.mock("@/lib/llm", () => ({ complete: vi.fn(), parseJSON: JSON.parse }));
beforeEach(() => vi.resetAllMocks());

const reply = (value: unknown) => ({ text: JSON.stringify(value), provider: "test", model: "test" });
const brand = (offers: string[]): InterviewInput["brand"] => ({
  name: "Solaride", vertical: "solar energy", brand_voice: "friendly, trustworthy", offers, usps: [], languages: ["English"],
});
const run = (offer: string) => {
  vi.mocked(complete).mockResolvedValue(reply({ ready: true, brief: "Book your free site survey this week." }));
  return runInterview({ brand: brand([offer]), goal: "Get more site survey bookings" });
};

describe("QA #613: a Brand fact that withdraws an offer doesn't support it", () => {
  it.each(["Free survey no longer offered", "Free survey not available this month"])(
    "refuses 'free' when the fact withdraws it after the term (refused before #636): %s",
    async (offer) => { await expect(run(offer)).rejects.toBeInstanceOf(InterviewValidationError); },
  );

  it.each(["Site survey isn't free", "We don't offer free surveys"])(
    "refuses 'free' when a contraction negates it: %s",
    async (offer) => { await expect(run(offer)).rejects.toBeInstanceOf(InterviewValidationError); },
  );

  it.each(["Free site survey, no obligation", "Free survey (not for commercial sites)"])(
    "still accepts 'free' when the negation is about something else: %s",
    async (offer) => { await expect(run(offer)).resolves.toMatchObject({ ready: true }); },
  );
});
