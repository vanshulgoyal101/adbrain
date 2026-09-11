import { z } from "zod";
import { createCampaignRequestSchema, draftDtoSchema } from "@/lib/campaign/connect-contracts";

const recoverySchema = z.object({
  draft: draftDtoSchema,
  request: createCampaignRequestSchema.nullable(),
  operationId: z.string().uuid().nullable(),
});
export type CampaignRecovery = z.infer<typeof recoverySchema>;

export function recoveryStorageKey(ownerId: string, businessId: string): string {
  return `adbrain:campaign-recovery:v1:${ownerId}:${businessId}`;
}

export function readCampaignRecovery(storage: Pick<Storage, "getItem">, key: string, businessId: string): CampaignRecovery | null {
  try {
    const saved = recoverySchema.parse(JSON.parse(storage.getItem(key) ?? "null"));
    if (saved.draft.input.businessId !== businessId || (saved.request && (saved.request.businessId !== businessId
      || saved.request.draftId !== saved.draft.draftId || saved.request.draftVersion !== saved.draft.version))) return null;
    return saved;
  } catch { return null; }
}

export function writeCampaignRecovery(storage: Pick<Storage, "setItem">, key: string, recovery: CampaignRecovery): void {
  storage.setItem(key, JSON.stringify(recoverySchema.parse(recovery)));
}