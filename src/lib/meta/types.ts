export type CampaignDeliverySnapshot = {
  campaign: { id: string; status: string; effectiveStatus: string | null };
  adSets: Array<{ id: string; status: string; effectiveStatus: string | null; dailyBudgetPaise: number; pageId: string; destinationType: string | null; targeting: unknown }>;
  ads: Array<{ id: string; status: string; effectiveStatus: string | null; adSetId: string; creativeId: string }>;
};
