/**
 * UX scoreboard (#1226 workstream 8): one row per north-star metric with its Nov 30 target, read from
 * production with internal and smoke owners left out by the caller. A metric the data can't measure yet
 * says where its number comes from instead of guessing.
 */
import { medianReplyMinutes } from "@/lib/leads/first-reply";

/** An owner who signed up, with the first confirmed activation of any of their campaigns (`campaigns.launched_at`). */
export type UxOwner = { id: string; created_at: string; first_live_at: string | null };
/** An enquiry with a first reply; `test` marks Meta's test leads (#1149), which never count. */
export type UxLead = { owner_id: string; test: boolean; created_time: string | null; created_at: string; first_contacted_at: string | null };
export type UxPageView = { user_id: string; route: string; created_at: string };
export type UxRow = { metric: string; now: string; target: string; met: boolean | null };

/** Pages where an owner opens results (#1226 "weekly return"). */
export const UX_RETURN_ROUTES = ["/dashboard", "/campaigns", "/leads"] as const;
const WEEK_MS = 7 * 86_400_000;
const IST_MS = 330 * 60_000;

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

const istDay = (iso: string) => new Date(Date.parse(iso) + IST_MS).toISOString().slice(0, 10);
const round = (value: number) => (value < 10 ? Math.round(value * 10) / 10 : Math.round(value));

export function buildUxScoreboard(input: {
  owners: UxOwner[];
  liveOwnerIds: string[];
  leads: UxLead[];
  pageViews: UxPageView[];
  signupDays: number;
  until: Date;
  includeInternal?: boolean;
}) {
  const until = input.until.getTime();
  const signupSince = until - input.signupDays * 86_400_000;
  const weekSince = until - WEEK_MS;
  const inWeek = (iso: string) => { const t = Date.parse(iso); return t >= weekSince && t <= until; };

  const cohort = input.owners.filter((owner) => { const t = Date.parse(owner.created_at); return t >= signupSince && t <= until; });
  const liveMinutes = cohort.flatMap((owner) => {
    if (!owner.first_live_at) return [];
    const minutes = (Date.parse(owner.first_live_at) - Date.parse(owner.created_at)) / 60_000;
    return Number.isFinite(minutes) && minutes >= 0 ? [minutes] : [];
  });
  const toLive = median(liveMinutes);

  const replies = input.leads.filter((lead) => !lead.test && lead.first_contacted_at && inWeek(lead.first_contacted_at));
  const reply = medianReplyMinutes(replies);

  const routes = new Set<string>(UX_RETURN_ROUTES);
  const days = new Map(input.liveOwnerIds.map((id) => [id, new Set<string>()]));
  for (const view of input.pageViews) {
    if (routes.has(view.route) && inWeek(view.created_at)) days.get(view.user_id)?.add(istDay(view.created_at));
  }
  const perOwner = [...days.values()].map((set) => set.size);
  const returning = median(perOwner);

  const rows: UxRow[] = [
    {
      metric: "Sign-up → first campaign live (median)",
      now: !cohort.length ? `no new owners in ${input.signupDays} d`
        : `${toLive === null ? "—" : `${round(toLive)} min`} (${liveMinutes.length} of ${cohort.length} new owners live)`,
      target: "≤ 10 min",
      met: toLive === null ? null : toLive <= 10,
    },
    { metric: "Taps from Create ads to Live on Meta", now: "— (release walk, QA 2)", target: "≤ 12", met: null },
    { metric: "Owner steps needing help", now: "— (no help-tap event yet; the #796 setup-call log)", target: "≤ 1 in 3 pilots", met: null },
    {
      metric: "Time to first reply to an enquiry (median, 7 d)",
      now: reply === null ? "no replies in 7 d" : `${round(reply)} min (${replies.length} replies)`,
      target: "≤ 15 min",
      met: reply === null ? null : reply <= 15,
    },
    {
      metric: "Weekly return (days an owner with a live campaign opened results, median)",
      now: !perOwner.length ? "no owners with a live campaign"
        : `${returning} d/week (${perOwner.filter((n) => n >= 3).length} of ${perOwner.length} owners ≥ 3)`,
      target: "≥ 3 days/week",
      met: returning === null ? null : returning >= 3,
    },
    { metric: "Accessibility (axe) / Core Web Vitals on phones", now: "— (ui-gate per release; Vercel Speed Insights p75)", target: "axe 0; LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1", met: null },
  ];

  const mark = (met: boolean | null) => (met === null ? "—" : met ? "✅" : "❌");
  const measured = rows.filter((row) => row.met !== null);
  const markdown = [
    `**UX scoreboard (#1226)** until ${input.until.toISOString().slice(0, 16)}Z: sign-ups over ${input.signupDays} d, the rest over 7 d; ${input.includeInternal ? "internal accounts included" : "internal and smoke accounts excluded"}.`,
    "",
    "| Metric | Now | Target by Nov 30 | Met |",
    "|---|---|---|---|",
    ...rows.map((row) => `| ${row.metric} | ${row.now} | ${row.target} | ${mark(row.met)} |`),
    "",
    `${measured.filter((row) => row.met).length} of ${measured.length} measured rows meet target; — means no data or measured by walks.`,
  ].join("\n");
  return { rows, markdown };
}
