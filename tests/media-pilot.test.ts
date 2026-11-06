import { beforeEach, describe, expect, it, vi } from "vitest";

const config = vi.hoisted(() => ({ uploads: true, businesses: "" }));
vi.mock("@/lib/env", () => ({
  getEnv: () => ({ MEDIA_UPLOADS_ENABLED: config.uploads, MEDIA_PILOT_BUSINESS_IDS: config.businesses }),
}));

import { mediaPilotEnabled } from "@/lib/media/pilot";
import { createCampaignRequestSchema, preflightRequestSchema } from "@/lib/campaign/connect-contracts";

const first = "816aaafb-7ebc-4ad7-bbda-001beff172f8";
const second = "90d1d2bb-466c-4889-9af2-edb533e82531";
const other = "e3d165a9-bbf8-47f7-8c61-e69dbb8ee3d1";

beforeEach(() => {
  config.uploads = true;
  config.businesses = "";
});

describe("media pilot business eligibility (#781)", () => {
  it("admits only a listed business while uploads are on", () => {
    config.businesses = ` ${first.toUpperCase()}, ${second} `;
    expect(mediaPilotEnabled(first)).toBe(true);
    expect(mediaPilotEnabled(second)).toBe(true);
    expect(mediaPilotEnabled(other)).toBe(false);
    config.uploads = false;
    expect(mediaPilotEnabled(first)).toBe(false);
  });

  it.each(["", "not-a-uuid", `${first},not-a-uuid`, `${first},`, `,${first}`])(
    "admits nobody for empty or malformed configuration %j", (value) => {
      config.businesses = value;
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        expect(mediaPilotEnabled(first)).toBe(false);
        expect(mediaPilotEnabled(other)).toBe(false);
        expect(error.mock.calls.flat().join(" ")).not.toContain(first);
      } finally {
        error.mockRestore();
      }
    },
  );

  it("rejects an invalid actor id and observes a revoked business", () => {
    config.businesses = first;
    expect(mediaPilotEnabled("not-a-uuid")).toBe(false);
    expect(mediaPilotEnabled(first)).toBe(true);
    config.businesses = second;
    expect(mediaPilotEnabled(first)).toBe(false);
  });

  it("never accepts a caller-provided eligibility flag in Review or create", () => {
    const request = { businessId: first, draftId: second, draftVersion: 1 };
    expect(preflightRequestSchema.safeParse({ ...request, mediaPilotEnabled: true }).success).toBe(false);
    const create = createCampaignRequestSchema.parse({
      ...request, connectionGeneration: 1, planHash: "a".repeat(64), idempotencyKey: "idem-1234", mediaPilot: true,
    });
    expect(create).not.toHaveProperty("mediaPilot");
  });
});
