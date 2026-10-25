/**
 * #526 (2-Tier): where a new owner is in onboarding, read from their `managed_meta_accounts` row
 * (#519/#533) and whether they have paid (captured payments net of refunds, `customer_ad_balance`).
 * The owner does three things (pay, Page, WhatsApp); AdBrain does three in the background (child
 * business, ad account, funding: `funding_state` is the child account's payment setup, not the
 * owner's payment). Pure, so the screen and its tests agree.
 */
export type ManagedAccountState =
  | "requested" | "page_linked" | "child_created" | "ad_account_created" | "funded"
  | "whatsapp_linked" | "ready" | "failed" | "offboarding" | "offboarded";
export type FundingState = "none" | "card_attached" | "invoiced" | "failed";

export type ManagedAccountProgressRow = {
  state: ManagedAccountState;
  funding_state: FundingState;
  page_id: string | null;
  child_business_id: string | null;
  ad_account_id: string | null;
  waba_id: string | null;
  phone_number_id: string | null;
  /** #524 v1: the number linked to the customer's Page (Meta-verified). */
  whatsapp_number_e164?: string | null;
  last_error: string | null;
};

/** done; current = the owner's turn; working = AdBrain is on it; waiting = not yet; failed. */
export type StepStatus = "done" | "current" | "working" | "waiting" | "failed";
type CustomerStep = "pay" | "page" | "whatsapp";
type BackgroundStep = "childBusiness" | "adAccount" | "funding";

export type OnboardingProgress = {
  customer: Record<CustomerStep, StepStatus>;
  background: Record<BackgroundStep, StepStatus>;
  ready: boolean;
  failed: { step: CustomerStep | BackgroundStep; code: string | null } | null;
};

const FUNDED: ManagedAccountState[] = ["funded", "whatsapp_linked", "ready"];
const WHATSAPP: ManagedAccountState[] = ["whatsapp_linked", "ready"];

export function onboardingProgress(row: ManagedAccountProgressRow | null, { paid }: { paid: boolean }): OnboardingProgress {
  const page = Boolean(row?.page_id);
  const child = Boolean(row?.child_business_id);
  const account = Boolean(row?.ad_account_id);
  const funded = row ? FUNDED.includes(row.state) : false;
  // Recorded as soon as the Page's number is found, even while the ledger waits on funding (#524).
  const whatsapp = row ? WHATSAPP.includes(row.state) || Boolean(row.whatsapp_number_e164) || Boolean(row.waba_id && row.phone_number_id) : false;

  const customer: Record<CustomerStep, StepStatus> = {
    pay: paid ? "done" : "current",
    page: page ? "done" : paid ? "current" : "waiting",
    whatsapp: whatsapp ? "done" : page ? "current" : "waiting",
  };
  const background: Record<BackgroundStep, StepStatus> = {
    childBusiness: child ? "done" : page ? "working" : "waiting",
    adAccount: account ? "done" : child ? "working" : "waiting",
    funding: funded ? "done" : account && paid ? "working" : "waiting",
  };

  let failed: OnboardingProgress["failed"] = null;
  if (row?.funding_state === "failed") failed = { step: "funding", code: row.last_error };
  else if (row?.state === "failed") {
    // The first unfinished step, in the order the ledger moves through them.
    const order: [CustomerStep | BackgroundStep, boolean][] = [
      ["pay", paid], ["page", page], ["childBusiness", child], ["adAccount", account], ["funding", funded], ["whatsapp", whatsapp],
    ];
    const step = order.find(([, finished]) => !finished)?.[0];
    if (step) failed = { step, code: row.last_error };
  }
  if (failed) {
    for (const map of [customer, background] as Record<string, StepStatus>[]) {
      for (const key of Object.keys(map)) {
        if (key === failed.step) map[key] = "failed";
        else if (map[key] === "working" || map[key] === "current") map[key] = "waiting";
      }
    }
  }
  return { customer, background, ready: row?.state === "ready", failed };
}
