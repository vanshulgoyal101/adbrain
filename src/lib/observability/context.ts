import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { ProductEvent } from "./events";

export interface EventContext {
  requestId: string;
  userId: string | null;
  businessId: string | null;
  events: ProductEvent[];
}

export const eventContext = new AsyncLocalStorage<EventContext>();
type VerifiedActor = { id: string; email?: string | null };
const verifiedActors = new WeakMap<EventContext, VerifiedActor>();

export function observeVerifiedUser(user: VerifiedActor | null): void {
  observeIdentity(user?.id ?? null);
  const context = eventContext.getStore();
  if (!context) return;
  if (user) verifiedActors.set(context, { id: user.id, email: user.email });
  else verifiedActors.delete(context);
}

export function currentVerifiedActor(): VerifiedActor | undefined {
  const context = eventContext.getStore();
  if (!context) return undefined;
  const actor = verifiedActors.get(context);
  return actor?.id === context.userId ? actor : undefined;
}

export function currentRequestId(): string {
  return eventContext.getStore()?.requestId ?? randomUUID();
}

export function newEventContext(): EventContext {
  return { requestId: randomUUID(), userId: null, businessId: null, events: [] };
}

export function observeIdentity(userId: string | null, businessId?: string): void {
  const context = eventContext.getStore();
  if (!context) return;
  if (context.userId !== userId) {
    context.businessId = null;
    verifiedActors.delete(context);
  }
  context.userId = userId;
  if (userId && businessId) context.businessId = businessId;
}