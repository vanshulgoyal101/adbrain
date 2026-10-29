/**
 * #749: records Meta's real answers for an owner's video, for test:core (tests/core/meta-ad-video.test.ts).
 * CEO-approved spike (#749, Oct 26 (c)): one tiny public clip (MDN's 834 KB rabbit320.mp4) uploaded to the
 * test ad account by `file_url`, polled to ready, then deleted. No campaign, ad set or ad; nothing spends.
 * Also one `file_url` Meta can't fetch (it answers 389; nothing is created) and a read of a video already in
 * the account. Only POST act_<id>/advideos and DELETE of a video made here may leave the process.
 *
 *   ADBRAIN_ALLOW_META_WRITES=1 npx tsx --env-file=<.env.local> scripts/record-meta-ad-video.ts
 */
import "./lib/meta-write-gate";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { MetaClient } from "@/lib/meta/client";
import { metaScrubber } from "./lib/scrub-meta";

const clipUrl = "https://raw.githubusercontent.com/mdn/learning-area/main/html/multimedia-and-embedding/video-and-audio-content/rabbit320.mp4";
const unreachableUrl = "https://raw.githubusercontent.com/mdn/learning-area/main/adbrain-749-missing.mp4";
const token = process.env.META_SYSTEM_USER_TOKEN!;
const adAccountId = `act_${process.env.META_AD_ACCOUNT_ID!.replace(/^act_/, "")}`;
const pageId = process.env.META_PAGE_ID!;
const POLL_MS = 5_000;
const POLL_LIMIT = 60;

type Exchange = { name: string; method: string; path: string; form: Record<string, string> | null; status: number; body: unknown };
const tape: Exchange[] = [];
const created = new Set<string>();
let name = "";
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input));
  const method = init?.method ?? "GET";
  const target = decodeURIComponent(url.pathname.replace(/^\/v\d+\.\d+\//, ""));
  if (method === "POST" && target !== `${adAccountId}/advideos`) throw new Error(`Recorder refuses POST ${target}.`);
  if (method === "DELETE" && !created.has(target)) throw new Error(`Recorder refuses DELETE ${target}.`);
  if (!["GET", "POST", "DELETE"].includes(method)) throw new Error(`Recorder refuses ${method}.`);
  const form = method === "POST" ? Object.fromEntries(new URLSearchParams(String(init?.body))) : null;
  if (form) delete form.access_token;
  const response = await realFetch(input, init);
  const text = await response.text();
  const body = JSON.parse(text);
  if (method === "POST" && typeof body.id === "string") created.add(body.id);
  url.searchParams.delete("access_token");
  tape.push({ name, method, path: url.pathname.replace(/^\/v\d+\.\d+\//, "") + url.search, form, status: response.status, body });
  console.log(name, method, response.status, target.slice(0, 60), text.slice(0, 160));
  return new Response(text, { status: response.status, headers: response.headers });
};

async function graphGet<T>(path: string): Promise<T> {
  const response = await fetch(`https://graph.facebook.com/v21.0/${path}${path.includes("?") ? "&" : "?"}access_token=${token}`);
  return response.json() as Promise<T>;
}

async function main() {
  const meta = new MetaClient({ adAccountId, pageId, accessToken: token });
  name = "list-existing";
  const existing = await graphGet<{ data: { id: string }[] }>(`${adAccountId}/advideos?fields=id&limit=1`);
  const existingVideoId = existing.data[0]?.id;
  if (!existingVideoId) throw new Error("The test ad account has no video to read.");
  name = "read-existing-video";
  console.log(await meta.readAdVideo(existingVideoId));

  name = "start-unreachable";
  console.log(await meta.startAdVideo({ fileUrl: () => unreachableUrl, name: "missing.mp4", title: "Missing" }).catch((error: unknown) => error));

  let videoId = "";
  try {
    name = "start-video";
    videoId = await meta.startAdVideo({ fileUrl: () => clipUrl, name: "owner-clip.mp4", title: "Owner clip" });
    name = "poll-video";
    for (let poll = 0; poll < POLL_LIMIT; poll++) {
      const state = await meta.readAdVideo(videoId);
      console.log(state);
      if (state.status !== "processing") break;
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
  } finally {
    name = "cleanup";
    for (const id of created) {
      await fetch(`https://graph.facebook.com/v21.0/${id}?access_token=${token}`, { method: "DELETE" }).catch(console.error);
    }
  }

  const scrubber = metaScrubber();
  const recorded = { recordedAt: new Date().toISOString(), clipUrl, unreachableUrl, videoId, existingVideoId, creds: { adAccountId, pageId }, tape };
  // Meta's CDN links are signed; the tape keeps only that one was given.
  const text = JSON.stringify(recorded).replace(/https:\/\/[a-z0-9.-]*(fbcdn\.net|facebook\.com)\/[^"]*/g, "https://scontent.example/media.jpg");
  writeFileSync(join(process.cwd(), "tests/core/fixtures/meta/ad-video.json"), `${JSON.stringify(JSON.parse(scrubber.scrub(text)), null, 2)}\n`);
}

main().catch((error) => { console.error(error); process.exit(1); });
