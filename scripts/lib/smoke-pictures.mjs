/**
 * #2412: where a Create run's pictures came from, read from each saved ad's `generation`. Counting saved ads alone
 * let 1 real picture plus 2 reused siblings (`batch_reuse`, #2378) pass as 3/3, and would hide a dead Cloudflare token.
 * @param {{ generation?: { image?: { provider?: string, fallbackFrom?: string }, imageAttempts?: { provider?: string, status?: string, errorCode?: string }[] } }[]} ads
 * @param {{ expectCloudflare: boolean }} options
 * @returns {{ line: string, failure: string | null }}
 */
export function pictureSources(ads, { expectCloudflare }) {
  const counts = { cloudflare: 0, pollinations: 0, reuse: 0 };
  const other = [];
  const cloudflareErrors = new Set();
  for (const ad of ads) {
    const image = ad.generation?.image ?? {};
    if (image.fallbackFrom === "batch_reuse") counts.reuse++;
    else if (image.provider in counts) counts[image.provider]++;
    else other.push(image.provider ?? "unknown");
    for (const attempt of ad.generation?.imageAttempts ?? []) {
      if (attempt.provider === "cloudflare" && attempt.status === "error") cloudflareErrors.add(attempt.errorCode ?? "unknown");
    }
  }
  const capped = cloudflareErrors.has("IMAGE_FREE_DAILY_LIMIT");
  const line = `NOTE pictures: cloudflare ${counts.cloudflare}, pollinations ${counts.pollinations}, reuse ${counts.reuse}`
    + (other.length ? `, other ${other.join("/")}` : "")
    + (capped && !counts.cloudflare ? " (Cloudflare's free daily cap was used up)" : "");
  let failure = null;
  if (counts.reuse > 1) failure = `${counts.reuse} of ${ads.length} pictures reused a sibling's (free pictures busy)`;
  else if ((expectCloudflare || cloudflareErrors.size) && !counts.cloudflare && !capped) {
    failure = `Cloudflare is configured but no picture came from it (attempts: ${[...cloudflareErrors].join(", ") || "none"})`;
  }
  return { line, failure };
}
