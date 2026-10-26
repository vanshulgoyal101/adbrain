/**
 * Human wording for audit events. The stored `action` values are internal keys
 * ("creative.unapprove"), which shouldn't be shown to a business owner in a
 * product whose whole promise is plain language.
 */
const ACTION_LABELS: Record<string, string> = {
  "business.create": "Business details created",
  "business.update": "Business details updated",
  "creatives.generate": "New ads made",
  "creative.approve": "Ad approved",
  "creative.unapprove": "Ad moved back to drafts",
  "creative.delete": "Ad deleted",
  "creative.regenerate": "Ad made again",
  "creative.edit": "Ad text edited",
  "creative.edit_picture": "Words on the picture changed",
  "creative.change_background": "Picture background changed",
  "creatives.export": "Ad pack exported",
  "campaign.create": "Campaign created",
  "campaign.create.traffic_probe": "Test campaign created",
  "campaign.update": "Campaign updated",
  "campaign.delete": "Campaign deleted",
  "campaign.pause": "Campaign paused",
  "campaign.resume": "Campaign resumed",
  "campaign.refresh": "Campaign results refreshed",
  "campaigns.sync": "Campaigns updated from Meta",
  "leads.sync": "Enquiries checked in Meta",
  "spend.limits_updated": "Spend guardrails updated",
  "spend.auto_paused": "Campaigns auto-paused at your cap",
  "meta.connected": "Meta account connected",
  "meta.disconnected": "Meta account disconnected",
  "meta.traffic.run": "Meta connection checked",
  "instruction.create": "Ad instruction added",
  "instruction.update": "Ad instruction updated",
  "instruction.delete": "Ad instruction removed",
};

/** #763: background checks that run on their own; owners see what they did, not the log. */
const BACKGROUND_ACTIONS = new Set(["campaigns.sync", "leads.sync", "meta.traffic.run"]);

export function isBackgroundAuditAction(action: string): boolean {
  return BACKGROUND_ACTIONS.has(action);
}

/** Reasons are meant to be one-line notes; longer text is internal detail. */
const MAX_REASON_LENGTH = 90;

export function auditActionLabel(action: string): string {
  return ACTION_LABELS[action] ?? humanise(action);
}

/** Fallback for an action added since this map: "campaign.foo_bar" -> "Campaign foo bar". */
function humanise(action: string): string {
  const words = action.replace(/[._]/g, " ").trim();
  if (!words) return "Activity";
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * One readable line for the activity feed. Older rows stored a whole generated
 * brief in `reason`, so anything long is dropped rather than shown.
 */
export function describeAuditEvent(
  action: string,
  reason: string | null | undefined,
): string {
  const label = auditActionLabel(action);
  const note = (reason ?? "").trim();
  if (!note || note.length > MAX_REASON_LENGTH || note === label) return label;
  return `${label} — ${note}`;
}
