import type { z } from "zod";
import type { accountFundingSchema } from "@/lib/campaign/activation";
import type { FundingMode } from "@/lib/payments/operator-funding";

export type AccountFunding = z.infer<typeof accountFundingSchema>;

export type FundingShortfall =
  | { kind: "no_limit" }
  | { kind: "short"; roomPaise: number; neededPaise: number }
  | { kind: "allowance"; allowancePaise: number; neededPaise: number }
  | { kind: "unverified" };

/**
 * #774 (CTO): one funding rule for activation and budget edits, by #806's funding mode. `own`: the run's
 * Meta cap guards it, plus room under the owner's account limit when one is set. `operator`: an account
 * limit is required and must have room. `managed`: the AdBrain-held allowance must cover it. Meta's account
 * limit counts spend, so no GST is added here. Null when funded; unreadable inputs fail closed.
 */
export function fundingShortfall(input: { mode: FundingMode; neededPaise: number; account: AccountFunding | null; allowancePaise?: number | null }): FundingShortfall | null {
  if (input.mode === "managed") {
    if (input.allowancePaise == null) return { kind: "unverified" };
    return input.neededPaise > input.allowancePaise ? { kind: "allowance", allowancePaise: input.allowancePaise, neededPaise: input.neededPaise } : null;
  }
  if (!input.account) return { kind: "unverified" };
  if (input.mode === "operator" && input.account.spendCapPaise <= 0) return { kind: "no_limit" };
  if (input.account.spendCapPaise > 0 && input.account.roomPaise < input.neededPaise) {
    return { kind: "short", roomPaise: input.account.roomPaise, neededPaise: input.neededPaise };
  }
  return null;
}
