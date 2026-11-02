/**
 * #2593: GitHub drops scheduled runs (none fired from 03:45 to 11:00Z on Nov 2), so pg_cron calls
 * `/api/cron/dispatch-workflows` every 15 minutes and it dispatches these, and only these, on `main` once their
 * newest run (any event) is older than the interval plus the grace. GitHub has fired a slot up to ~2 h late, so a
 * late slot that does fire is not doubled.
 */
export const WORKFLOWS = [
  // `auto` runs what the schedule would: the day's one create when it's due and hasn't run, otherwise a picture (#2545).
  { workflow: "create-smoke.yml", everyMinutes: 4 * 60, inputs: { mode: "auto" } },
  { workflow: "db-backup.yml", everyMinutes: 24 * 60 },
  { workflow: "production-guard.yml", everyMinutes: 24 * 60 },
] as const satisfies readonly { workflow: string; everyMinutes: number; inputs?: Record<string, string> }[];

export const GRACE_MINUTES = 150;

export type Workflow = (typeof WORKFLOWS)[number];

/** A workflow with no run at all is overdue; a run that is queued or in progress counts as its newest run. */
export function isOverdue(everyMinutes: number, lastRunAt: string | null, now: number): boolean {
  if (!lastRunAt) return true;
  const ranAt = Date.parse(lastRunAt);
  if (Number.isNaN(ranAt)) return true;
  return now - ranAt > (everyMinutes + GRACE_MINUTES) * 60_000;
}
