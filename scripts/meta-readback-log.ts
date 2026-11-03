/** The log line for an ad set read-back: only the non-identifying fields, so Page, pixel and ad-set ids never reach command logs (#2713). */
export function adSetReadbackLine(goal: string, status: number, body: unknown): string {
  const { optimization_goal, destination_type, billing_event, promoted_object } = (body ?? {}) as Record<string, unknown>;
  const keys = promoted_object && typeof promoted_object === "object" ? Object.keys(promoted_object) : [];
  return `${goal} ad set read-back ${status} ${JSON.stringify({ optimization_goal, destination_type, billing_event, promoted_object_keys: keys })}`;
}
