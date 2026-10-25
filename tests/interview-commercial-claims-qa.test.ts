import { beforeEach, describe, expect, it, vi } from "vitest";
import { complete } from "@/lib/llm";
import { InterviewValidationError, runInterview, type InterviewInput } from "@/lib/creative/interview";

// QA red test for #613: production's failed assistant requests end in INTERVIEW_VALIDATION
// [unsupported-commercial-claim] even after the repair attempt. One cause in the check itself: a
// Brand fact that contains any negation word ("no", "not", "without"…) can't support any term, so
// "Free site survey, no obligation" doesn't support "free", and a faithful reply fails twice.
vi.mock("@/lib/llm", () => ({ complete: vi.fn(), parseJSON: JSON.parse }));
beforeEach(() => vi.resetAllMocks());

const reply = (value: unknown) => ({ text: JSON.stringify(value), provider: "test", model: "test" });
const brand = (offers: string[]): InterviewInput["brand"] => ({
  name: "Solaride", vertical: "solar energy", brand_voice: "friendly, trustworthy", offers, usps: [], languages: ["English"],
});

describe("QA #613: commercial terms the Brand states are supported", () => {
  it("accepts 'free' when the Brand's own offer says it, even if that offer also says 'no obligation'", async () => {
    vi.mocked(complete).mockResolvedValue(reply({ ready: true, brief: "Invite homeowners to book the free site survey this week." }));
    await expect(runInterview({ brand: brand(["Free site survey, no obligation"]), goal: "Get more site survey bookings" }))
      .resolves.toMatchObject({ ready: true });
  });

  it("still refuses a commercial claim nothing supports", async () => {
    vi.mocked(complete).mockResolvedValue(reply({ ready: true, brief: "Promise guaranteed savings on every bill." }));
    await expect(runInterview({ brand: brand(["Free site survey"]), goal: "Get more site survey bookings" }))
      .rejects.toBeInstanceOf(InterviewValidationError);
  });
});
