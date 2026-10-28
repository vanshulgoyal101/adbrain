import { createAdminClient } from "@/lib/supabase/admin";
import { isInternalUser } from "@/lib/internal-accounts";
import { fundingMode } from "@/lib/payments/operator-funding";
import { createProductionPaymentClient } from "@/lib/payments/razorpay-production";
import { planStatus, type PlanStatus } from "@/lib/plan/status";
import { handlePlanWebhook } from "@/lib/plan/webhook";

/** #718 slice 2: off until DevOps turns it on; then own-account businesses see the plan and the gate applies. */
export const isPlanBillingEnabled = (environment: Readonly<Record<string, string | undefined>> = process.env) =>
  environment.PLAN_BILLING_ENABLED === "true";

export class PlanNotDueError extends Error {}

const LINK_LIFETIME_S = 30 * 24 * 3_600;

/** Pay now: the last 7 days of a free or paid month, or once it's unpaid. */
export const isPayable = (status: PlanStatus) =>
  status.state === "unpaid" || ((status.state === "free" || status.state === "paid") && status.dueSoon);

/** Indian numbers as +91XXXXXXXXXX for Razorpay's SMS; anything else is left out. */
export function planContact(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (/^[6-9]\d{9}$/.test(digits)) return `+91${digits}`;
  if (/^91[6-9]\d{9}$/.test(digits)) return `+${digits}`;
  return null;
}

type PeriodRow = { state: string; starts_at: string | null; ends_at: string | null; paid_at: string | null; short_url: string | null;
  payment_link_id: string | null; created_at: string };

const readPeriods = (db: ReturnType<typeof createAdminClient>, businessId: string) =>
  db.from("plan_periods").select("state, starts_at, ends_at, paid_at, short_url, payment_link_id, created_at").eq("business_id", businessId);

/**
 * #1583 (Reviewer): the month only leaves `open` through the payment_link webhook. If that delivery was lost, the link
 * is dead (or paid) while the gate still blocks new ads. Once it has outlived LINK_LIFETIME_S, ask Razorpay and replay
 * the webhook's own checks: paid settles the month, expired/cancelled frees it for a fresh link. True when it changed.
 */
async function settleStaleLink(db: ReturnType<typeof createAdminClient>, periods: PeriodRow[], now: Date): Promise<boolean> {
  const open = periods.find((period) => period.state === "open" && period.payment_link_id);
  if (!open?.payment_link_id || Date.parse(open.created_at) + LINK_LIFETIME_S * 1000 > now.getTime()) return false;
  const link = await createProductionPaymentClient().fetchPlanLink(open.payment_link_id);
  const event = link.status === "paid" ? "payment_link.paid" : link.status === "expired" || link.status === "cancelled" ? "payment_link.expired" : null;
  if (!event) return false;
  const result = await handlePlanWebhook({ event, payload: { payment_link: { entity: { id: link.id } } } }, {
    fetchPlanLink: async () => link,
    rpc: async (name: "plan_period_paid" | "plan_period_expire", args: Record<string, string>) => {
      const { data, error } = await db.rpc(name, args as never);
      if (error) throw new Error("Plan is unavailable.");
      return data;
    },
    now: () => now,
  });
  return result === "paid" || result === "expired";
}

async function load(businessId: string, now: Date) {
  const db = createAdminClient();
  const [business, launch, firstRead, mode] = await Promise.all([
    db.from("businesses").select("owner_id, phone").eq("id", businessId).maybeSingle(),
    db.from("campaigns").select("launched_at").eq("business_id", businessId).not("launched_at", "is", null).order("launched_at").limit(1),
    readPeriods(db, businessId),
    fundingMode(businessId),
  ]);
  if (business.error || !business.data || launch.error || firstRead.error) throw new Error("Plan is unavailable.");
  // A failed check keeps today's answer; the next read or the daily cron tries again.
  const settled = await settleStaleLink(db, firstRead.data as PeriodRow[], now).catch(() => false);
  const periods = settled ? await readPeriods(db, businessId) : firstRead;
  if (periods.error) throw new Error("Plan is unavailable.");
  const { data: owner, error } = await db.auth.admin.getUserById(business.data.owner_id);
  if (error || !owner?.user) throw new Error("Plan is unavailable.");
  const status = planStatus({
    exempt: mode !== "own" || isInternalUser(owner.user),
    firstLaunchAt: launch.data[0]?.launched_at ?? null,
    periods: periods.data.map((period) => ({ kind: "paid", state: period.state, startsAt: period.starts_at, endsAt: period.ends_at, paidAt: period.paid_at })),
    now,
  });
  const openUrl = periods.data.find((period) => period.state === "open")?.short_url ?? null;
  return { status, payUrl: isPayable(status) ? openUrl : null, email: owner.user.email ?? null, phone: planContact(business.data.phone) };
}

export async function readPlan(businessId: string, now = new Date()): Promise<{ status: PlanStatus; payUrl: string | null }> {
  const { status, payUrl } = await load(businessId, now);
  return { status, payUrl };
}

/**
 * The month's payment link, made once. Razorpay keeps `reference_id` (the month) unique, so a raced or failed
 * create finds the existing link instead of making a second one an owner could also pay.
 */
export async function ensurePayLink(businessId: string, now = new Date()): Promise<string> {
  const plan = await load(businessId, now);
  if (!isPayable(plan.status)) throw new PlanNotDueError();
  if (plan.payUrl) return plan.payUrl;
  const db = createAdminClient();
  const opened = await db.rpc("plan_period_open", { p_business_id: businessId });
  if (opened.error || !opened.data) throw new Error("Plan is unavailable.");
  if (opened.data.shortUrl) return opened.data.shortUrl;
  const client = createProductionPaymentClient();
  const link = await client.createPlanLink({
    periodId: opened.data.periodId, businessId, email: plan.email, phone: plan.phone, expireBy: Math.floor(now.getTime() / 1000) + LINK_LIFETIME_S,
  }).catch(async (reason: unknown) => (await client.findPlanLink(opened.data.periodId)) ?? Promise.reject(reason));
  const attached = await db.rpc("plan_period_set_link", { p_period_id: opened.data.periodId, p_link_id: link.id, p_short_url: link.shortUrl });
  if (attached.error) throw new Error("Plan is unavailable.");
  return link.shortUrl;
}
