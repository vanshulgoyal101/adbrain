import { describe, expect, it, vi } from "vitest";
import { durationIn } from "@/i18n/duration";
import { checkLaterLine, throttleActive } from "@/lib/campaign/meta-wait";
import { ownerThrottledUntil } from "@/services/meta-throttle";

describe("#1838 slice 2b: throttle words", () => {
  it("says a span the way 'Updated … ago' does, without 'ago'", () => {
    expect(durationIn("en", 40 * 60_000)).toBe("about 40 minutes");
    expect(durationIn("en", 20_000)).toBe("about 1 minute");
    expect(durationIn("en", 2 * 3_600_000)).toBe("about 2 hours");
    expect(durationIn("en", 3 * 86_400_000)).toBe("about 3 days");
    expect(durationIn("hi", 40 * 60_000)).toBe("लगभग 40 मिनट");
  });

  it("is active only while the wait is in the future, and names India time for Check now", () => {
    const now = new Date("2026-10-30T10:00:00Z");
    expect(throttleActive("2026-10-30T10:30:00Z", now)).toBe(true);
    expect(throttleActive("2026-10-30T09:59:00Z", now)).toBe(false);
    expect(throttleActive(null, now)).toBe(false);
    expect(checkLaterLine("2026-10-30T11:00:00Z")).toBe("Meta asked us to wait. We'll check again at 4:30 pm.");
  });
});

describe("ownerThrottledUntil", () => {
  const now = new Date("2026-10-30T10:00:00Z");
  const admin = (app: unknown, row: unknown, fail = false) => ({
    rpc: vi.fn(async () => fail ? { data: null, error: { message: "missing" } } : { data: app, error: null }),
    from: vi.fn(() => ({ select: () => ({ in: () => ({ gt: async () => fail ? { data: null, error: { message: "missing" } } : { data: row ? [row] : [], error: null } }) }) })),
  });

  it("is the later of the app-wide and this business's wait, or null; a failed read shows nothing", async () => {
    expect(await ownerThrottledUntil(admin("2026-10-30T10:20:00Z", { business_id: "b1", throttled_until: "2026-10-30T11:00:00Z" }) as never, "b1", now)).toBe("2026-10-30T11:00:00Z");
    expect(await ownerThrottledUntil(admin("2026-10-30T12:00:00Z", null) as never, "b1", now)).toBe("2026-10-30T12:00:00Z");
    expect(await ownerThrottledUntil(admin(null, null) as never, "b1", now)).toBeNull();
    expect(await ownerThrottledUntil(admin(null, null, true) as never, "b1", now)).toBeNull();
  });
});
