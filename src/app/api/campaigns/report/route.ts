import { buildPerformanceReport } from "@/lib/campaign/report";
import { createClient } from "@/lib/supabase/server";
import {
  getPerformanceRows,
  getPrimaryBusiness,
} from "@/lib/supabase/queries";

export const runtime = "nodejs";

/** Download a Markdown performance report for the current business. */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const business = await getPrimaryBusiness();
  if (!business) {
    return new Response("No business found", { status: 400 });
  }

  const rows = await getPerformanceRows(business.id);
  const md = buildPerformanceReport({
    businessName: business.name,
    generatedAt: new Date(),
    rows,
  });

  const filename = `adbrain-report-${new Date().toISOString().slice(0, 10)}.md`;
  return new Response(md, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
