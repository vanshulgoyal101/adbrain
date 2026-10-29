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

/** #1877: the CPO's Hindi for each action; Hindi shows the label alone, never the stored English note. */
const HINDI_LABELS: Record<string, string> = {
  "business.create": "बिज़नेस की जानकारी जोड़ी गई",
  "business.update": "बिज़नेस की जानकारी बदली गई",
  "creatives.generate": "नए विज्ञापन बने",
  "creative.approve": "विज्ञापन मंज़ूर हुआ",
  "creative.unapprove": "विज्ञापन वापस ड्राफ़्ट में गया",
  "creative.delete": "विज्ञापन हटाया गया",
  "creative.regenerate": "विज्ञापन दोबारा बना",
  "creative.edit": "विज्ञापन के शब्द बदले गए",
  "creative.edit_picture": "तस्वीर पर लिखे शब्द बदले गए",
  "creative.change_background": "तस्वीर का बैकग्राउंड बदला गया",
  "creatives.export": "विज्ञापन डाउनलोड किए गए",
  "campaign.create": "कैंपेन बना",
  "campaign.create.traffic_probe": "टेस्ट कैंपेन बना",
  "campaign.update": "कैंपेन बदला गया",
  "campaign.delete": "कैंपेन हटाया गया",
  "campaign.pause": "कैंपेन रोका गया",
  "campaign.resume": "कैंपेन फिर चालू हुआ",
  "campaign.refresh": "कैंपेन के नतीजे अपडेट हुए",
  "campaigns.sync": "Meta से कैंपेन अपडेट हुए",
  "leads.sync": "Meta में पूछताछ देखी गई",
  "spend.limits_updated": "खर्च की सीमा बदली गई",
  "spend.auto_paused": "आपकी खर्च सीमा पूरी होने पर कैंपेन अपने-आप रुक गए",
  "meta.connected": "Meta अकाउंट जुड़ा",
  "meta.disconnected": "Meta अकाउंट हटाया गया",
  "meta.traffic.run": "Meta कनेक्शन जाँचा गया",
  "instruction.create": "विज्ञापन का नियम जोड़ा गया",
  "instruction.update": "विज्ञापन का नियम बदला गया",
  "instruction.delete": "विज्ञापन का नियम हटाया गया",
};

/** #763: background checks that run on their own; owners see what they did, not the log. */
const BACKGROUND_ACTIONS = new Set(["campaigns.sync", "leads.sync", "meta.traffic.run"]);

export function isBackgroundAuditAction(action: string): boolean {
  return BACKGROUND_ACTIONS.has(action);
}

/** Reasons are meant to be one-line notes; longer text is internal detail. */
const MAX_REASON_LENGTH = 90;

export function auditActionLabel(action: string, locale: "en" | "hi" = "en"): string {
  if (locale === "hi") return HINDI_LABELS[action] ?? "गतिविधि";
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
  locale: "en" | "hi" = "en",
): string {
  const label = auditActionLabel(action, locale);
  if (locale === "hi") return label;
  const note = (reason ?? "").trim();
  if (!note || note.length > MAX_REASON_LENGTH || note === label) return label;
  return `${label} — ${note}`;
}
