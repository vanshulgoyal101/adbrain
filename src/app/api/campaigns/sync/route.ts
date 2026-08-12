import { NextResponse } from "next/server";
import { logEvent } from "@/lib/audit";
import { metaClientFromEnv } from "@/lib/meta/client";
import {
  mapCampaignObjective,
  mapCampaignStatus,
} from "@/lib/meta/mappers";
import { createClient } from "@/lib/supabase/server";
import { getPrimaryBusiness } from "@/lib/supabase/queries";
import type { Json } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST() {
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

  const meta = metaClientFromEnv();
  if (!meta) {
    return NextResponse.json({ error: "Meta is not configured" }, { status: 400 });
  }

  let metaCampaigns;
  try {
    metaCampaigns = await meta.listCampaigns();
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }

  let synced = 0;
  const failed: string[] = [];
  for (const mc of metaCampaigns) {
    const row = {
      business_id: business.id,
      name: mc.name,
      objective: mapCampaignObjective(mc.objective),
      // daily_budget is NOT NULL; Meta omits it for adset-budget campaigns.
      daily_budget: mc.daily_budget ? Number(mc.daily_budget) / 100 : 0,
      status: mapCampaignStatus(mc.status),
      meta_campaign_id: mc.id,
      raw: mc as unknown as Json,
    };
    const { data: existing } = await supabase
      .from("campaigns")
      .select("id")
      .eq("meta_campaign_id", mc.id)
      .maybeSingle();
    const { error } = existing
      ? await supabase.from("campaigns").update(row).eq("id", existing.id)
      : await supabase.from("campaigns").insert(row);
    if (error) {
      console.error("[campaigns.sync] upsert failed", mc.id, error);
      failed.push(mc.name || mc.id);
    } else {
      synced++;
    }
  }

  await logEvent({
    businessId: business.id,
    action: "campaigns.sync",
    entityType: "campaign",
    reason: `Synced ${synced} campaign(s) from Meta`,
    details: { count: synced, failed: failed.length },
  });

  const { data: campaigns } = await supabase
    .from("campaigns")
    .select("*")
    .eq("business_id", business.id)
    .order("created_at", { ascending: false });

  return NextResponse.json({ synced, failed, campaigns: campaigns ?? [] });
}
