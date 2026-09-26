import { z } from "zod";
import { parseLeadFields } from "@/lib/leads/parse";
import type { MetaClient, MetaLeadPage, MetaLead } from "@/lib/meta/client";
import type { AuthorizedBusiness } from "@/lib/meta/connection-access";
import type { ConnectionDTO } from "@/lib/meta/connect-contracts";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json, LeadInsert, LeadSyncScopeArgs } from "@/lib/types";

const cursor = z.string().min(1).max(4096);
const pendingForm = z.object({
  id: z.string(), name: z.string(), after: cursor.nullable(), seen: z.array(cursor), failed: z.boolean(),
});
const progressSchema = z.object({
  formsDone: z.boolean(), formsAfter: cursor.nullable(), formsSeen: z.array(cursor),
  formIds: z.array(z.string()), pending: z.array(pendingForm), discover: z.boolean(),
});
const runSchema = z.object({
  id: z.uuid(), version: z.number().int().nonnegative(), state: z.enum(["complete", "partial"]), progress: progressSchema,
});
type Progress = z.infer<typeof progressSchema>;
type Run = z.infer<typeof runSchema>;

export class LeadSyncError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

function persistenceError(code?: string): LeadSyncError {
  if (code === "42501" || code === "P0002") return new LeadSyncError("This sync is not available for this business.", 404);
  if (code === "40001") return new LeadSyncError("The sync or Meta connection changed. Reload and resume, or start a fresh sync after reconnecting.", 409);
  return new LeadSyncError("Could not verify the saved sync progress. Retry to resume.", 503);
}

function summary(run: Run) {
  return { id: run.id, state: run.state, hasMore: run.state !== "complete" };
}

export async function syncMetaLeads(
  context: AuthorizedBusiness, connection: ConnectionDTO, meta: MetaClient,
  syncId: string | undefined, signal: AbortSignal,
) {
  if (!connection.selected) throw new LeadSyncError("Connect a Meta Page before syncing.", 400);
  const db = createAdminClient();
  const scope: LeadSyncScopeArgs = {
    p_business_id: context.businessId, p_owner_id: context.userId, p_sync_id: syncId ?? null,
    p_generation: connection.generation, p_ad_account_id: connection.selected.adAccountId, p_page_id: connection.selected.pageId,
  };
  const started = await db.rpc("lead_sync_start", scope).abortSignal(AbortSignal.timeout(3_000));
  if (started.error) throw persistenceError(started.error.code);
  const parsed = runSchema.safeParse(started.data?.[0]);
  if (!parsed.success) throw persistenceError();
  let run = parsed.data;
  let imported = 0;
  let successfulPages = 0;
  let requests = 0;
  let discoveryFailed = false;
  const failedThisRequest = new Set<string>();

  const save = async (progress: Progress, rows: LeadInsert[] = []) => {
    const saved = await db.rpc("lead_sync_checkpoint", {
      ...scope, p_sync_id: run.id, p_version: run.version,
      p_rows: rows as unknown as Json, p_progress: progress as unknown as Json,
    }).abortSignal(AbortSignal.timeout(3_000));
    if (saved.error) throw persistenceError(saved.error.code);
    const checkpoint = z.object({ run: runSchema, imported: z.number().int().nonnegative() }).safeParse(saved.data);
    if (!checkpoint.success) throw persistenceError();
    run = checkpoint.data.run;
    imported += checkpoint.data.imported;
  };

  try {
    while (run.state === "partial" && requests < 24 && !signal.aborted) {
      const progress = progressSchema.parse(run.progress);
      const available = progress.pending.filter(form => !failedThisRequest.has(form.id));
      if (!progress.formsDone && !discoveryFailed && (progress.discover || available.length === 0)) {
        requests++;
        try {
          const page = await meta.listLeadFormsPage({ after: progress.formsAfter });
          if (page.after && progress.formsSeen.includes(page.after)) throw new Error("Repeated cursor");
          for (const form of page.data) {
            if (progress.formIds.includes(form.id)) continue;
            progress.formIds.push(form.id);
            progress.pending.push({ id: form.id, name: form.name, after: null, seen: [], failed: false });
          }
          progress.formsAfter = page.after;
          progress.formsDone = page.after === null;
          if (page.after) progress.formsSeen.push(page.after);
        } catch {
          discoveryFailed = true;
        }
        progress.discover = false;
        await save(progress);
        continue;
      }
      const batch = available.slice(0, Math.min(3, 24 - requests));
      if (!batch.length) break;
      requests += batch.length;
      const pages = await Promise.all(batch.map(async form => {
        try {
          const page = await meta.listLeadsForFormPage(form.id, { after: form.after });
          if (page.after && form.seen.includes(page.after)) throw new Error("Repeated cursor");
          return page;
        } catch { return null; }
      }));
      for (let index = 0; index < batch.length; index++) {
        const form = batch[index];
        const page: MetaLeadPage<MetaLead> | null = pages[index];
        const next = progressSchema.parse(run.progress);
        next.pending = next.pending.filter(pending => pending.id !== form.id);
        next.discover = true;
        if (!page) {
          failedThisRequest.add(form.id);
          next.pending.push({ ...form, failed: true });
          await save(next);
          continue;
        }
        if (page.after) next.pending.push({ ...form, after: page.after, seen: [...form.seen, page.after], failed: false });
        const rows = page.data.map(lead => {
          const fields = parseLeadFields(lead.field_data);
          return {
            business_id: context.businessId, meta_lead_id: lead.id, form_id: form.id, form_name: form.name,
            full_name: fields.fullName, phone: fields.phone, email: fields.email, city: fields.city,
            field_data: fields.fields, created_time: lead.created_time || null,
          };
        });
        await save(next, rows);
        successfulPages++;
      }
    }
  } catch (error) {
    const failure = error instanceof LeadSyncError ? error : persistenceError();
    return { sync: summary(run), imported, failedForms: run.progress.pending.filter(form => form.failed).map(({ id, name }) => ({ id, name })), error: failure.message, status: failure.status };
  }
  const failedForms = run.progress.pending.filter(form => form.failed).map(({ id, name }) => ({ id, name }));
  const allFailed = successfulPages === 0 && (failedThisRequest.size > 0 || discoveryFailed);
  return {
    sync: summary(run), imported, failedForms,
    error: allFailed ? "Could not read Meta enquiries. Saved progress is available to retry." : undefined,
    status: allFailed ? 502 : 200,
  };
}