import { NextResponse } from "next/server";
import { parse } from "node-html-parser";
import { completeJSON, NoLLMKeysError } from "@/lib/llm";
import { createClient } from "@/lib/supabase/server";
import {
  buildBrandExtractionMessages,
  type BrandExtraction,
} from "@/lib/templates/solar";

export const runtime = "nodejs";
export const maxDuration = 30;

/** Block requests to loopback / private / link-local hosts (SSRF guard). */
function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal")) {
    return true;
  }
  if (h === "0.0.0.0" || h === "::1" || h.startsWith("fe80:") || h.startsWith("fc") || h.startsWith("fd")) {
    return true;
  }
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a === 127 || a === 10 || a === 0) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
  }
  return false;
}

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
  let url = (body?.url ?? "").trim();
  if (!url) {
    return NextResponse.json({ error: "url is required" }, { status: 400 });
  }
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
  }
  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    isBlockedHost(parsed.hostname)
  ) {
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
      buildBrandExtractionMessages(text, url),
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
