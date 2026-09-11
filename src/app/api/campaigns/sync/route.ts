import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPrimaryBusiness } from "@/lib/supabase/queries";
import { ConnectionAccessError, requireOwnedBusiness, withMetaConnection, getConnectionStatus } from "@/lib/meta/connection-access";
import { z } from "zod";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request?: Request) {
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
      let skipped = 0;
      for (let offset = 0; offset < page.campaigns.length; offset += 5) {
        const batch = await Promise.all(page.campaigns.slice(offset, offset + 5).map(async (campaign) => {
          try { return { campaign, binding: await meta.readBoundCampaign(campaign) }; }
          catch { return { campaign, binding: null }; }
        }));
        for (const { campaign, binding } of batch) {
          if (!binding) { skipped += 1; continue; }
          rows.push({
            business_id: context.businessId, name: campaign.name, objective: campaign.objective,
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
        if (existing?.meta_ad_account_id && (existing.meta_ad_account_id !== row.meta_ad_account_id || existing.meta_page_id !== row.meta_page_id)) { skipped += 1; continue; }
        const saved = existing
          ? await supabase.from("campaigns").update(row).eq("id", existing.id).eq("business_id", context.businessId)
          : await supabase.from("campaigns").insert(row);
        if (saved.error && saved.error.code !== "23505") throw new Error("Campaign save failed.");
      }
      return { skipped, nextCursor: page.nextCursor };
    });
    const { data: campaigns, error } = await supabase.from("campaigns").select("*").eq("business_id", business.id).order("created_at", { ascending: false });
    if (error) throw new Error("Synced campaigns could not be loaded.");
    return NextResponse.json({ campaigns, ...result });
  } catch (error) {
    const status = error instanceof ConnectionAccessError ? error.code === "CONFLICT" ? 409 : error.code === "FORBIDDEN" ? 403 : 400 : 502;
    return NextResponse.json({ error: error instanceof ConnectionAccessError ? error.message : "Campaign sync could not be completed. Existing campaigns are preserved." }, { status });
  }
}
