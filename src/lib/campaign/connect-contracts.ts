import { z } from "zod";
import {
  blockerSchema,
  selectedAssetsSchema,
  type Blocker,
  type SelectedAssets,
} from "@/lib/meta/connect-contracts";

const uuid = z.string().uuid();
const isoDate = z.string().datetime({ offset: true });
const boundedText = (max: number) => z.string().trim().min(1).max(max);
const moneyRupees = z.number().finite().int().nonnegative().max(10_000_000);
const safeVersion = z.number().int().nonnegative().safe();
const metaId = z.string().trim().min(1).max(128);

const targetingItemSchema = z.object({
  key: metaId,
  name: z.string().trim().max(200),
  type: z.enum(["city", "region", "country"]),
  radiusKm: z.number().finite().int().min(5).max(80).optional(),
});

export const targetingInputSchema = z
  .object({
    gender: z.enum(["all", "men", "women"]).optional(),
    location: z
      .object({
        mode: z.enum(["ai", "manual"]).optional(),
        cityScope: z.enum(["city_only", "radius"]).optional(),
        included: z.array(targetingItemSchema).max(50).optional(),
        excluded: z.array(targetingItemSchema).max(50).optional(),
        includedNames: z.array(boundedText(200)).max(50).optional(),
        excludedNames: z.array(boundedText(200)).max(50).optional(),
        radiusKm: z.number().finite().int().min(5).max(80).optional(),
      })
      .optional(),
    age: z
      .object({
        mode: z.enum(["ai", "manual"]).optional(),
        min: z.number().finite().int().min(18).max(65).optional(),
        max: z.number().finite().int().min(18).max(65).optional(),
      })
      .optional(),
    audience: z.object({
      interestNames: z.array(boundedText(100)).max(5),
      rationale: boundedText(2_000),
    }).strict().optional(),
  })
  .strict();

export type TargetingInputDTO = z.infer<typeof targetingInputSchema>;

export const draftInputSchema = z
  .object({
    businessId: uuid,
    name: boundedText(120),
    goal: boundedText(2_000),
    mode: z.enum(["manual", "guided"]),
    creativeIds: z.array(uuid).max(50),
    dailyBudgetRupees: moneyRupees,
    leadFormId: metaId.nullable(),
    destination: z.enum(["instant_form", "whatsapp"]).optional(),
    targeting: targetingInputSchema,
    abTest: z.boolean(),
  })
  .strict();
export type DraftInput = z.infer<typeof draftInputSchema>;

export const draftDtoSchema = z.object({
  draftId: uuid,
  version: safeVersion,
  expiresAt: isoDate,
  input: draftInputSchema,
});
export type DraftDTO = z.infer<typeof draftDtoSchema>;

export const draftUpdateRequestSchema = z.object({
  expectedVersion: safeVersion,
  input: draftInputSchema,
}).strict();
export type DraftUpdateRequest = z.infer<typeof draftUpdateRequestSchema>;

export const preflightRequestSchema = z.object({
  businessId: uuid,
  draftId: uuid,
  draftVersion: safeVersion,
}).strict();
export type PreflightRequest = z.infer<typeof preflightRequestSchema>;

const resolvedGeoSchema = z.object({
  countries: z.array(boundedText(128)).max(250).optional(),
  regions: z.array(z.object({ key: metaId })).max(250).optional(),
  cities: z.array(z.object({ key: metaId, radius: z.number().finite().optional(), distance_unit: z.string().max(20).optional() })).max(250).optional(),
});

export const reviewDtoSchema = z.object({
  draftId: uuid,
  draftVersion: safeVersion,
  connectionGeneration: safeVersion,
  canCreatePaused: z.boolean(),
  blockers: z.array(blockerSchema).max(20),
  planHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  creativeHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  destination: z.enum(["instant_form", "whatsapp"]).optional(),
  whatsappNumber: z.string().regex(/^\+[1-9]\d{6,14}$/).nullable().optional(),
  currency: z.literal("INR"),
  perAdSetDailyBudgetRupees: moneyRupees,
  adSetCount: z.number().int().positive().max(50),
  totalDailyBudgetRupees: moneyRupees,
  resolvedAreaLabel: z.string().max(500).nullable(),
  resolvedLocation: resolvedGeoSchema.optional(),
  resolvedExcludedLocation: resolvedGeoSchema.optional(),
  audienceInterests: z.array(z.object({ id: z.string().regex(/^\d+$/), name: boundedText(200) })).max(5).optional(),
  selected: selectedAssetsSchema.nullable(),
});
export type ReviewDTO = z.infer<typeof reviewDtoSchema>;

export const operationDtoSchema = z.object({
  operationId: uuid,
  businessId: uuid,
  state: z.enum(["pending", "running", "succeeded", "failed", "needs_reconciliation"]),
  campaignId: uuid.nullable(),
  blockers: z.array(blockerSchema).max(20),
});
export type OperationDTO = z.infer<typeof operationDtoSchema>;

export const createCampaignRequestSchema = z.object({
  businessId: uuid,
  draftId: uuid,
  draftVersion: safeVersion,
  planHash: z.string().regex(/^[a-f0-9]{64}$/),
  connectionGeneration: safeVersion,
  idempotencyKey: z.string().trim().min(8).max(200),
});
export type CreateCampaignRequest = z.infer<typeof createCampaignRequestSchema>;

export const planRequestSchema = z
  .object({
    goal: boundedText(2_000),
    answers: z
      .union([
        z.string().max(10_000),
        z.array(
          z.object({
            question: boundedText(500),
            answer: boundedText(1_000),
          }).strict(),
        ).max(50),
      ])
      .optional(),
  })
  .strict();
export type PlanRequest = z.infer<typeof planRequestSchema>;

const activationConfirmationSchema = z.object({
  status: z.literal("active"),
  confirmationDigest: z.string().regex(/^[a-f0-9]{64}$/),
  connectionGeneration: safeVersion,
}).strict();

const pauseSchema = z.object({ status: z.literal("paused") }).strict();

export const campaignActivationPatchSchema = z.discriminatedUnion("status", [
  pauseSchema,
  activationConfirmationSchema,
]);
export type CampaignActivationPatch = z.infer<typeof campaignActivationPatchSchema>;

export type CampaignBlocker = Blocker;
export type CampaignSelectedAssets = SelectedAssets;