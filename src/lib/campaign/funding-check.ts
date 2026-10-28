import type { z } from "zod";
import type { accountFundingSchema } from "@/lib/campaign/activation";
import type { FundingMode } from "@/lib/payments/operator-funding";

export type AccountFunding = z.infer<typeof accountFundingSchema>;

export type FundingShortfall =
  | { kind: "no_limit" }
  | { kind: "short"; roomPaise: number; neededPaise: number; committed?: AccountFunding["committed"] }
  | { kind: "allowance"; allowancePaise: number; neededPaise: number }
  | { kind: "unverified" };

const exactRupees = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" });

/**
 * #1058/#1094: " after ₹500.00 for your 2 other live runs", plus what uncapped ad sets spend a day (named, never
 * subtracted: they have no total), or "" with neither.
 */
export function committedWords(committed: AccountFunding["committed"], money: (rupees: number) => string = rupees => exactRupees.format(rupees)): string {
  const runs = committed?.runs ? ` after ${money(committed.remainingPaise / 100)} for your ${committed.runs} other live ${committed.runs === 1 ? "run" : "runs"}` : "";
  const uncapped = committed?.uncapped?.adSets
    ? `${money(committed.uncapped.dailyPaise / 100)} a day also runs on ${committed.uncapped.adSets} uncapped ad ${committed.uncapped.adSets === 1 ? "set" : "sets"}`
    : "";
  if (!uncapped) return runs;
  return runs ? `${runs}, and ${uncapped}` : ` (${uncapped})`;
}

/** #1058/#1094: the account's room and what its other running capped runs may still spend, read together. */
export async function readFunding(
  meta: { readAccountFunding(): Promise<Omit<AccountFunding, "committed">>; readLiveCappedRuns(exclude?: string[]): Promise<NonNullable<AccountFunding["committed"]>> },
  exclude: string[] = [],
): Promise<AccountFunding> {
  const [funding, committed] = await Promise.all([meta.readAccountFunding(), meta.readLiveCappedRuns(exclude)]);
  return { ...funding, committed };
}

/** #1058: Meta's room under the account limit, less what the account's running capped runs may still spend. */
export function freeRoomPaise(account: AccountFunding): number {
  return Math.max(0, account.roomPaise - (account.committed?.remainingPaise ?? 0));
}

/**
 * #774 (CTO): one funding rule for activation and budget edits, by #806's funding mode. `own`: the run's
 * Meta cap guards it, plus room under the owner's account limit when one is set. `operator`: an account
 * limit is required and must have room, after what its running capped runs may still spend (#1058). `managed`: the AdBrain-held allowance must cover it. Meta's account
 * limit counts spend, so no GST is added here. Null when funded; unreadable inputs fail closed.
 */
export function fundingShortfall(input: { mode: FundingMode; neededPaise: number; account: AccountFunding | null; allowancePaise?: number | null }): FundingShortfall | null {
  if (input.mode === "managed") {
    if (input.allowancePaise == null) return { kind: "unverified" };
    return input.neededPaise > input.allowancePaise ? { kind: "allowance", allowancePaise: input.allowancePaise, neededPaise: input.neededPaise } : null;
  }
  if (!input.account) return { kind: "unverified" };
  if (input.mode === "operator" && input.account.spendCapPaise <= 0) return { kind: "no_limit" };
  const room = freeRoomPaise(input.account);
  if (input.account.spendCapPaise > 0 && room < input.neededPaise) {
    return { kind: "short", roomPaise: room, neededPaise: input.neededPaise, ...input.account.committed?.runs || input.account.committed?.uncapped?.adSets ? { committed: input.account.committed } : {} };
  }
  return null;
}
