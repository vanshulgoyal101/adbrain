/**
 * Build a WhatsApp-style plain-text digest of recent leads for the business
 * owner. Deterministic (no LLM) so it's free, instant, and unit-testable.
 */

export interface DigestLead {
  fullName: string | null;
  phone: string | null;
  city: string | null;
  formName?: string | null;
  createdTime: string | null; // ISO timestamp
}

export interface DigestOptions {
  businessName: string;
  now?: Date;
  windowDays?: number;
  maxList?: number;
}

/** Compact relative age, e.g. "just now", "3h ago", "2d ago". */
export function relativeAge(iso: string | null, now: Date): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const mins = Math.max(0, Math.round((now.getTime() - then) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function withinWindow(iso: string | null, now: Date, windowDays: number): boolean {
  if (!iso) return false;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return false;
  const ageDays = (now.getTime() - then) / 86_400_000;
  return ageDays >= 0 && ageDays <= windowDays;
}

export function buildLeadDigest(leads: DigestLead[], opts: DigestOptions): string {
  const now = opts.now ?? new Date();
  const windowDays = opts.windowDays ?? 7;
  const maxList = opts.maxList ?? 10;
  const recent = leads
    .filter((l) => withinWindow(l.createdTime, now, windowDays))
    .sort(
      (a, b) =>
        new Date(b.createdTime ?? 0).getTime() -
        new Date(a.createdTime ?? 0).getTime(),
    );

  const window = windowDays === 1 ? "today" : `the last ${windowDays} days`;

  if (recent.length === 0) {
    return [
      `🌞 ${opts.businessName}: no new leads in ${window}.`,
      "",
      "Your ads may need a nudge — try a fresh creative or a small budget bump.",
    ].join("\n");
  }

  const header = `🌞 ${opts.businessName}: ${recent.length} new lead${
    recent.length === 1 ? "" : "s"
  } in ${window}`;

  const lines = recent.slice(0, maxList).map((l, i) => {
    const name = l.fullName?.trim() || "New lead";
    const bits = [name];
    if (l.phone) bits.push(l.phone);
    if (l.city) bits.push(l.city);
    const age = relativeAge(l.createdTime, now);
    const tail = age ? ` (${age})` : "";
    return `${i + 1}. ${bits.join(" — ")}${tail}`;
  });

  const overflow =
    recent.length > maxList ? [`…and ${recent.length - maxList} more.`] : [];

  return [
    header,
    "",
    ...lines,
    ...overflow,
    "",
    "Reply fast — leads go cold within minutes.",
  ].join("\n");
}
