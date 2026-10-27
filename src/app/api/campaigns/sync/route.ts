import { observeRoute } from "@/lib/observability/logger";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCampaignPage, getPrimaryBusiness } from "@/lib/supabase/queries";
import { ConnectionAccessError, requireOwnedBusiness, withMetaConnection, getConnectionStatus } from "@/lib/meta/connection-access";
import { z } from "zod";
import { saveCampaign } from "@/lib/campaign/trusted-write";
import { storedCappedAdSetIds } from "@/lib/campaign/activation";
import type { SkippedCampaign } from "@/lib/campaign/sync-skips";
import { createAdminClient } from "@/lib/supabase/admin";
import { campaignsOwnedElsewhere, type CampaignClaim } from "@/lib/campaign/sync-ownership";

export const runtime = "nodejs";
export const maxDuration = 60;

export const POST = observeRoute("/api/campaigns/sync", "POST", handlePOST);

async function handlePOST(request?: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const business = await getPrimaryBusiness();
  if (!business) {
    return NextResponse.json({ error: "No business found" }, { status: 400 });
  }

  const cursor = z.string().min(1).max(2_000).nullable().safeParse(request ? new URL(request.url).searchParams.get("after") : null);
  if (!cursor.success) return NextResponse.json({ error: "Invalid sync cursor." }, { status: 400 });
  try {
    const context = await requireOwnedBusiness(business.id);
    const result = await withMetaConnection(context, { purpose: "read_insights" }, async (meta, connection) => {
      if (!connection.selected || connection.selected.currency !== "INR") throw new Error("Unsupported connection currency.");
      const page = await meta.listCampaignsPage(cursor.data ?? undefined);
      const rows = [];
      const skippedCampaigns: SkippedCampaign[] = [];
      // #1057: other businesses' rows are hidden by RLS, so ownership is read with the service role (ids only).
      const ids = page.campaigns.map(campaign => campaign.id);
      const claims = ids.length ? await createAdminClient().from("campaigns")
        .select("meta_campaign_id,business_id,created_at,source:raw->>source").in("meta_campaign_id", ids) : { data: [], error: null };
      if (claims.error || !claims.data) throw new Error("Campaign storage unavailable.");
      const elsewhere = campaignsOwnedElsewhere(claims.data as unknown as CampaignClaim[], context.businessId);
      for (let offset = 0; offset < page.campaigns.length; offset += 5) {
        const batch = await Promise.all(page.campaigns.slice(offset, offset + 5).map(async (campaign) => {
          if (campaign.status !== "ACTIVE" && campaign.status !== "PAUSED") return { campaign, binding: { skip: "not_running" as const } };
          if (elsewhere.has(campaign.id)) return { campaign, binding: { skip: "other_business" as const } };
          const { data: stored, error } = await supabase.from("campaigns").select("raw")
            .eq("business_id", context.businessId).eq("meta_campaign_id", campaign.id).maybeSingle();
          if (error) throw new Error("Campaign storage unavailable.");
          return { campaign, binding: await meta.readBoundCampaign(campaign, storedCappedAdSetIds(stored?.raw)) };
        }));
        for (const { campaign, binding } of batch) {
          if ("skip" in binding) { skippedCampaigns.push({ name: campaign.name ?? null, reason: binding.skip }); continue; }
          rows.push({
            business_id: context.businessId, name: campaign.name, objective: campaign.objective,
            destination: binding.destination,
            daily_budget: binding.dailyBudgetRupees, status: campaign.status === "ACTIVE" ? "active" as const : "paused" as const,
            meta_campaign_id: campaign.id, meta_adset_id: binding.adSetId,
            meta_ad_account_id: connection.selected.adAccountId, meta_page_id: connection.selected.pageId,
            meta_connection_generation: connection.generation,
          });
        }
      }
      const current = await getConnectionStatus(context);
      if (current.generation !== connection.generation || current.authorization !== "connected") throw new ConnectionAccessError("CONFLICT", "Meta connection changed during sync. Try again.");
      for (const row of rows) {
        const { data: existing, error } = await supabase.from("campaigns").select("id,meta_ad_account_id,meta_page_id")
          .eq("business_id", context.businessId).eq("meta_campaign_id", row.meta_campaign_id).maybeSingle();
        if (error) throw new Error("Campaign storage unavailable.");
        if ((existing?.meta_ad_account_id && existing.meta_ad_account_id !== row.meta_ad_account_id)
          || (existing?.meta_page_id && existing.meta_page_id !== row.meta_page_id)) { skippedCampaigns.push({ name: row.name ?? null, reason: "other_connection" }); continue; }
        const saved = await saveCampaign(context, row, existing?.id);
        if (saved.error) throw new Error("Campaign save failed.");
      }
      return { skipped: skippedCampaigns.length, skippedCampaigns, nextCursor: page.nextCursor };
    });
    const page = await getCampaignPage(business.id);
    return NextResponse.json({ campaigns: page.campaigns, pageCursor: page.nextCursor, ...result });
  } catch (error) {
    const status = error instanceof ConnectionAccessError ? error.code === "CONFLICT" ? 409 : error.code === "FORBIDDEN" ? 403 : 400 : 502;
    return NextResponse.json({ error: error instanceof ConnectionAccessError ? error.message : "Campaign sync could not be completed. Existing campaigns are preserved." }, { status });
  }
}
