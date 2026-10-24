import { z } from "zod";

/**
 * #523 (2-Tier, #518): the customer's own Facebook Page becomes their child business's
 * `shared_page_id` and the ad account's `end_advertiser`. Meta needs the customer to be an admin
 * of it (error 1690138) and can't create Pages by API, so a customer without one creates it on
 * Meta and then checks again.
 */
export const META_PAGE_CREATE_URL = "https://www.facebook.com/pages/create/";

const pageId = z.string().regex(/^[0-9]{1,24}$/);
const snapshotSchema = z.object({
  pages: z.array(z.object({ id: z.string(), name: z.string().optional(), tasks: z.array(z.string()).optional() }).passthrough()).max(500),
}).passthrough();

/** Pages from a Connect discovery snapshot that the customer administers (Meta task MANAGE). */
export function adminPages(snapshot: unknown): { id: string; name: string }[] {
  const parsed = snapshotSchema.safeParse(snapshot);
  if (!parsed.success) return [];
  return parsed.data.pages
    .filter((page) => pageId.safeParse(page.id).success && page.tasks?.includes("MANAGE"))
    .map((page) => ({ id: page.id, name: page.name?.trim() || "Facebook Page" }));
}

type ManagedRow = { business_id: string; state: string; page_id: string | null; child_business_id: string | null };

/** The ledger writes this step needs (service role; the database enforces the state machine). */
export interface ManagedAccountStore {
  get(businessId: string): Promise<ManagedRow | null>;
  insert(values: { business_id: string; page_id: string; state: "page_linked" }): Promise<void>;
  update(values: { page_id: string; state: "page_linked" }): Promise<void>;
  event(values: { business_id: string; step: "page"; outcome: "succeeded"; meta_object_id: string; request_id?: string }): Promise<void>;
}

export type LinkPageResult =
  | { ok: true; state: string; pageId: string }
  | { ok: false; code: "PAGE_NOT_ADMIN" | "PAGE_LOCKED" };

const RELINKABLE = new Set(["requested", "page_linked", "failed"]);

export async function linkManagedPage(
  store: ManagedAccountStore,
  input: { businessId: string; pageId: string; snapshot: unknown; requestId?: string },
): Promise<LinkPageResult> {
  if (!adminPages(input.snapshot).some((page) => page.id === input.pageId)) return { ok: false, code: "PAGE_NOT_ADMIN" };
  const row = await store.get(input.businessId);
  if (row?.page_id === input.pageId && row.state !== "requested") return { ok: true, state: row.state, pageId: input.pageId };
  // Once the child business exists, its Page is part of it; changing it means offboarding.
  if (row && (row.child_business_id || !RELINKABLE.has(row.state))) return { ok: false, code: "PAGE_LOCKED" };
  if (row) await store.update({ page_id: input.pageId, state: "page_linked" });
  else await store.insert({ business_id: input.businessId, page_id: input.pageId, state: "page_linked" });
  await store.event({
    business_id: input.businessId, step: "page", outcome: "succeeded", meta_object_id: input.pageId,
    ...(input.requestId ? { request_id: input.requestId } : {}),
  });
  return { ok: true, state: "page_linked", pageId: input.pageId };
}
