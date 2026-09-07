import { expect, it } from "vitest";
import { readCampaignRecovery, recoveryStorageKey } from "@/lib/meta-connect-ui/recovery";

it("scopes recovery to both owner and business", () => {
  expect(recoveryStorageKey("owner-1", "business")).not.toBe(recoveryStorageKey("owner-2", "business"));
});
it("rejects corrupt and unavailable browser storage", () => {
  expect(readCampaignRecovery({ getItem: () => "{" }, "key", "business")).toBeNull();
  expect(readCampaignRecovery({ getItem: () => { throw new Error("blocked"); } }, "key", "business")).toBeNull();
});