// What the scheduled "Facebook access requests" step does with one key (#2806):
// node scripts/access-request-action.mjs <latest request ISO> '<[{number,state,closedAt}] of issues titled with the key>'
// Prints `open` (no issue yet), `reopen:<n>` (asked again after the newest issue was closed) or `skip`.
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function accessRequestAction(at, matches) {
  if (!Array.isArray(matches) || matches.length === 0) return "open";
  if (matches.some((issue) => String(issue.state).toUpperCase() === "OPEN")) return "skip";
  const newest = matches.reduce((a, b) => (b.number > a.number ? b : a));
  const requested = Date.parse(at);
  const closed = Date.parse(newest.closedAt);
  // Without exact times (older deploy) keep the old rule: one issue per key; an old request never reopens a closed issue.
  if (Number.isNaN(requested) || Number.isNaN(closed) || requested <= closed) return "skip";
  return `reopen:${newest.number}`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  let matches;
  try { matches = JSON.parse(process.argv[3] ?? "[]"); } catch { matches = null; }
  console.log(matches ? accessRequestAction(process.argv[2], matches) : "skip");
}
