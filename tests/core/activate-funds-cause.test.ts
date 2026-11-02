import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildSchema } from "../../scripts/build-schema.mjs";
import { reserveCustomerCampaign, CustomerBalanceError } from "@/lib/payments/customer-balance";

// #782 core: Activate turns each `customer_ad_reserve` refusal into its cause, read from the SQL that actually
// runs (the canonical schema plus migrations, as `test:meta-db` builds it). If the SQL's wording changes, this
// fails, instead of owners silently falling back to "funds could not be verified".
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/payments/production-config", () => ({ getProductionPaymentConfig: () => ({ accountId: "acc_fixture", origin: "https://adbrain.example" }) }));

const actor = { businessId: "22222222-2222-4222-8222-222222222222", userId: "33333333-3333-4333-8333-333333333333" };
const balance = { businessId: actor.businessId, currency: "INR", capturedPaise: 0, refundedPaise: 0,
  serviceAllocationPaise: 0, advertisingAllocationPaise: 0, mediaCostPaise: 0, taxCostPaise: 0,
  reservedPaise: 0, remainingPaise: 0, held: false, reason: null, reservations: [] };
const admission = { campaignId: "11111111-1111-4111-8111-111111111111", adAccountId: "act_123", connectionGeneration: 1,
  dailyBudgetRupees: 200, requestKey: "a".repeat(64), lifetimeCapPaise: 45_000 };

/** The `raise exception` messages of the last `customer_ad_reserve` definition, in order. */
function reserveRefusals(): string[] {
  const schema = buildSchema();
  const start = schema.lastIndexOf("create or replace function public.customer_ad_reserve(");
  const body = schema.slice(start, schema.indexOf("$$;", schema.indexOf("$$", start) + 2));
  return [...body.matchAll(/raise exception '([^']+)'/g)].map((match) => match[1]);
}

beforeEach(() => mocks.rpc.mockReset());

describe("core: a pilot's Activate says why its AdBrain balance can't cover the run (#782)", () => {
  it("names a cause for every refusal the production reserve SQL can raise", async () => {
    const refusals = reserveRefusals();
    expect(refusals).toEqual(expect.arrayContaining([
      "Campaign customer binding changed",
      "Current attributed media and tax evidence required",
      "Existing activation must be reconciled before another attempt",
      "Insufficient customer advertising allowance",
      "Below the Meta campaign spend cap minimum",
    ]));
    for (const message of refusals) {
      mocks.rpc.mockImplementation((name: string) => ({
        abortSignal: async () => name === "customer_ad_balance"
          ? { data: balance, error: null }
          : { data: null, error: { message, code: "23514", details: null, hint: null } },
      }));
      const error = await reserveCustomerCampaign(actor, { ...admission, minMediaLimitPaise: 500_000 }).catch((caught: unknown) => caught);
      if (!(error instanceof CustomerBalanceError)) throw new Error(`${message}: expected a CustomerBalanceError`);
      expect(error.code, message).not.toBe("UNVERIFIED");
      expect(error.message, message).not.toMatch(/could not be verified/);
    }
  });

  it("tells a pilot with no AdBrain balance what to do, with the run's amount", async () => {
    mocks.rpc.mockImplementation((name: string) => ({
      abortSignal: async () => name === "customer_ad_balance"
        ? { data: balance, error: null }
        : { data: null, error: { message: "Insufficient customer advertising allowance", code: "23514", details: null, hint: null } },
    }));
    await expect(reserveCustomerCampaign(actor, admission)).rejects.toMatchObject({
      code: "BALANCE_INSUFFICIENT", message: "There's no AdBrain balance for ads yet. Add funds to run this campaign (₹450 cap plus GST).",
    });
  });
});
