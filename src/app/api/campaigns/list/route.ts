import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getCampaignPage, getLatestResults } from "@/lib/supabase/queries";
import { ConnectionAccessError, requireOwnedBusiness } from "@/lib/meta/connection-access";
import { observeRoute } from "@/lib/observability/logger";

const querySchema = z.object({
  businessId: z.uuid(), cursor: z.string().max(1000).optional(), query: z.string().trim().max(200).optional(),
  status: z.enum(["draft", "active", "paused", "completed"]).optional(),
}).strict();

export const GET = observeRoute("/api/campaigns/list", "GET", async (request: Request) => {
  const database = await createClient();
  const { data: { user } } = await database.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return NextResponse.json({ error: "Invalid campaign filters." }, { status: 400 });
  try {
    const actor = await requireOwnedBusiness(parsed.data.businessId);
    const page = await getCampaignPage(actor.businessId, parsed.data);
    const results = await getLatestResults(page.campaigns.map(campaign => campaign.id));
    return NextResponse.json({ ...page, results });
  } catch (error) {
    const status = error instanceof z.ZodError || error instanceof SyntaxError ? 400
      : error instanceof ConnectionAccessError ? error.code === "FORBIDDEN" ? 403 : error.code === "NOT_FOUND" ? 404 : 503 : 503;
    return NextResponse.json({ error: "Campaign list could not be loaded." }, { status });
  }
});