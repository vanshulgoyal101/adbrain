/** #1697: the pilot funnel rows of the daily core scoreboard; split from core-scoreboard.ts (C4 file size). */
import { isMetaTestLead } from "@/lib/leads/test-lead";
import type { ScoreRow } from "./core-scoreboard";

const DAY = 86_400_000;

/** #1697: hand-over is recorded by the prospect runbook's last step (#1486, #1670) as this product event. */
export const PROSPECT_HANDED_OVER = "prospect.handed_over";

export type PilotData = {
  /** Businesses still owned by a `+prospect` account with at least one creative. */
  prospectBusinessIds: string[];
  /** Businesses with a `prospect.handed_over` event. */
  handedOverBusinessIds: string[];
  /** First `campaigns.launched_at` per business. */
  firstLaunch: Record<string, string>;
  /** Each business's latest `pilot_day7` answer (#1650). */
  day7Answers: Record<string, "yes" | "maybe" | "no">;
  /** #1965: form and logged WhatsApp enquiries (`created_at`), Meta test leads already out. */
  recentEnquiries: { business_id: string; created_at: string }[];
  excludedBusinessIds: string[];
  now: Date;
};

/** #1697: builds PilotData from the raw reads the route and the local script both make. */
export function pilotData({ prospectCreatives, pilotEvents, launchedRows, leads, excludedBusinessIds, now }: {
  prospectCreatives: { business_id: string }[];
  pilotEvents: { business_id: string | null; name: string; attributes: { answer?: string } | null; created_at: string }[];
  launchedRows: { business_id: string; launched_at: string }[];
  /** `meta_form` and `whatsapp_manual` leads from at least the last 24 h. */
  leads: { business_id: string; created_at: string; full_name?: string | null }[];
  excludedBusinessIds: string[];
  now: Date;
}): PilotData {
  const firstLaunch: Record<string, string> = {};
  for (const row of launchedRows) if (!firstLaunch[row.business_id] || row.launched_at < firstLaunch[row.business_id]) firstLaunch[row.business_id] = row.launched_at;
  const day7Answers: PilotData["day7Answers"] = {};
  for (const event of [...pilotEvents].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    const answer = event.attributes?.answer;
    if (event.name === "pilot_day7" && event.business_id && (answer === "yes" || answer === "maybe" || answer === "no")) day7Answers[event.business_id] = answer;
  }
  return {
    prospectBusinessIds: [...new Set(prospectCreatives.map((row) => row.business_id))],
    handedOverBusinessIds: [...new Set(pilotEvents.filter((event) => event.name === PROSPECT_HANDED_OVER && event.business_id).map((event) => event.business_id as string))],
    firstLaunch, day7Answers, excludedBusinessIds, now,
    recentEnquiries: leads.filter((lead) => !isMetaTestLead({ full_name: lead.full_name ?? null })).map(({ business_id, created_at }) => ({ business_id, created_at })),
  };
}

/**
 * #1697 (CPO #1685): the pilot funnel, counts only and cumulative: prepared (still with the rep, or handed over) →
 * handed over → live (a handed-over business with a Go live) → Day 7 → its answers; plus how many reach Day 7 in
 * the next 48 h so the rep can book the visit, and (#1965) real enquiries on live pilots in the last 24 h. No names;
 * nothing until the first pilot.
 */
export function pilotRows(data: PilotData): ScoreRow[] {
  const excluded = new Set(data.excludedBusinessIds);
  const handedOver = new Set(data.handedOverBusinessIds.filter((id) => !excluded.has(id)));
  const prepared = new Set([...data.prospectBusinessIds.filter((id) => !excluded.has(id)), ...handedOver]);
  if (!prepared.size) return [];
  const live = [...handedOver].filter((id) => data.firstLaunch[id]);
  const age = (id: string) => data.now.getTime() - Date.parse(data.firstLaunch[id]);
  const day7 = live.filter((id) => age(id) >= 7 * DAY);
  const due = live.filter((id) => age(id) < 7 * DAY && age(id) >= 5 * DAY).length;
  const answers = { yes: 0, maybe: 0, no: 0 };
  for (const id of day7) { const answer = data.day7Answers[id]; if (answer) answers[answer] += 1; }
  const liveIds = new Set(live);
  const enquiries = data.recentEnquiries.filter((lead) => liveIds.has(lead.business_id) && data.now.getTime() - Date.parse(lead.created_at) < DAY).length;
  return [
    {
      step: "Pilots",
      now: `${prepared.size} prepared → ${handedOver.size} handed over → ${live.length} live → ${day7.length} at Day 7 (answers: yes ${answers.yes}, maybe ${answers.maybe}, no ${answers.no})`,
      target: "3 pilots live (#1315)",
      met: null,
    },
    { step: "Pilots: Day 7 due in 48 h", now: String(due), target: "book the Day 7 visit", met: null },
    { step: "Pilots: enquiries in 24 h", now: String(enquiries), target: "real enquiries on live pilots", met: null },
  ];
}
