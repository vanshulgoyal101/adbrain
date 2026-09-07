import { NextResponse } from "next/server";
import { logEvent } from "@/lib/audit";
import { getEnv } from "@/lib/env";
import { metaClientForBusiness } from "@/lib/meta/credentials";
import { rateLimitResponse } from "@/lib/security/rate-limit";
import { getPrimaryBusiness } from "@/lib/supabase/queries";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

interface RunBody {
  rounds?: number;
  createDraftCampaigns?: boolean;
  campaignsPerRound?: number;
}

interface RoundSummary {
  round: number;
  calls: number;
  campaignsSeen: number;
  insightsFetched: number;
  formsSeen: number;
  leadsFetched: number;
  campaignsCreated: number;
  errors: string[];
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Internal tool: it burns Meta quota and creates real (paused) campaigns, so
  // it is allowlisted by email. With no allowlist it stays off in production.
  const allowed = getEnv().TRAFFIC_GENERATOR_ALLOWED_EMAILS;
  if (!allowed.length) {
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
  } else {
    const email = user.email?.toLowerCase() ?? "";
    if (!allowed.some((e) => e.toLowerCase() === email)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  // Heaviest endpoint in the app (loops of Meta calls + campaign creation) —
  // rate-limit per user like the other expensive routes.
  const limited = await rateLimitResponse(`meta-traffic:${user.id}`, {
    limit: 10,
    windowMs: 10 * 60_000,
  });
  if (limited) return limited;

  const body = (await req.json().catch(() => ({}))) as RunBody;
  const env = getEnv();
  const rounds = clampInt(body.rounds, 1, env.TRAFFIC_GENERATOR_MAX_ROUNDS, 5);
  const createDraftCampaigns = body.createDraftCampaigns === true;
  const campaignsPerRound = clampInt(body.campaignsPerRound, 1, 3, 1);
  if (createDraftCampaigns) {
    return NextResponse.json(
      { error: "Campaign creation mode is disabled until Meta Instant Connect uses draft preflight." },
      { status: 400 },
    );
  }

  const business = await getPrimaryBusiness();
  if (!business) {
    return NextResponse.json({ error: "No business found" }, { status: 400 });
  }

  const meta = await metaClientForBusiness(business.id);
  if (!meta) {
    return NextResponse.json({ error: "Meta is not configured" }, { status: 400 });
  }

  const roundsSummary: RoundSummary[] = [];
  let totalCalls = 0;
  const totalCreated = 0;

  for (let i = 1; i <= rounds; i++) {
    const summary: RoundSummary = {
      round: i,
      calls: 0,
      campaignsSeen: 0,
      insightsFetched: 0,
      formsSeen: 0,
      leadsFetched: 0,
      campaignsCreated: 0,
      errors: [],
    };

    try {
      const campaigns = await meta.listCampaigns(50);
      summary.calls += 1;
      summary.campaignsSeen = campaigns.length;

      for (const campaign of campaigns.slice(0, 5)) {
        try {
          await meta.getCampaignInsights(campaign.id);
          summary.calls += 1;
          summary.insightsFetched += 1;
        } catch (err) {
          summary.errors.push((err as Error).message);
        }
      }
    } catch (err) {
      summary.errors.push((err as Error).message);
    }

    try {
      const forms = await meta.listLeadForms();
      summary.calls += 1;
      summary.formsSeen = forms.length;

      for (const form of forms.slice(0, 3)) {
        try {
          const leads = await meta.listLeadsForForm(form.id, { limit: 25 });
          summary.calls += 1;
          summary.leadsFetched += leads.length;
        } catch (err) {
          summary.errors.push((err as Error).message);
        }
      }
    } catch (err) {
      summary.errors.push((err as Error).message);
    }

    totalCalls += summary.calls;
    roundsSummary.push(summary);
  }

  await logEvent({
    businessId: business.id,
    action: "meta.traffic.run",
    entityType: "campaign",
    reason: `Ran internal traffic generator for ${rounds} round(s)`,
    details: {
      rounds,
      createDraftCampaigns,
      campaignsPerRound,
      totalCalls,
      totalCreated,
      perRound: roundsSummary,
    },
  });

  const status = totalCalls > 0 ? 200 : 502;
  const metaError = status === 502 ? "No successful Meta API calls were completed." : null;

  return NextResponse.json(
    {
      ok: status === 200,
      error: metaError,
      businessId: business.id,
      rounds,
      createDraftCampaigns,
      campaignsPerRound,
      totalCalls,
      totalCreated,
      roundsSummary,
    },
    { status },
  );
}
