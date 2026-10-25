import { describe, expect, it } from "vitest";
import { parseProbe } from "../scripts/team-status.mjs";

describe("team-status probe (#573 A1)", () => {
  it("maps waiter exit codes and keeps only the WORK items", () => {
    const out = "Role: Dev owns: x\nWORK for Dev (2):\n- #419 is waiting on you: \"Dev: …\"\n- #418 is yours and not started: Track 2\nTeam board #580 …";
    expect(parseProbe(0, out)).toEqual({ state: "has-work", items: ["#419 is waiting on you: \"Dev: …\"", "#418 is yours and not started: Track 2"] });
    expect(parseProbe(3, "Waiting for work…")).toEqual({ state: "no-work", items: [] });
    expect(parseProbe(4, "")).toEqual({ state: "waiting", items: [] });
    expect(parseProbe(1, "")).toEqual({ state: "error", items: [] });
  });
});
