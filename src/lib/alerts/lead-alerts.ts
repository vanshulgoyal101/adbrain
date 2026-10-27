import { answersLine, deliverOwnerAlert, type AlertConfig, type AlertLanguage, type AlertStore } from "@/lib/alerts/sender";

/** #701 v1: only leads Meta received in the last 24 h get an alert (CPO spec §2). */
export const LEAD_ALERT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** Alerts sent per business per sync run; the rest go on the next run (still under 24 h old). */
export const LEAD_ALERTS_PER_RUN = 20;

export type AlertLead = {
  id: string;
  meta_lead_id: string;
  full_name: string | null;
  phone: string | null;
  field_data: unknown;
  form_name: string | null;
  campaignName: string | null;
};

const NOT_GIVEN: Record<AlertLanguage, string> = { en: "not given", hi: "नहीं दिया" };
const CONTACT_KEY = /^(full_name|first_name|last_name|name)$|phone|mobile|email|whatsapp/;

/** "+919800000009" → "+91 98000 00009"; WhatsApp turns it into a tap-to-call link. */
export function displayPhone(phone: string | null): string | null {
  if (!phone) return null;
  const india = /^\+?91(\d{5})(\d{5})$/.exec(phone);
  return india ? `+91 ${india[1]} ${india[2]}` : phone;
}

/** The form's other answers: "What is your monthly bill: ₹3,000 · City: Mohali". */
export function leadAnswers(fieldData: unknown): { question: string; answer: string }[] {
  if (!fieldData || typeof fieldData !== "object" || Array.isArray(fieldData)) return [];
  return Object.entries(fieldData as Record<string, unknown>)
    .filter(([key, value]) => typeof value === "string" && value.trim() && !CONTACT_KEY.test(key))
    .map(([key, value]) => {
      const question = key.replace(/_+/g, " ").replace(/\?+$/, "").trim();
      return { question: question.charAt(0).toUpperCase() + question.slice(1), answer: value as string };
    });
}

/** `adbrain_lead_alert` body: {{1}} business, {{2}} name, {{3}} phone, {{4}} answers, {{5}} ad. */
export function leadAlertParams(businessName: string, lead: AlertLead, language: AlertLanguage): string[] {
  const missing = NOT_GIVEN[language];
  const answers = leadAnswers(lead.field_data);
  return [
    businessName.trim() || "AdBrain",
    lead.full_name?.trim() || missing,
    displayPhone(lead.phone) ?? missing,
    answers.length ? answersLine(answers) : missing,
    lead.campaignName?.trim() || lead.form_name?.trim() || missing,
  ];
}

type Query = PromiseLike<{ data: unknown; error: unknown }> & Record<string, (...args: unknown[]) => Query>;
type Db = { from(table: string): Query };

export type LeadAlertRun = { sent: number; skipped: Record<string, number> } | { error: string };

/**
 * After a sync, alerts the owner once per new form lead under 24 h old (#701 v1). Skips quietly
 * when alerts are off for this business; leads already alerted (any state but `retry`) are not
 * claimed again. Meta's answer is recorded by `deliverOwnerAlert`; lead data is never logged.
 */
export async function sendNewLeadAlerts(
  deps: { db: Db; store: AlertStore; config: AlertConfig | null; now?: Date; fetchImpl?: typeof fetch; signal?: AbortSignal },
  businessId: string,
): Promise<LeadAlertRun | null> {
  if (!deps.config) return null;
  const { db } = deps;
  const { data: prefs, error: prefsError } = await db.from("owner_alert_prefs").select("lead_alerts")
    .eq("business_id", businessId).eq("lead_alerts", true).not("verified_at", "is", null)
    .is("opted_out_at", null).is("paused_at", null).maybeSingle();
  if (prefsError) return { error: "prefs" };
  if (!prefs) return null;

  const since = new Date((deps.now ?? new Date()).getTime() - LEAD_ALERT_MAX_AGE_MS).toISOString();
  const { data: leadRows, error: leadsError } = await db.from("leads")
    .select("id, meta_lead_id, full_name, phone, field_data, form_name, campaign_id")
    .eq("business_id", businessId).eq("source", "meta_form").not("meta_lead_id", "is", null)
    .gte("created_time", since).order("created_time", { ascending: true }).limit(100);
  if (leadsError) return { error: "leads" };
  const leads = (leadRows ?? []) as (Omit<AlertLead, "campaignName"> & { campaign_id: string | null })[];
  if (!leads.length) return { sent: 0, skipped: {} };

  const { data: sendRows, error: sendsError } = await db.from("owner_alert_sends").select("dedupe_key")
    .eq("business_id", businessId).eq("kind", "lead").neq("state", "retry")
    .in("dedupe_key", leads.map((lead) => lead.meta_lead_id));
  if (sendsError) return { error: "sends" };
  const done = new Set(((sendRows ?? []) as { dedupe_key: string }[]).map((row) => row.dedupe_key));
  const pending = leads.filter((lead) => !done.has(lead.meta_lead_id)).slice(0, LEAD_ALERTS_PER_RUN);
  if (!pending.length) return { sent: 0, skipped: {} };

  const campaignIds = [...new Set(pending.map((lead) => lead.campaign_id).filter((id): id is string => Boolean(id)))];
  const [{ data: business }, campaigns] = await Promise.all([
    db.from("businesses").select("name").eq("id", businessId).maybeSingle(),
    campaignIds.length
      ? db.from("campaigns").select("id, name").eq("business_id", businessId).in("id", campaignIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const names = new Map(((campaigns.data ?? []) as { id: string; name: string | null }[]).map((row) => [row.id, row.name]));
  const businessName = (business as { name?: string } | null)?.name ?? "";

  const run = { sent: 0, skipped: {} as Record<string, number> };
  for (const lead of pending) {
    if (deps.signal?.aborted) { run.skipped.deadline = (run.skipped.deadline ?? 0) + 1; continue; }
    const alertLead: AlertLead = { ...lead, campaignName: lead.campaign_id ? names.get(lead.campaign_id) ?? null : null };
    const result = await deliverOwnerAlert({ store: deps.store, config: deps.config, fetchImpl: deps.fetchImpl }, {
      businessId, kind: "lead", key: lead.meta_lead_id, params: (language) => leadAlertParams(businessName, alertLead, language),
    });
    if (result.delivered) run.sent++;
    else run.skipped[result.reason] = (run.skipped[result.reason] ?? 0) + 1;
    // The owner switched off, opted out, got paused or hit a stop: the rest would be refused too.
    if (!result.delivered && ["off", "opted_out", "paused", "unverified", "template_blocked"].includes(result.reason)) break;
  }
  return run;
}
