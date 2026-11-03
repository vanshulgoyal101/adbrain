import { describe, expect, it } from "vitest";
import { accessRequestAction } from "../scripts/access-request-action.mjs";

const closed = { number: 9, state: "CLOSED", closedAt: "2026-11-02T12:55:00Z" };

describe("accessRequestAction (#2806)", () => {
  it("opens an issue when the key has none", () => expect(accessRequestAction("2026-11-02T18:22:00Z", [])).toBe("open"));
  it("skips when any issue for the key is open", () =>
    expect(accessRequestAction("2026-11-03T00:00:00Z", [closed, { number: 12, state: "OPEN", closedAt: null }])).toBe("skip"));
  it("reopens the newest closed issue when the request is newer than its close", () =>
    expect(accessRequestAction("2026-11-02T18:22:00Z", [{ number: 3, state: "CLOSED", closedAt: "2026-10-29T00:00:00Z" }, closed])).toBe("reopen:9"));
  it("skips an older or equal request, so a re-close cannot loop", () => {
    expect(accessRequestAction("2026-11-02T12:00:00Z", [closed])).toBe("skip");
    expect(accessRequestAction("2026-11-02T12:55:00Z", [closed])).toBe("skip");
  });
  it("skips when the request time is missing", () => expect(accessRequestAction("", [closed])).toBe("skip"));
});
