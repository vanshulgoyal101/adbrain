import { describe, expect, it } from "vitest";
import { canUseMetaConnect } from "@/lib/meta/pilot-access";

describe("Meta connection pilot access", () => {
  it("defaults to closed in production", () => {
    expect(canUseMetaConnect("owner", { environment: "production", rollout: undefined, pilotUserId: undefined })).toBe(false);
  });
  it("permits only the configured pilot user", () => {
    const config = { environment: "production" as const, rollout: "pilot", pilotUserId: "owner" };
    expect(canUseMetaConnect("owner", config)).toBe(true);
    expect(canUseMetaConnect("other", config)).toBe(false);
    expect(canUseMetaConnect("owner", { ...config, pilotUserId: "" })).toBe(false);
  });
  it("supports an explicit kill switch and rejects misspelled rollout values", () => {
    for (const rollout of ["disabled", "pilto"]) {
      expect(canUseMetaConnect("owner", { environment: "production", rollout, pilotUserId: "owner" })).toBe(false);
    }
  });
  it("keeps local development available and requires explicit broad production enablement", () => {
    expect(canUseMetaConnect("owner", { environment: "development", rollout: undefined, pilotUserId: undefined })).toBe(true);
    expect(canUseMetaConnect("owner", { environment: "production", rollout: "enabled", pilotUserId: undefined })).toBe(true);
  });
});