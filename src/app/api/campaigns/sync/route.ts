import { NextResponse } from "next/server";
import { logEvent } from "@/lib/audit";
import { metaClientFromEnv } from "@/lib/meta/client";
import { createClient } from "@/lib/supabase/server";
import { getPrimaryBusiness } from "@/lib/supabase/queries";
import type { CampaignStatus, Json } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

function mapStatus(s: string): CampaignStatus {
  switch ((s ?? "").toUpperCase()) {
    case "ACTIVE":
      return "active";
    case "PAUSED":
      return "paused";
    case "ARCHIVED":
    case "DELETED":
    case "COMPLETED":
      return "completed";
    default:
      return "draft";
  }
}

function mapObjective(o: string): string {
  const m = (o ?? "").toUpperCase();
  if (!m) return "leads";
  if (m.includes("LEAD")) return "leads";
  if (m.includes("TRAFFIC")) return "traffic";
  if (m.includes("SALES") || m.includes("CONVERSION")) return "sales";
  if (m.includes("ENGAGEMENT")) return "engagement";
  if (m.includes("AWARENESS")) return "awareness";
  if (m.includes("APP")) return "app";
  return m.replace(/^OUTCOME_/, "").toLowerCase();
}

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
  for (const mc of metaCampaigns) {
    const row = {
      business_id: business.id,
      name: mc.name,
      objective: mapObjective(mc.objective),
      daily_budget: mc.daily_budget ? Number(mc.daily_budget) / 100 : null,
      status: mapStatus(mc.status),
      meta_campaign_id: mc.id,
      raw: mc as unknown as Json,
    };
    const { data: existing } = await supabase
      .from("campaigns")
      .select("id")
      .eq("meta_campaign_id", mc.id)
      .maybeSingle();
    if (existing) {
      await supabase.from("campaigns").update(row).eq("id", existing.id);
    } else {
      await supabase.from("campaigns").insert(row);
    }
    synced++;
  }

  await logEvent({
    businessId: business.id,
    action: "campaigns.sync",
    entityType: "campaign",
    reason: `Synced ${synced} campaign(s) from Meta`,
    details: { count: synced },
  });

  const { data: campaigns } = await supabase
    .from("campaigns")
    .select("*")
    .eq("business_id", business.id)
    .order("created_at", { ascending: false });

  return NextResponse.json({ synced, campaigns: campaigns ?? [] });
}
