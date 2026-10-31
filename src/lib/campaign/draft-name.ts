import type { DraftDTO } from "@/lib/campaign/connect-contracts";

const DESTINATION_LABEL = { whatsapp: "WhatsApp", instant_form: "Lead form" } as const;
const MAX_NAME = 120;

/**
 * #1151: a new campaign's name until the owner types one: the first ad's headline, where enquiries go and
 * the day, e.g. "Free 15-minute spine check · WhatsApp · Oct 28", so saved drafts tell themselves apart.
 */
export function defaultCampaignName(input: {
  headline?: string | null; businessName: string; destination: keyof typeof DESTINATION_LABEL; date?: string | null;
}): string {
  const lead = (input.headline?.trim() || input.businessName.trim()).replace(/\s+/g, " ");
  const tail = [DESTINATION_LABEL[input.destination], input.date].filter(Boolean).join(" · ");
  const room = MAX_NAME - tail.length - " · ".length;
  return `${lead.length > room ? `${lead.slice(0, room - 1).trimEnd()}…` : lead} · ${tail}`;
}

/** The day in a default name ("Oct 28"), in the owner's own time zone. */
export function campaignNameDate(now: Date): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(now);
}

/** #1151: the saved draft for exactly these ads, so preparing them again updates it instead of adding one. */
export function draftForSelection(drafts: DraftDTO[], creativeIds: string[]): DraftDTO | undefined {
  const wanted = new Set(creativeIds);
  if (!wanted.size) return undefined;
  return drafts.find((draft) => {
    const ids = new Set(draft.input.creativeIds);
    return ids.size === wanted.size && [...ids].every((id) => wanted.has(id));
  });
}
