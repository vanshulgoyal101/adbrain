import type { DraftInput } from "@/lib/campaign/connect-contracts";
import type { translator } from "@/i18n/locale";
import type { WebsiteBlocker } from "@/lib/campaign/website-review";
import type { AppLocale } from "@/i18n/locale";
import type { ConversionGoal, TrackingBlocker } from "@/lib/campaign/website-tracking";

/** #2333: Review's blocker sentences, in the owner's language. */
export type ReviewSay = ReturnType<typeof translator<"review">>;

/** The fields of a chosen ad its blocker sentence reads. */
type BlockedCreative = { id: string; businessId: string; approved: boolean; imageUrl: string | null; headline: string | null; video?: { state: "ready" | "processing" | "error"; reason: string | null } };

/** The ad's quoted, shortened headline; null without one (the sentence then says "the ad you chose"). */
function adName(creative: BlockedCreative): string | null {
  const headline = (creative.headline ?? "").trim();
  if (!headline) return null;
  // Whole characters, so a Hindi matra or an emoji is never split.
  const graphemes = Array.from(new Intl.Segmenter("en", { granularity: "grapheme" }).segment(headline), (part) => part.segment);
  if (graphemes.length <= 40) return `"${headline}"`;
  const cut = graphemes.slice(0, 40).join("");
  return `"${(cut.lastIndexOf(" ") > 20 ? cut.slice(0, cut.lastIndexOf(" ")) : cut).trimEnd()}…"`;
}

/** #2599, #2333: why a website ad can't open the site, in the owner's words. */
export function websiteBlockerWords(problem: WebsiteBlocker, say: ReviewSay): string {
  switch (problem.key) {
    case "websiteMissing": return say("websiteMissing");
    case "websiteStatus": return say("websiteStatus", { host: problem.host, status: problem.status, coded: problem.status ? "yes" : "no" });
    case "websiteRedirect": return say("websiteRedirect", { host: problem.host, finalHost: problem.finalHost, known: problem.finalHost ? "yes" : "no" });
    default: return say(problem.key, { host: problem.host });
  }
}

/** #2714: a date in the checked window, as the owner reads it (India time). */
function day(iso: string, locale: AppLocale): string {
  return new Intl.DateTimeFormat(locale === "hi" ? "hi-IN" : "en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" }).format(new Date(iso));
}

/** #2714: why the chosen tracking can't measure this goal yet, with the window it checked and when it last heard. */
export function trackingBlockerWords(problem: TrackingBlocker, goal: ConversionGoal, say: ReviewSay, locale: AppLocale): string {
  switch (problem.key) {
    case "trackingNone": case "trackingChoose": return say(problem.key, { goal });
    case "trackingUnreadable": return say("trackingUnreadable", { reconnect: problem.reconnect ? "yes" : "no" });
    default: return say(problem.key, {
      goal, since: day(problem.since, locale), until: day(problem.until, locale),
      seen: problem.lastSeenAt ? "yes" : "no", lastSeen: problem.lastSeenAt ? day(problem.lastSeenAt, locale) : "",
    });
  }
}

/** #681: which chosen ad is wrong and what to do about it, not one sentence for every fault. */
export function creativesBlockerMessage(draft: Pick<DraftInput, "businessId" | "creativeIds" | "destination">, creatives: BlockedCreative[], say: ReviewSay): string | null {
  if (draft.creativeIds.length === 0) return say("noAds");
  const unique = new Set(draft.creativeIds).size === draft.creativeIds.length;
  const found = creatives.filter((creative) => creative.businessId === draft.businessId && draft.creativeIds.includes(creative.id));
  if (!unique || new Set(creatives.map((creative) => creative.id)).size !== creatives.length || found.length !== creatives.length || found.length !== draft.creativeIds.length) {
    return say("adGone");
  }
  const problems = found.flatMap((creative) => {
    if (!creative.headline) return [say("adNoHeadline")];
    const name = adName(creative);
    const ad = { named: name ? "yes" : "no", name: name ?? "" };
    if (!creative.approved) return [say("adNotApproved", ad)];
    if (!creative.imageUrl) return [say("adNoPicture", ad)];
    if (creative.video && draft.destination === "website") return [say("adVideoWebsite", ad)];
    if (creative.video?.state === "processing") return [say("adVideoProcessing", ad)];
    if (creative.video?.state === "error") return [say("adVideoError", { ...ad, reason: creative.video.reason ?? "" })];
    return [];
  });
  if (!problems.length) return null;
  const more = problems.length - 1;
  return more ? say("adsMore", { first: problems[0], more }) : problems[0];
}

/** #740: name what Meta didn't recognise, so the owner knows which line to fix. */
export function named(names: string[], say: ReviewSay): string {
  const shown = names.slice(0, 5).map((name) => `"${name}"`);
  const list = shown.length > 1 ? say("listAnd", { first: shown.slice(0, -1).join(", "), last: shown.at(-1)! }) : shown[0];
  return names.length > shown.length ? say("listMore", { names: list, more: names.length - shown.length }) : list;
}
