import { z } from "zod";

const uuid = z.string().uuid();
const isoDate = z.string().datetime({ offset: true });
const safeMessage = z.string().min(1).max(240);
const metaId = z.string().min(1).max(128);

export const errorCodes = [
  "UNAUTHENTICATED",
  "NOT_FOUND",
  "FORBIDDEN",
  "INVALID_INPUT",
  "CONFLICT",
  "RATE_LIMITED",
  "UNAVAILABLE",
  "REAUTH_REQUIRED",
  "ATTEMPT_EXPIRED",
  "DISCOVERY_INCOMPLETE",
  "MISSING_PERMISSION",
  "ACCOUNT_RESTRICTED",
  "BILLING_REQUIRED",
  "UNSUPPORTED_CURRENCY",
  "SETUP_REQUIRED",
  "PREFLIGHT_BLOCKED",
  "RECONCILIATION_REQUIRED",
] as const;

export const errorCodeSchema = z.enum(errorCodes);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const apiErrorSchema = z.object({
  code: errorCodeSchema,
  message: safeMessage,
  retryable: z.boolean(),
});

export const apiResultSchema = <Value extends z.ZodTypeAny>(valueSchema: Value): z.ZodType<ApiResult<z.output<Value>>> =>
  z.discriminatedUnion("ok", [
    z.object({ ok: z.literal(true), data: valueSchema, requestId: uuid }),
    z.object({ ok: z.literal(false), error: apiErrorSchema, requestId: uuid }),
  ]) as z.ZodType<ApiResult<z.output<Value>>>;

export type ApiResult<Value> =
  | { ok: true; data: Value; requestId: string }
  | {
      ok: false;
      error: { code: ErrorCode; message: string; retryable: boolean };
      requestId: string;
    };

export const connectIntentSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("setup") }),
  z.object({
    kind: z.literal("prepare_campaign"),
    draftId: uuid,
    draftVersion: z.number().int().nonnegative().safe(),
  }),
  z.object({
    kind: z.literal("review_activation"),
    campaignId: uuid,
  }),
]);
export type ConnectIntent = z.infer<typeof connectIntentSchema>;

export const recoveryActionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("reconnect") }),
  z.object({ kind: z.literal("retry_check") }),
  z.object({ kind: z.literal("choose_assets") }),
  z.object({ kind: z.literal("contact_admin") }),
  z.object({
    kind: z.literal("open_meta"),
    url: z.string().url().refine((value) => value.startsWith("https://")),
    label: safeMessage,
  }),
]);
export type RecoveryAction = z.infer<typeof recoveryActionSchema>;

export const blockerSchema = z.object({
  code: errorCodeSchema,
  message: safeMessage,
  action: recoveryActionSchema.nullable(),
});
export type Blocker = z.infer<typeof blockerSchema>;

export const capabilitySchema = z.object({
  state: z.enum(["available", "blocked", "unknown"]),
  blockers: z.array(blockerSchema).max(20).readonly(),
});
export type Capability = z.infer<typeof capabilitySchema>;

export const capabilitiesSchema = z.object({
  canReadInsights: capabilitySchema,
  canReadLeads: capabilitySchema,
  canCreatePaused: capabilitySchema,
  canActivate: capabilitySchema,
});
export type Capabilities = z.infer<typeof capabilitiesSchema>;

export const selectedAssetsSchema = z.object({
  metaBusinessId: metaId.nullable(),
  adAccountId: z.string().regex(/^act_[0-9]+$/),
  accountName: z.string().min(1).max(200),
  pageId: metaId,
  pageName: z.string().min(1).max(200),
  currency: z.string().regex(/^[A-Z]{3}$/),
  timezoneName: z.string().min(1).max(128),
});
export type SelectedAssets = z.infer<typeof selectedAssetsSchema>;

export const connectionDtoSchema = z.object({
  businessId: uuid,
  generation: z.number().int().nonnegative().safe(),
  authorization: z.enum(["disconnected", "connected", "reauth_required", "revoked"]),
  selected: selectedAssetsSchema.nullable(),
  capabilities: capabilitiesSchema,
  checkedAt: isoDate.nullable(),
});
export type ConnectionDTO = z.infer<typeof connectionDtoSchema>;

export const candidateDtoSchema = z.object({
  pairId: metaId,
  assets: selectedAssetsSchema,
  eligible: z.boolean(),
  blockers: z.array(blockerSchema).max(20),
});
export type CandidateDTO = z.infer<typeof candidateDtoSchema>;

export const attemptDtoSchema = z
  .object({
    attemptId: uuid,
    businessId: uuid,
    intent: connectIntentSchema,
    expiresAt: isoDate,
    revision: z.number().int().nonnegative().safe(),
    state: z.enum([
      "authorizing",
      "discovering",
      "selection_required",
      "action_required",
      "connected",
      "cancelled",
      "expired",
      "failed",
    ]),
    discoveryComplete: z.boolean(),
    candidates: z.array(candidateDtoSchema).max(200).readonly(),
    connection: connectionDtoSchema.nullable(),
    blockers: z.array(blockerSchema).max(20).readonly(),
    retryAfterMs: z.number().int().positive().max(300_000).nullable(),
  })
  .superRefine((attempt, context) => {
    if (attempt.connection && attempt.connection.businessId !== attempt.businessId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["connection", "businessId"],
        message: "Connection business does not match attempt business.",
      });
    }
    if (attempt.state === "selection_required" && !attempt.discoveryComplete) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["discoveryComplete"],
        message: "Selection requires complete discovery.",
      });
    }
    if (attempt.state === "connected" && !attempt.connection) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["connection"],
        message: "Connected attempt requires a committed connection.",
      });
    }
  });
export type AttemptDTO = z.infer<typeof attemptDtoSchema>;

export type ConnectionPurpose =
  | "read_insights"
  | "read_leads"
  | "create_paused"
  | "activate"
  | "pause"
  | "delete";

export type ConnectionBinding = {
  adAccountId: string;
  pageId: string;
};