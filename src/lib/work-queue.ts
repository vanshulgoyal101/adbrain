import type { Business, Campaign, Creative } from "@/lib/types";

export interface WorkItem {
  id: string;
  title: string;
  detail: string;
  href: string;
  action: string;
  tone: "attention" | "work";
}

type QueueBusiness = Pick<
  Business,
  "name" | "description" | "brand_voice" | "target_audience" | "locations"
>;

export function missingBrandContext(business: QueueBusiness): string[] {
  return [
    !business.description?.trim() && "business description",
    !business.brand_voice?.trim() && "brand voice",
    !business.target_audience?.trim() && "target audience",
    !business.locations.some((location) => location.trim()) && "service areas",
  ].filter((field): field is string => Boolean(field));
}

export function buildWorkQueue({
  business,
  creatives,
  campaigns,
  metaReady,
}: {
  business: QueueBusiness | null;
  creatives: Pick<Creative, "id" | "status">[];
  campaigns: Pick<Campaign, "status" | "creative_ids">[];
  metaReady: boolean;
}): WorkItem[] {
  if (!business)
    return [
      {
        id: "brand",
        title: "Set up your Brand Brain",
        detail: "Add your business, audience, voice, and service areas.",
        href: "/brand",
        action: "Set up brand",
        tone: "work",
      },
    ];

  const queue: WorkItem[] = [];
  const drafts = creatives.filter(
    (creative) => creative.status === "draft",
  ).length;
  const usedIds = new Set(
    campaigns.flatMap((campaign) => campaign.creative_ids),
  );
  const unusedApproved = creatives.filter(
    (creative) => creative.status === "approved" && !usedIds.has(creative.id),
  ).length;
  const missing = missingBrandContext(business);
  const paused = campaigns.filter(
    (campaign) => campaign.status === "paused",
  ).length;
  const draftCampaigns = campaigns.filter(
    (campaign) => campaign.status === "draft",
  ).length;

  if (drafts)
    queue.push({
      id: "review",
      title: `${drafts} ${drafts === 1 ? "ad needs" : "ads need"} review`,
      detail: "Check the image, copy, and claims before approving.",
      href: "/studio?status=draft",
      action: "Review ads",
      tone: "work",
    });
  if (missing.length)
    queue.push({
      id: "context",
      title: "Add missing brand context",
      detail: `Missing: ${missing.join(", ")}.`,
      href: "/brand",
      action: "Update brand",
      tone: "attention",
    });
  if (!creatives.length)
    queue.push({
      id: "create",
      title: "Create your first ad",
      detail: "Start with a goal for your business.",
      href: "/create",
      action: "Create ad",
      tone: "work",
    });
  if (!metaReady && (unusedApproved || campaigns.length))
    queue.push({
      id: "connection",
      title: "Check your Meta connection",
      detail:
        "Connect an eligible account before creating or managing Meta campaigns. You can still export approved ads.",
      href: "/settings",
      action: "Open settings",
      tone: "attention",
    });
  if (unusedApproved)
    queue.push({
      id: "approved",
      title: `${unusedApproved} approved ${unusedApproved === 1 ? "ad is" : "ads are"} available`,
      detail:
        "Not attached to a tracked campaign. Export the work or prepare a new campaign.",
      href: metaReady ? "/campaigns" : "/studio?status=approved",
      action: metaReady ? "Prepare campaign" : "Export ads",
      tone: "work",
    });
  if (paused || draftCampaigns)
    queue.push({
      id: "campaigns",
      title: "Review campaigns before activation",
      detail: `${paused} paused, ${draftCampaigns} draft. Check the creative, audience, and budget; leave paused until you are ready.`,
      href: "/campaigns",
      action: "Review campaigns",
      tone: "work",
    });
  return queue;
}
