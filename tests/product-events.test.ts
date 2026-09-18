import { describe, expect, it } from "vitest";
import { requestOutcome, sanitizeProductEvent } from "@/lib/observability/events";

const event = {
  version: 1,
  eventId: "11111111-1111-4111-8111-111111111111",
  requestId: "22222222-2222-4222-8222-222222222222",
  occurredAt: "2026-09-18T10:00:00.000Z",
  kind: "request",
  name: "http.request",
  outcome: "success",
  userId: null,
  businessId: null,
  attributes: { route: "/api/campaigns/[id]", method: "POST", status: 200 },
};

describe("product event privacy contract", () => {
  it("keeps only allowed metadata and removes arbitrary payloads", () => {
    const safe = sanitizeProductEvent({ ...event, email: "private@example.com", body: "private prompt", attributes: { ...event.attributes, token: "secret", lead: { phone: "123" }, prompt: "private" } });
    expect(safe).toEqual(event);
    expect(JSON.stringify(safe)).not.toMatch(/private|secret|phone/);
  });

  it.each([
    { name: "private user text" },
    { userId: "person@example.com" },
    { attributes: { route: "/auth/callback?code=secret" } },
    { durationMs: -1 },
  ])("rejects invalid structured fields: %j", (overrides) => {
    expect(sanitizeProductEvent({ ...event, ...overrides })).toBeNull();
  });

  it("classifies HTTP outcomes without reading response bodies", () => {
    expect(requestOutcome(200)).toBe("success");
    expect(requestOutcome(303)).toBe("success");
    expect(requestOutcome(429)).toBe("rejected");
    expect(requestOutcome(503)).toBe("failed");
  });
});