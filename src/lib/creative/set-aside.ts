import type { Creative } from "@/lib/types";

/** #762: unreviewed ads older than 7 days are set aside (view only; approving one brings it back). */
export const SET_ASIDE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

type Item = Pick<Creative, "id" | "status"> & Partial<Pick<Creative, "created_at" | "variant_group">>;

/**
 * Ads that no longer need review: unapproved ones older than 7 days (#762), and #1148 the ones not
 * picked from a Create batch once the owner used another ad from it ("Use this ad").
 */
export function setAsideIds(items: Item[], now = Date.now()): Set<string> {
  const pickedGroups = new Set(items.filter((item) => item.status === "approved" && item.variant_group).map((item) => item.variant_group));
  return new Set(items.filter((item) => item.status !== "approved" && (
    (Boolean(item.created_at) && now - Date.parse(item.created_at!) > SET_ASIDE_AFTER_MS)
    || (Boolean(item.variant_group) && pickedGroups.has(item.variant_group))
  )).map((item) => item.id));
}
