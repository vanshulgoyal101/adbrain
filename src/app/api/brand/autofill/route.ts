import { observeRoute } from "@/lib/observability/logger";
import { NextResponse } from "next/server";
import { z } from "zod";
import { parse } from "node-html-parser";
import { completeJSON, NoLLMKeysError } from "@/lib/llm";
import { fetchPublicUrlText, parsePublicUrl, SafeFetchError } from "@/lib/security/ssrf";
import { rateLimitResponse } from "@/lib/security/rate-limit";
import { createClient } from "@/lib/supabase/server";
import {
  buildBrandExtractionMessages,
  type BrandExtraction,
} from "@/lib/templates/ads";

export const runtime = "nodejs";
export const maxDuration = 30;

function extractText(html: string): string {
  const root = parse(html);
  root
    .querySelectorAll("script, style, noscript, svg")
    .forEach((n) => n.remove());
  const title = root.querySelector("title")?.text ?? "";
  const metaDesc =
    root.querySelector('meta[name="description"]')?.getAttribute("content") ??
    "";
  const body = root.querySelector("body")?.text ?? root.text;
  return `${title}\n${metaDesc}\n${body}`.replace(/\s+/g, " ").trim();
}

export const POST = observeRoute("/api/brand/autofill", "POST", handlePOST);

async function handlePOST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limited = await rateLimitResponse(`autofill:${user.id}`, {
    limit: 15,
    windowMs: 5 * 60_000,
  });
  if (limited) return limited;

  const body = z.object({ url: z.string().trim().min(1).max(2048) })
    .safeParse(await req.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json({ error: "A website URL of at most 2048 characters is required." }, { status: 400 });
  }

  const parsed = parsePublicUrl(body.data.url);
  if (!parsed) {
    return NextResponse.json({ error: "That URL is not allowed" }, { status: 400 });
  }

  let html: string;
  try {
    html = await fetchPublicUrlText(parsed.toString(), {
      headers: { "User-Agent": "AdBrainBot/1.0 (+https://adbrain.vanshul.com)" },
      timeoutMs: 10_000,
    });
  } catch (err) {
    if (err instanceof SafeFetchError) {
      if (err.code === "blocked") {
        return NextResponse.json({ error: "That URL is not allowed" }, { status: 400 });
      }
      if (err.code === "status") {
        return NextResponse.json(
          { error: `Site returned ${err.status}` },
          { status: 502 },
        );
      }
    }
    return NextResponse.json(
      { error: "Could not fetch the site" },
      { status: 502 },
    );
  }

  const text = extractText(html);
  if (!text) {
    return NextResponse.json(
      { error: "No readable text found on that page" },
      { status: 422 },
    );
  }

  try {
    const extraction = await completeJSON<BrandExtraction>(
      buildBrandExtractionMessages(text, parsed.toString()),
      {
        routing: "budget",
        task: "website brand extraction",
        temperature: 0.3,
        maxTokens: 1_200,
        reasoningEffort: "minimal",
        cache: true,
      },
    );
    return NextResponse.json({ extraction });
  } catch (err) {
    if (err instanceof NoLLMKeysError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: "Could not extract business details. Try again later or enter them manually." },
      { status: 502 },
    );
  }
}
