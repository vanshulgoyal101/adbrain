import { NextResponse } from "next/server";
import { metaClientFromEnv } from "@/lib/meta/client";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * Typeahead for campaign location targeting. Returns Meta's real geo keys so the
 * UI never has to guess — the user picks an exact city/region/country.
 */
export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const raw = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  const q = raw.slice(0, 100);
  if (q.length < 2) {
    return NextResponse.json({ results: [] });
  }

  const meta = metaClientFromEnv();
  if (!meta) {
    return NextResponse.json({ error: "Meta is not configured" }, { status: 400 });
  }

  try {
    const matches = await meta.searchGeoLocations(q, { limit: 8 });
    const results = matches.map((m) => ({
      key: m.key,
      name: m.name,
      type: m.type,
      region: m.region ?? null,
      countryCode: m.country_code ?? null,
    }));
    return NextResponse.json({ results });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
