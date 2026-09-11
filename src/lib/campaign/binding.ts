import type { ConnectionBinding, ConnectionDTO } from "@/lib/meta/connect-contracts";

export type StoredCampaignBinding = {
  metaAdAccountId: string | null;
  metaPageId: string | null;
  metaConnectionGeneration: number | null;
};

export function readStoredCampaignBinding(value: unknown): StoredCampaignBinding {
  if (!value || typeof value !== "object") {
    return { metaAdAccountId: null, metaPageId: null, metaConnectionGeneration: null };
  }
  const row = value as Record<string, unknown>;
  const account = row.meta_ad_account_id ?? row.metaAdAccountId;
  const page = row.meta_page_id ?? row.metaPageId;
  const generation = row.meta_connection_generation ?? row.metaConnectionGeneration;
  return {
    metaAdAccountId: typeof account === "string" ? account : null,
    metaPageId: typeof page === "string" ? page : null,
    metaConnectionGeneration: typeof generation === "number" ? generation : null,
  };
}

export type CampaignBindingDecision =
  | {
      kind: "bound";
      binding: ConnectionBinding;
      expectedGeneration: number;
    }
  | { kind: "missing"; reason: "MISSING_CAMPAIGN_BINDING" }
  | { kind: "blocked"; reason: "CONNECTION_NOT_SELECTED" | "CAMPAIGN_BINDING_MISMATCH" | "CONNECTION_GENERATION_CHANGED" };

export function checkCampaignBinding(
  campaign: StoredCampaignBinding,
  connection: Pick<ConnectionDTO, "generation" | "selected">,
): CampaignBindingDecision {
  if (
    !campaign.metaAdAccountId ||
    !campaign.metaPageId ||
    campaign.metaConnectionGeneration === null ||
    !Number.isSafeInteger(campaign.metaConnectionGeneration) ||
    campaign.metaConnectionGeneration < 0
  ) {
    return { kind: "missing", reason: "MISSING_CAMPAIGN_BINDING" };
  }
  if (!connection.selected) {
    return { kind: "blocked", reason: "CONNECTION_NOT_SELECTED" };
  }
  if (
    campaign.metaAdAccountId !== connection.selected.adAccountId ||
    campaign.metaPageId !== connection.selected.pageId
  ) {
    return { kind: "blocked", reason: "CAMPAIGN_BINDING_MISMATCH" };
  }
  if (campaign.metaConnectionGeneration !== connection.generation) {
    return { kind: "blocked", reason: "CONNECTION_GENERATION_CHANGED" };
  }
  return {
    kind: "bound",
    binding: {
      adAccountId: campaign.metaAdAccountId,
      pageId: campaign.metaPageId,
    },
    expectedGeneration: campaign.metaConnectionGeneration,
  };
}