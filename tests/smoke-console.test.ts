import { describe, expect, it } from "vitest";
import { ASSISTANT_BUSY_ERROR, forgiveRecoveredBusyTurns } from "../scripts/lib/smoke-console.mjs";

describe("Create smoke: a busy assistant turn that Try again recovered (#2396)", () => {
  it("is a NOTE when each 503 was AI_BUSY", () => {
    expect(forgiveRecoveredBusyTurns([ASSISTANT_BUSY_ERROR, ASSISTANT_BUSY_ERROR], 2)).toEqual({
      errors: [],
      note: "NOTE Create assistant was busy (AI_BUSY) 2×; Try again recovered it (#2396)",
    });
  });

  it("keeps a 503 that was not AI_BUSY as a FAIL", () => {
    expect(forgiveRecoveredBusyTurns([ASSISTANT_BUSY_ERROR, ASSISTANT_BUSY_ERROR], 1).errors).toEqual([ASSISTANT_BUSY_ERROR]);
    expect(forgiveRecoveredBusyTurns([ASSISTANT_BUSY_ERROR], 0)).toEqual({ errors: [ASSISTANT_BUSY_ERROR], note: null });
  });

  it("keeps every other console error as a FAIL", () => {
    const other = ["console error at /api/creatives/assistant (HTTP 500)", "CSP violation at /create", "console error at /api/creatives/generate (HTTP 503)"];
    expect(forgiveRecoveredBusyTurns([...other, ASSISTANT_BUSY_ERROR], 3)).toEqual({
      errors: other,
      note: "NOTE Create assistant was busy (AI_BUSY) 1×; Try again recovered it (#2396)",
    });
  });
});
