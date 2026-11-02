/**
 * #751: owners' photos and videos checked against Meta's ads-guide limits, one verdict per placement with one
 * plain-words fix. Pure, so the on-pick tile, `/api/media/finalize` and Review all give the same answer.
 * Hard limits Meta rejects `block`; shapes Meta only crops or letterboxes `warn`.
 * Source: Analyst's table on #751 (Nov 2), read from each ads-guide page below. Re-check each quarter.
 */

export type MetaPlacement = "feed" | "stories" | "reels";
export type MetaSpecFix = "fit-tall" | "feed-only" | "replace";
export type MetaSpecVerdict = { status: "ok" } | { status: "warn" | "block"; fix: MetaSpecFix; message: string };
export type MetaSpecResult = Record<MetaPlacement, MetaSpecVerdict>;

/** What a browser or the server can read from a file without decoding it fully. */
export type MediaFacts = { mime: string; width: number; height: number; bytes: number; durationSec?: number };

type Aspect = { min: number; max: number; tolerance: number };
type SpecRule = {
  maxBytes: number;
  minWidth: number;
  minHeight?: number;
  /** Reels asks for more pixels from this length on. */
  longVideo?: { fromSec: number; minWidth: number };
  minSec?: number;
  maxSec?: number;
  aspect: Aspect;
  source: string;
  checkedOn: string;
};

const MB = 1024 * 1024;
const GB = 1024 * MB;
const CHECKED_ON = "2026-11-02";
const GUIDE = "https://www.facebook.com/business/ads-guide/update";
const FEED: Aspect = { min: 4 / 5, max: 1.91, tolerance: 0.03 };
const TALL: Aspect = { min: 9 / 16, max: 9 / 16, tolerance: 0.01 };

export const META_SPEC_RULES = {
  feedImage: { maxBytes: 30 * MB, minWidth: 600, aspect: FEED, source: `${GUIDE}/image/facebook-feed?locale=en_US`, checkedOn: CHECKED_ON },
  tallImage: { maxBytes: 30 * MB, minWidth: 500, aspect: TALL, source: `${GUIDE}/image/instagram-story?locale=en_US`, checkedOn: CHECKED_ON },
  feedVideo: { maxBytes: 4 * GB, minWidth: 120, minHeight: 120, minSec: 1, maxSec: 241 * 60, aspect: FEED, source: `${GUIDE}/video/facebook-feed?locale=en_US`, checkedOn: CHECKED_ON },
  storyVideo: { maxBytes: 4 * GB, minWidth: 250, minSec: 1, maxSec: 3 * 60, aspect: TALL, source: `${GUIDE}/video/facebook-story?locale=en_US`, checkedOn: CHECKED_ON },
  reelsVideo: { maxBytes: 4 * GB, minWidth: 250, longVideo: { fromSec: 30, minWidth: 500 }, maxSec: 15 * 60, aspect: TALL, source: `${GUIDE}/video/instagram-reels?locale=en_US`, checkedOn: CHECKED_ON },
} as const satisfies Record<string, SpecRule>;

const IMAGE_TYPES = new Set(["image/jpeg", "image/png"]);
const VIDEO_TYPES = new Set(["video/mp4", "video/quicktime"]);
const LABEL: Record<MetaPlacement, string> = { feed: "Feed", stories: "Stories", reels: "Reels" };

const positive = (n: number | undefined): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;
const block = (fix: MetaSpecFix, message: string): MetaSpecVerdict => ({ status: "block", fix, message });
const warn = (fix: MetaSpecFix, message: string): MetaSpecVerdict => ({ status: "warn", fix, message });
const every = (verdict: MetaSpecVerdict): MetaSpecResult => ({ feed: verdict, stories: verdict, reels: verdict });

const minutes = (sec: number) => (sec >= 60 ? `${sec / 60} minutes` : `${sec} seconds`);

function shape(width: number, height: number): string {
  const r = width / height;
  if (Math.abs(r - 1) <= 0.03) return "square";
  if (Math.abs(r - 16 / 9) <= 0.03) return "wide (16:9)";
  return r > 1 ? "wide" : "upright";
}

function check(facts: MediaFacts, placement: MetaPlacement, rule: SpecRule, video: boolean): MetaSpecVerdict {
  const { width, height, bytes } = facts;
  const durationSec = facts.durationSec ?? 0;
  const label = LABEL[placement];
  const noun = video ? "video" : "photo";
  if (bytes > rule.maxBytes) return block("replace", `This ${noun} is over ${video ? "4 GB" : "30 MB"}. Use a smaller copy.`);

  const minWidth = rule.longVideo && durationSec >= rule.longVideo.fromSec ? rule.longVideo.minWidth : rule.minWidth;
  if (width < minWidth || height < (rule.minHeight ?? 0)) {
    const need = rule.minHeight ? `${minWidth} × ${rule.minHeight} px` : `${minWidth} px wide`;
    return block("replace", `This ${noun} is too small for ${label} (${width} px wide). Use one at least ${need}.`);
  }

  if (video) {
    if (rule.minSec && durationSec < rule.minSec) return block("replace", `This video is under ${rule.minSec} second; ${label} needs at least ${rule.minSec} second.`);
    // Only Stories' 3 minutes or Reels' 15 minutes is exceeded, so Feed (241 minutes) can still run it.
    if (rule.maxSec && durationSec > rule.maxSec) return block(placement === "feed" ? "replace" : "feed-only", `This video is longer than ${label} allows (${minutes(rule.maxSec)}).`);
  }

  const r = width / height;
  const { min, max, tolerance } = rule.aspect;
  if (r >= min * (1 - tolerance) && r <= max * (1 + tolerance)) return { status: "ok" };
  if (placement === "feed") {
    return r < min
      ? warn("replace", `Feed shows this tall ${noun} cropped to 4:5. Add a square or 4:5 version for Feed.`)
      : warn("replace", `Feed crops the sides of a ${noun} wider than 1.91:1. Add a square or 4:5 version for Feed.`);
  }
  return video
    ? warn("feed-only", `This video is ${shape(width, height)}; ${label} needs a tall video (9:16). Use it in Feed only.`)
    : warn("fit-tall", `This photo is ${shape(width, height)}; ${label} needs a tall picture (9:16). Fit it to a tall picture.`);
}

/** One verdict for Feed, Stories and Reels from a file's type, size in pixels, bytes and (for video) length. */
export function checkMetaSpecs(facts: MediaFacts): MetaSpecResult {
  const mime = facts.mime.toLowerCase();
  const isImage = mime.startsWith("image/");
  const isVideo = mime.startsWith("video/");
  const readable = positive(facts.width) && positive(facts.height) && positive(facts.bytes) && (!isVideo || positive(facts.durationSec));
  if (!readable) return every(block("replace", "We can't read this file. Try another photo or video."));
  if (isImage && !IMAGE_TYPES.has(mime)) return every(block("replace", "Meta takes JPG or PNG photos. Save this one as a JPG and try again."));
  if (isVideo && !VIDEO_TYPES.has(mime)) return every(block("replace", "Meta takes MP4 or MOV videos. Export this one as an MP4."));
  if (!isImage && !isVideo) return every(block("replace", "Use a JPG or PNG photo, or an MP4 or MOV video."));

  const R = META_SPEC_RULES;
  return isVideo
    ? { feed: check(facts, "feed", R.feedVideo, true), stories: check(facts, "stories", R.storyVideo, true), reels: check(facts, "reels", R.reelsVideo, true) }
    : { feed: check(facts, "feed", R.feedImage, false), stories: check(facts, "stories", R.tallImage, false), reels: check(facts, "reels", R.tallImage, false) };
}
