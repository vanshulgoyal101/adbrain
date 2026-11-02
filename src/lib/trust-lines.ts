import type { FundingMode } from "@/lib/payments/operator-funding";
import { formatMoney } from "@/lib/format";
import en from "../../messages/en.json";

/**
 * #1292 (#1285 WS4.3, CPO's exact words): three short lines at the moments an owner trusts AdBrain with
 * their Page, their money and their customers. Copy only: no money logic.
 */

/**
 * At Connect. Only where the owner pays Meta directly does AdBrain say it never holds the ad money.
 * #1438: the words live in messages/ (`setup.goLive.trust*`), where step 3 reads them in the owner's language.
 */
export function connectTrustLine(mode: FundingMode): string {
  return mode === "managed" ? en.setup.goLive.trustManaged : en.setup.goLive.trustOwn;
}

/** At Activate, for a run with a total limit. */
export function activateTrustLine(dailyRupees: number, capRupees: number): string {
  return `${formatMoney(dailyRupees)} a day, stops at ${formatMoney(capRupees)}. Pause any time.`;
}

/** On Home and in the alert, for the newest enquiry nobody has answered. `time` is already formatted. */
export function firstEnquiryLine(name: string | null | undefined, time: string): string {
  return `${name?.trim() || "Someone"} tapped your ad at ${time}. Reply now; people often go with the first business that answers.`;
}
