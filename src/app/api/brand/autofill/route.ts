import { NextResponse } from "next/server";
import { parse } from "node-html-parser";
import { completeJSON, NoLLMKeysError } from "@/lib/llm";
import { parsePublicUrl } from "@/lib/security/ssrf";
import { createClient } from "@/lib/supabase/server";
import {
  buildBrandExtractionMessages,
  type BrandExtraction,
} from "@/lib/templates/solar";

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

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as { url?: string } | null;
  const rawUrl = (body?.url ?? "").trim();
  if (!rawUrl) {
    return NextResponse.json({ error: "url is required" }, { status: 400 });
  }

  const parsed = parsePublicUrl(rawUrl);
  if (!parsed) {
    return NextResponse.json({ error: "That URL is not allowed" }, { status: 400 });
  }

  let html: string;
  try {
    const res = await fetch(parsed.toString(), {
      headers: { "User-Agent": "AdBrainBot/1.0 (+https://adbrain.app)" },
      signal: AbortSignal.timeout(10_000),
      redirect: "follow",
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: `Site returned ${res.status}` },
        { status: 502 },
      );
    }
    html = await res.text();
  } catch {
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
      { temperature: 0.3, maxTokens: 800 },
    );
    return NextResponse.json({ extraction });
  } catch (err) {
    if (err instanceof NoLLMKeysError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 502 },
    );
  }
}
