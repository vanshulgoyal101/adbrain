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

export function currentRequestId(): string {
  return eventContext.getStore()?.requestId ?? randomUUID();
}

export function newEventContext(): EventContext {
  return { requestId: randomUUID(), userId: null, businessId: null, events: [] };
}

export function observeIdentity(userId: string | null, businessId?: string): void {
  const context = eventContext.getStore();
  if (!context) return;
  if (context.userId !== userId) context.businessId = null;
  context.userId = userId;
  if (userId && businessId) context.businessId = businessId;
}