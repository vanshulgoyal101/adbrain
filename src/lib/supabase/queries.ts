import { cookies } from "next/headers";
import {
  DEV_AUTH_COOKIE,
  DEV_USER,
  isDevAuthEnabled,
  type AppUser,
} from "@/lib/dev-auth";
import { buildPerformanceContext } from "@/lib/campaign/performance";
import type { ReportRow } from "@/lib/campaign/report";
import {
  DEFAULT_SPEND_LIMITS,
  evaluateSpend,
  type CampaignSpend,
  type SpendEvaluation,
  type SpendLimits,
} from "@/lib/campaign/spend";
import { createClient } from "@/lib/supabase/server";
import type {
  AdInstruction,
  AuditLog,
  BrandAsset,
  Business,
  Campaign,
  CampaignResult,
  Creative,
  Lead,
} from "@/lib/types";

/** Current authenticated user, or null. A real Supabase session always wins;
 * the dev bypass cookie is only a fallback when there's no real session. */
export async function getUser(): Promise<AppUser | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) return { id: user.id, email: user.email ?? null };

  if (isDevAuthEnabled()) {
    const store = await cookies();
    if (store.get(DEV_AUTH_COOKIE)?.value === "1") return DEV_USER;
  }
  return null;
}

/** All businesses owned by the current user (RLS-scoped). */
export async function getBusinesses(): Promise<Business[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("businesses")
    .select("*")
    .order("created_at", { ascending: true });
  return data ?? [];
}

/** The user's first business (v1 is single-business per user). */
export async function getPrimaryBusiness(): Promise<Business | null> {
  const businesses = await getBusinesses();
  return businesses[0] ?? null;
}

export async function getBusinessById(id: string): Promise<Business | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("businesses")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return data ?? null;
}

/** Creatives for a business, newest first. */
export async function getCreatives(businessId: string): Promise<Creative[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("creatives")
    .select("*")
    .eq("business_id", businessId)
    .order("created_at", { ascending: false });
  return data ?? [];
}

/** Brand assets for a business, newest first. */
export async function getBrandAssets(
  businessId: string,
): Promise<BrandAsset[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("brand_assets")
    .select("*")
    .eq("business_id", businessId)
    .order("created_at", { ascending: false });
  return data ?? [];
}

/** Approved creatives for a business, newest first. */
export async function getApprovedCreatives(
  businessId: string,
): Promise<Creative[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("creatives")
    .select("*")
    .eq("business_id", businessId)
    .eq("status", "approved")
    .order("created_at", { ascending: false });
  return data ?? [];
}

/** Campaigns for a business, newest first. */
export async function getCampaigns(businessId: string): Promise<Campaign[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("campaigns")
    .select("*")
    .eq("business_id", businessId)
    .order("created_at", { ascending: false });
  return data ?? [];
}

/** Latest result row per campaign, keyed by campaign id. */
export async function getLatestResults(
  campaignIds: string[],
): Promise<Record<string, CampaignResult>> {
  if (!campaignIds.length) return {};
  const supabase = await createClient();
  const { data } = await supabase
    .from("campaign_results")
    .select("*")
    .in("campaign_id", campaignIds)
    .order("fetched_at", { ascending: false });
  const map: Record<string, CampaignResult> = {};
  for (const row of data ?? []) {
    if (!map[row.campaign_id]) map[row.campaign_id] = row;
  }
  return map;
}

/** A business's spend guardrail settings (defaults when none saved). */
export async function getSpendLimits(businessId: string): Promise<SpendLimits> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("spend_limits")
    .select("weekly_cap_rupees, alert_pct, auto_pause")
    .eq("business_id", businessId)
    .maybeSingle();
  if (!data) return { ...DEFAULT_SPEND_LIMITS };
  return {
    weeklyCapRupees: data.weekly_cap_rupees,
    alertPct: data.alert_pct,
    autoPause: data.auto_pause,
  };
}

/** Campaigns mapped to the minimal shape the spend guardrails need. */
export async function getCampaignSpend(
  businessId: string,
): Promise<CampaignSpend[]> {
  const campaigns = await getCampaigns(businessId);
  if (!campaigns.length) return [];
  const results = await getLatestResults(campaigns.map((c) => c.id));
  return campaigns.map((c) => ({
    id: c.id,
    status: c.status,
    dailyBudget: c.daily_budget,
    spend: results[c.id]?.spend ?? 0,
  }));
}

/** Evaluate a business's spend guardrail status. */
export async function getSpendEvaluation(
  businessId: string,
): Promise<{ limits: SpendLimits; evaluation: SpendEvaluation }> {
  const [limits, campaigns] = await Promise.all([
    getSpendLimits(businessId),
    getCampaignSpend(businessId),
  ]);
  return { limits, evaluation: evaluateSpend(campaigns, limits) };
}

/** All instruction files for a business, oldest first. */
export async function getAdInstructions(
  businessId: string,
): Promise<AdInstruction[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("ad_instructions")
    .select("*")
    .eq("business_id", businessId)
    .order("created_at", { ascending: true });
  return data ?? [];
}

/** Concatenated text of the active instruction files (for prompt injection). */
export async function getActiveInstructionsText(
  businessId: string,
): Promise<string> {
  const instructions = await getAdInstructions(businessId);
  return instructions
    .filter((i) => i.is_active)
    .map((i) => `## ${i.title}\n${i.content}`)
    .join("\n\n")
    .slice(0, 6000);
}

/** Recent audit-log events for a business, newest first. */
export async function getAuditLog(
  businessId: string,
  limit = 50,
): Promise<AuditLog[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("audit_log")
    .select("*")
    .eq("business_id", businessId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return data ?? [];
}

export async function getLeads(
  businessId: string,
  limit = 200,
): Promise<Lead[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("leads")
    .select("*")
    .eq("business_id", businessId)
    .order("created_time", { ascending: false, nullsFirst: false })
    .limit(limit);
  return data ?? [];
}

/**
 * Rich per-campaign performance rows (targeting + full metrics) for the report
 * export and the planner's learning context.
 */
export async function getPerformanceRows(
  businessId: string,
): Promise<ReportRow[]> {
  const campaigns = await getCampaigns(businessId);
  if (!campaigns.length) return [];

  const results = await getLatestResults(campaigns.map((c) => c.id));

  const creativeIds = [
    ...new Set(campaigns.flatMap((c) => c.creative_ids ?? [])),
  ];
  const angleById = new Map<string, string | null>();
  if (creativeIds.length) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("creatives")
      .select("id, angle")
      .in("id", creativeIds);
    for (const c of data ?? []) angleById.set(c.id, c.angle);
  }

  return campaigns.map((c) => {
    const r = results[c.id];
    const raw = (c.raw ?? {}) as { plan?: { area?: string }; area?: string };
    const angles = [
      ...new Set(
        (c.creative_ids ?? [])
          .map((id) => angleById.get(id))
          .filter((a): a is string => !!a),
      ),
    ];
    return {
      name: c.name ?? `${c.objective} campaign`,
      angles,
      area: raw.plan?.area ?? raw.area ?? null,
      dailyBudget: c.daily_budget ?? null,
      status: c.status,
      impressions: r?.impressions ?? 0,
      clicks: r?.clicks ?? 0,
      leads: r?.leads ?? 0,
      spend: r?.spend ?? 0,
      cpl: r?.cpl ?? null,
    };
  });
}

/**
 * A compact, ranked summary of past campaigns and their results, for the planner
 * to learn from. Returns "" when there's nothing meaningful yet.
 */
export async function getPerformanceContext(businessId: string): Promise<string> {
  const rows = await getPerformanceRows(businessId);
  return buildPerformanceContext(rows);
}
