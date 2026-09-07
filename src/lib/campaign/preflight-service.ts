import { isDraftExpired, type DraftRecord } from "@/lib/campaign/draft-store";
import {
  runPreflight,
  type PreflightConnection,
  type PreflightCreative,
  type PreflightForm,
  type PreflightGeo,
} from "@/lib/campaign/preflight";
import type { ReviewDTO } from "@/lib/campaign/connect-contracts";

export type PreflightActor = {
  businessId: string;
  userId: string;
};

export type PreflightLoaders = {
  findDraft: (actor: PreflightActor, draftId: string) => Promise<DraftRecord | null>;
  findCreatives: (businessId: string, creativeIds: string[]) => Promise<PreflightCreative[]>;
  findForm: (businessId: string, formId: string) => Promise<PreflightForm | null>;
  getConnection: (actor: PreflightActor) => Promise<PreflightConnection | null>;
  resolveGeo: (actor: PreflightActor, draft: DraftRecord) => Promise<PreflightGeo>;
  hash: (payload: string) => string;
};

export type PreflightServiceResult =
  | { kind: "review"; review: ReviewDTO }
  | { kind: "not_found" }
  | { kind: "forbidden" }
  | { kind: "stale"; draftVersion: number };

export async function prepareCampaignReview(
  loaders: PreflightLoaders,
  input: {
    actor: PreflightActor;
    draftId: string;
    requestedDraftVersion: number;
    now: string;
  },
): Promise<PreflightServiceResult> {
  const draft = await loaders.findDraft(input.actor, input.draftId);
  if (!draft) return { kind: "not_found" };
  if (draft.businessId !== input.actor.businessId || draft.ownerId !== input.actor.userId) {
    return { kind: "forbidden" };
  }
  if (isDraftExpired(draft.expiresAt, input.now)) return { kind: "not_found" };
  if (draft.version !== input.requestedDraftVersion) {
    return { kind: "stale", draftVersion: draft.version };
  }

  const [connection, creatives, form, geo] = await Promise.all([
    loaders.getConnection(input.actor),
    loaders.findCreatives(input.actor.businessId, draft.input.creativeIds),
    draft.input.leadFormId
      ? loaders.findForm(input.actor.businessId, draft.input.leadFormId)
      : Promise.resolve(null),
    loaders.resolveGeo(input.actor, draft),
  ]);

  return {
    kind: "review",
    review: runPreflight({
      draft: draft.input,
      draftId: draft.id,
      draftVersion: draft.version,
      connection,
      creatives,
      form,
      geo,
      hash: loaders.hash,
    }),
  };
}