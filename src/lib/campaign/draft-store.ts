import {
  draftDtoSchema,
  draftInputSchema,
  type DraftDTO,
  type DraftInput,
} from "@/lib/campaign/connect-contracts";
import type { ErrorCode } from "@/lib/meta/connect-contracts";

export const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_ACTIVE_DRAFTS = 50;

export type DraftRecord = {
  id: string;
  businessId: string;
  ownerId: string;
  version: number;
  input: DraftInput;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
};

export type DraftActor = {
  businessId: string;
  userId: string;
};

export type DraftFailureCode = Extract<ErrorCode, "FORBIDDEN" | "INVALID_INPUT" | "NOT_FOUND" | "CONFLICT">;

export type DraftFailure = {
  ok: false;
  code: DraftFailureCode;
  message: string;
};

export type DraftSuccess = { ok: true; draft: DraftDTO };
export type DraftResult = DraftSuccess | DraftFailure;

export type DraftCreatePlan = {
  businessId: string;
  ownerId: string;
  version: 1;
  input: DraftInput;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
};

export type DraftUpdatePlan = {
  expectedVersion: number;
  nextVersion: number;
  input: DraftInput;
  updatedAt: string;
};

export interface DraftRepository {
  countActive(actor: DraftActor, now: string): Promise<number>;
  insert(plan: DraftCreatePlan): Promise<DraftRecord>;
  findOwned(actor: DraftActor, draftId: string): Promise<DraftRecord | null>;
  updateOwnedIfVersion(
    actor: DraftActor,
    draftId: string,
    plan: DraftUpdatePlan,
  ): Promise<DraftRecord | null>;
}

function failure(code: DraftFailureCode, message: string): DraftFailure {
  return { ok: false, code, message };
}

function parseInput(input: unknown): DraftInput | DraftFailure {
  const parsed = draftInputSchema.safeParse(input);
  return parsed.success
    ? parsed.data
    : failure("INVALID_INPUT", "Draft input is invalid.");
}

function owns(actor: DraftActor, draft: Pick<DraftRecord, "businessId" | "ownerId">): boolean {
  return actor.businessId === draft.businessId && actor.userId === draft.ownerId;
}

export function isDraftExpired(expiresAt: string, now: string): boolean {
  const expiryMs = Date.parse(expiresAt);
  const nowMs = Date.parse(now);
  return !Number.isFinite(expiryMs) || !Number.isFinite(nowMs) || expiryMs <= nowMs;
}

export function draftRecordToDTO(record: DraftRecord): DraftDTO {
  return draftDtoSchema.parse({
    draftId: record.id,
    version: record.version,
    expiresAt: record.expiresAt,
    input: record.input,
  });
}

export function draftRecordFromRow(row: {
  id: string;
  business_id: string;
  owner_id: string;
  version: number;
  input: unknown;
  expires_at: string;
  created_at: string;
  updated_at: string;
}): DraftRecord {
  return {
    id: row.id,
    businessId: row.business_id,
    ownerId: row.owner_id,
    version: row.version,
    input: draftInputSchema.parse(row.input),
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function prepareDraftCreate(input: {
  actor: DraftActor;
  draftInput: unknown;
  now: string;
  ttlMs?: number;
}): DraftCreatePlan | DraftFailure {
  const parsedInput = parseInput(input.draftInput);
  if ("ok" in parsedInput) return parsedInput;
  if (parsedInput.businessId !== input.actor.businessId) {
    return failure("FORBIDDEN", "Draft business access is not allowed.");
  }
  const nowMs = Date.parse(input.now);
  const ttlMs = input.ttlMs ?? DRAFT_TTL_MS;
  if (!Number.isFinite(nowMs) || !Number.isFinite(ttlMs) || ttlMs <= 0) {
    return failure("INVALID_INPUT", "Draft expiry is invalid.");
  }
  const timestamp = new Date(nowMs).toISOString();
  return {
    businessId: input.actor.businessId,
    ownerId: input.actor.userId,
    version: 1,
    input: parsedInput,
    expiresAt: new Date(nowMs + ttlMs).toISOString(),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function prepareDraftUpdate(input: {
  actor: DraftActor;
  current: DraftRecord;
  expectedVersion: number;
  draftInput: unknown;
  now: string;
}): DraftUpdatePlan | DraftFailure {
  if (!owns(input.actor, input.current)) {
    return failure("FORBIDDEN", "Draft access is not allowed.");
  }
  if (isDraftExpired(input.current.expiresAt, input.now)) {
    return failure("NOT_FOUND", "Draft not found.");
  }
  if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion !== input.current.version) {
    return failure("CONFLICT", "Draft changed in another tab. Reload before saving.");
  }
  const parsedInput = parseInput(input.draftInput);
  if ("ok" in parsedInput) return parsedInput;
  if (parsedInput.businessId !== input.actor.businessId) {
    return failure("FORBIDDEN", "Draft business access is not allowed.");
  }
  const nowMs = Date.parse(input.now);
  if (!Number.isFinite(nowMs)) return failure("INVALID_INPUT", "Draft timestamp is invalid.");
  return {
    expectedVersion: input.expectedVersion,
    nextVersion: input.expectedVersion + 1,
    input: parsedInput,
    updatedAt: new Date(nowMs).toISOString(),
  };
}

export async function createDraft(
  repository: DraftRepository,
  input: {
    actor: DraftActor;
    draftInput: unknown;
    now: string;
    ttlMs?: number;
  },
): Promise<DraftResult> {
  const plan = prepareDraftCreate(input);
  if ("ok" in plan) return plan;
  const activeCount = await repository.countActive(input.actor, input.now);
  if (activeCount >= MAX_ACTIVE_DRAFTS) {
    return failure("CONFLICT", "Draft limit reached. Finish or remove an existing draft first.");
  }
  return { ok: true, draft: draftRecordToDTO(await repository.insert(plan)) };
}

export async function getDraft(
  repository: DraftRepository,
  actor: DraftActor,
  draftId: string,
  now: string,
): Promise<DraftResult> {
  const record = await repository.findOwned(actor, draftId);
  if (!record || isDraftExpired(record.expiresAt, now)) {
    return failure("NOT_FOUND", "Draft not found.");
  }
  return { ok: true, draft: draftRecordToDTO(record) };
}

export async function updateDraft(
  repository: DraftRepository,
  input: {
    actor: DraftActor;
    draftId: string;
    expectedVersion: number;
    draftInput: unknown;
    now: string;
  },
): Promise<DraftResult> {
  const current = await repository.findOwned(input.actor, input.draftId);
  if (!current || isDraftExpired(current.expiresAt, input.now)) {
    return failure("NOT_FOUND", "Draft not found.");
  }
  const plan = prepareDraftUpdate({ ...input, current });
  if ("ok" in plan) return plan;
  const updated = await repository.updateOwnedIfVersion(input.actor, input.draftId, plan);
  if (!updated) return failure("CONFLICT", "Draft changed in another tab. Reload before saving.");
  return { ok: true, draft: draftRecordToDTO(updated) };
}