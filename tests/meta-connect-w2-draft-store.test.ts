import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createDraft,
  getDraft,
  MAX_ACTIVE_DRAFTS,
  type DraftRecord,
  type DraftRepository,
  updateDraft,
} from "@/lib/campaign/draft-store";
import type { DraftInput } from "@/lib/campaign/connect-contracts";

const actor = {
  businessId: "b123b123-b123-4123-8123-b123b123b123",
  userId: "u123u123-u123-4123-8123-u123u123u123",
};
const baseInput: DraftInput = {
  businessId: actor.businessId,
  name: "Local leads",
  goal: "Generate qualified leads",
  mode: "manual",
  creativeIds: [],
  dailyBudgetRupees: 0,
  leadFormId: null,
  targeting: {},
  abTest: false,
};
const now = "2026-09-07T10:00:00.000Z";

function record(overrides: Partial<DraftRecord> = {}): DraftRecord {
  return {
    id: "d123d123-d123-4123-8123-d123d123d123",
    businessId: actor.businessId,
    ownerId: actor.userId,
    version: 1,
    input: baseInput,
    expiresAt: "2026-09-14T10:00:00.000Z",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

class MemoryDraftRepository implements DraftRepository {
  recordValue: DraftRecord | null = null;
  activeCount = 0;
  updateCalls = 0;

  async countActive(): Promise<number> {
    return this.activeCount;
  }

  async insert(plan: Parameters<DraftRepository["insert"]>[0]): Promise<DraftRecord> {
    this.recordValue = record({
      businessId: plan.businessId,
      ownerId: plan.ownerId,
      version: plan.version,
      input: plan.input,
      expiresAt: plan.expiresAt,
      createdAt: plan.createdAt,
      updatedAt: plan.updatedAt,
    });
    return this.recordValue;
  }

  async findOwned(): Promise<DraftRecord | null> {
    return this.recordValue;
  }

  async updateOwnedIfVersion(
    _actor: typeof actor,
    _draftId: string,
    plan: Parameters<DraftRepository["updateOwnedIfVersion"]>[2],
  ): Promise<DraftRecord | null> {
    this.updateCalls += 1;
    if (!this.recordValue || this.recordValue.version !== plan.expectedVersion) return null;
    this.recordValue = {
      ...this.recordValue,
      version: plan.nextVersion,
      input: plan.input,
      updatedAt: plan.updatedAt,
    };
    return this.recordValue;
  }
}

describe("campaign draft store", () => {
  it("creates a version-one DTO with a bounded expiry", async () => {
    const repository = new MemoryDraftRepository();
    const result = await createDraft(repository, { actor, draftInput: baseInput, now });

    expect(result).toMatchObject({ ok: true, draft: { version: 1, expiresAt: "2026-09-14T10:00:00.000Z" } });
  });

  it("rejects a draft for a different business before repository access", async () => {
    const repository = new MemoryDraftRepository();
    const result = await createDraft(repository, {
      actor,
      draftInput: { ...baseInput, businessId: "c123c123-c123-4123-8123-c123c123c123" },
      now,
    });

    expect(result).toEqual({ ok: false, code: "FORBIDDEN", message: "Draft business access is not allowed." });
    expect(repository.activeCount).toBe(0);
  });

  it("enforces the active draft limit before insert", async () => {
    const repository = new MemoryDraftRepository();
    repository.activeCount = MAX_ACTIVE_DRAFTS;
    const result = await createDraft(repository, { actor, draftInput: baseInput, now });

    expect(result).toEqual({ ok: false, code: "CONFLICT", message: "Draft limit reached. Finish or remove an existing draft first." });
    expect(repository.recordValue).toBeNull();
  });

  it("rejects expired reads without returning the stored input", async () => {
    const repository = new MemoryDraftRepository();
    repository.recordValue = record({ expiresAt: "2026-09-07T09:59:59.999Z" });

    const result = await getDraft(repository, actor, repository.recordValue.id, now);

    expect(result).toEqual({ ok: false, code: "NOT_FOUND", message: "Draft not found." });
  });

  it("updates with optimistic versioning", async () => {
    const repository = new MemoryDraftRepository();
    repository.recordValue = record();
    const result = await updateDraft(repository, {
      actor,
      draftId: repository.recordValue.id,
      expectedVersion: 1,
      draftInput: { ...baseInput, name: "Updated leads" },
      now: "2026-09-07T10:01:00.000Z",
    });

    expect(result).toMatchObject({ ok: true, draft: { version: 2, input: { name: "Updated leads" } } });
  });

  it("rejects a stale tab before it can overwrite a newer version", async () => {
    const repository = new MemoryDraftRepository();
    repository.recordValue = record({ version: 2, input: { ...baseInput, name: "Newer tab" } });
    const result = await updateDraft(repository, {
      actor,
      draftId: repository.recordValue.id,
      expectedVersion: 1,
      draftInput: { ...baseInput, name: "Stale tab" },
      now,
    });

    expect(result).toEqual({ ok: false, code: "CONFLICT", message: "Draft changed in another tab. Reload before saving." });
    expect(repository.updateCalls).toBe(0);
    expect(repository.recordValue.input.name).toBe("Newer tab");
  });

  it("turns an atomic repository version miss into a conflict", async () => {
    const repository = new MemoryDraftRepository();
    repository.recordValue = record();
    const original = repository.updateOwnedIfVersion.bind(repository);
    repository.updateOwnedIfVersion = async (...args) => {
      repository.recordValue = record({ version: 2, input: { ...baseInput, name: "Concurrent tab" } });
      return original(...args);
    };

    const result = await updateDraft(repository, {
      actor,
      draftId: repository.recordValue.id,
      expectedVersion: 1,
      draftInput: { ...baseInput, name: "Losing tab" },
      now,
    });

    expect(result).toEqual({ ok: false, code: "CONFLICT", message: "Draft changed in another tab. Reload before saving." });
  });
});

describe("campaign draft migration contract", () => {
  const sql = readFileSync(
    join(process.cwd(), "db", "migrations", "20260907_campaign_connect.sql"),
    "utf8",
  ).toLowerCase();

  it("enforces draft and operation tenant consistency", () => {
    expect(sql).toContain("create unique index if not exists campaign_drafts_business_id_idx");
    expect(sql).toContain("foreign key (business_id, draft_id)");
    expect(sql).toContain("references public.campaign_drafts(business_id, id)");
    expect(sql).toContain("on delete restrict");
  });

  it("provides an atomic non-expired expected-version update", () => {
    expect(sql).toContain("update_campaign_draft_if_version");
    expect(sql).toContain("version = p_expected_version");
    expect(sql).toContain("expires_at > p_now");
    expect(sql).toContain("version = version + 1");
    expect(sql).toContain("revoke execute on function public.update_campaign_draft_if_version");
    expect(sql).toContain("grant execute on function public.update_campaign_draft_if_version");
  });

  it("provides fenced operation claim, checkpoint, and finish primitives", () => {
    expect(sql).toContain("campaign_id uuid references public.campaigns(id) on delete set null");
    expect(sql).toContain("claim_campaign_operation");
    expect(sql).toContain("for update");
    expect(sql).toContain("unique (business_id, kind, idempotency_key)");
    expect(sql).toContain("checkpoint_campaign_operation");
    expect(sql).toContain("external_ids = p_external_ids");
    expect(sql).toContain("connection_generation = p_connection_generation");
    expect(sql).toContain("finish_campaign_operation");
    expect(sql).toContain("state = 'succeeded'");
    expect(sql).toContain("phase = 'complete'");
    expect(sql).toContain("grant execute on function public.claim_campaign_operation");
    expect(sql).toContain("grant execute on function public.checkpoint_campaign_operation");
    expect(sql).toContain("grant execute on function public.finish_campaign_operation");
  });
});