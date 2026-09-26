import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { ConnectionAccessError, requireOwnedBusiness } from "@/lib/meta/connection-access";
import { rateLimitResponse } from "@/lib/security/rate-limit";
import { createAnnualPaymentQuote } from "./allocation";
import { CheckoutRequestError, paymentJsonBody, paymentReply, readPaymentBody } from "./checkout-request";
import { getProductionCollectionPolicy, getProductionPaymentConfig, productionPaymentPolicySchema, ProductionPaymentError } from "./production-config";
import { createProductionPaymentClient } from "./razorpay-production";
import { capturedPaymentMatchesOrder, verifyRazorpayCheckoutSignature, verifyRazorpayWebhookSignature } from "./razorpay-verification";

const identifier = (prefix: string) => z.string().regex(new RegExp(`^${prefix}_[A-Za-z0-9]{1,100}$`));
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const eventIdSchema = z.string().regex(/^[A-Za-z0-9_:.-]{1,160}$/);
const amountSchema = z.number().int().min(0).max(1_000_000);
const orderSchema = z.object({
  id: z.uuid(), business_id: z.uuid(), user_id: z.uuid(), environment: z.literal("live"),
  account_id: identifier("acc"), key_id: z.string().regex(/^rzp_live_[A-Za-z0-9]{1,100}$/),
  amount_paise: z.literal(1_000_000), currency: z.literal("INR"),
  state: z.enum(["creating", "created", "captured", "needs_reconciliation", "review_required", "refund_pending", "partially_refunded", "refunded"]),
  provider_order_id: identifier("order").nullable(), payment_id: identifier("pay").nullable(),
  captured_paise: amountSchema, refunded_paise: amountSchema, provider_refunded_paise: amountSchema,
  review_required: z.boolean(), refund_hold: z.boolean(), terms: productionPaymentPolicySchema, terms_hash: hashSchema,
  accepted_at: z.string(),
});
const refundOperationSchema = z.object({
  id: z.uuid(), order_id: z.uuid(), amount_paise: amountSchema,
  state: z.enum(["creating", "submitted", "needs_reconciliation", "processed", "failed"]), provider_refund_id: identifier("rfnd").nullable(),
});
const recoverySchema = z.object({ order: orderSchema, refunds: z.array(refundOperationSchema).max(10_000), refundIds: z.array(identifier("rfnd")).max(10_000) });
const eventSchema = z.object({
  account_id: identifier("acc"), key_id: z.string(), event_id: eventIdSchema, payload_hash: hashSchema,
  payment_id: identifier("pay"), provider_order_id: identifier("order").nullable(), refund_id: identifier("rfnd").nullable(),
  kind: z.enum(["capture", "pending", "refund", "dispute"]), conflicted: z.boolean(),
});
type SavedOrder = z.infer<typeof orderSchema>;
type Config = ReturnType<typeof getProductionPaymentConfig>;
type Action = "create" | "read" | "verify" | "reconcile" | "webhook" | "operator";

function parsed<Schema extends z.ZodType>(schema: Schema, input: unknown): z.output<Schema> {
  const result = schema.safeParse(input);
  if (!result.success) throw new CheckoutRequestError(400, "Invalid payment request.");
  return result.data;
}

async function stored<Schema extends z.ZodType>(query: {
  abortSignal(signal: AbortSignal): PromiseLike<{ data: unknown; error: unknown }>;
}, schema: Schema): Promise<z.output<Schema>> {
  const { data, error } = await query.abortSignal(AbortSignal.timeout(4_000));
  const result = schema.safeParse(data);
  if (error || !result.success) throw new CheckoutRequestError(503, "Payment storage is unavailable. Keep the original payment reference.");
  return result.data;
}

function currentPolicy() {
  try { return getProductionCollectionPolicy(); }
  catch (error) {
    if (error instanceof ProductionPaymentError) return null;
    throw error;
  }
}

function orderResponse(order: SavedOrder, config: Config) {
  const policy = currentPolicy();
  return {
    orderId: order.id, environment: "live", status: order.state, amountPaise: order.amount_paise, currency: order.currency,
    capturedPaise: order.captured_paise, refundedPaise: order.refunded_paise, reviewRequired: order.review_required,
    providerReportedRefundedPaise: order.provider_refunded_paise, refundReconciliationPending: order.provider_refunded_paise > order.refunded_paise,
    refundHold: order.refund_hold, acceptedAt: order.accepted_at, terms: order.terms, termsHash: order.terms_hash,
    spendablePaise: 0, canActivateCampaign: false,
    receipt: order.captured_paise > 0 ? { reference: order.id, paymentId: order.payment_id, merchant: "Vanshul Goyal", amountPaise: order.captured_paise, currency: "INR", isTaxInvoice: false } : null,
    checkout: order.state === "created" && order.provider_order_id && order.account_id === config.accountId && order.key_id === config.keyId
      && policy?.hash === order.terms_hash ? {
        key: config.keyId, order_id: order.provider_order_id, amount: order.amount_paise, currency: order.currency,
        name: "Vanshul Goyal", description: "AdBrain annual service", retry: { enabled: false },
      } : null,
  };
}

function paymentService(config: Config, signal: AbortSignal) {
  const database = createAdminClient();
  const provider = createProductionPaymentClient(process.env, signal);
  const scope = { p_account_id: config.accountId, p_key_id: config.keyId };
  async function recovery(orderId: string) {
    const result = await stored(database.rpc("production_payment_recovery", { ...scope, p_order_id: orderId }), recoverySchema.nullable());
    if (!result) throw new CheckoutRequestError(404, "Payment reference not found for this merchant configuration.");
    return result;
  }
  async function observe(paymentId: string, expected?: SavedOrder, refundId?: string | null, forceReview = false) {
    const payment = await provider.fetchPayment(paymentId);
    const remoteOrder = await provider.fetchOrder(payment.order_id);
    const localId = z.uuid().safeParse(remoteOrder.receipt);
    if (!localId.success) throw new CheckoutRequestError(409, "Unmatched payment requires operator reconciliation.");
    let { order, refunds, refundIds } = await recovery(localId.data);
    if (expected && (expected.id !== order.id || expected.provider_order_id !== payment.order_id)) {
      throw new CheckoutRequestError(409, "Payment does not match the stored checkout.");
    }
    if (order.provider_order_id && order.provider_order_id !== payment.order_id) {
      throw new CheckoutRequestError(409, "Provider order conflicts with the saved payment reference.");
    }
    if (!order.provider_order_id) {
      order = await stored(database.rpc("production_payment_order_result", { ...scope, p_order_id: order.id, p_provider_order_id: payment.order_id }), orderSchema);
    }
    const refund = refundId ? await provider.fetchRefund(paymentId, refundId) : null;
    const amountMatches = payment.amount === order.amount_paise && payment.currency === order.currency
      && remoteOrder.amount === order.amount_paise && remoteOrder.currency === order.currency;
    const refundMatches = payment.amount_refunded === 0 ? payment.refund_status === null && payment.status !== "refunded"
      : payment.refund_status === (payment.amount_refunded === payment.amount ? "full" : "partial");
    const capture = amountMatches && refundMatches && remoteOrder.status === "paid" && remoteOrder.amount_paid === order.amount_paise && remoteOrder.amount_due === 0
      && (capturedPaymentMatchesOrder(payment, { providerOrderId: order.provider_order_id, totalPaise: order.amount_paise, currency: order.currency })
        || (payment.captured && payment.amount_refunded > 0 && ["captured", "refunded"].includes(payment.status)));
    const pending = amountMatches && refundMatches && !payment.captured && payment.amount_refunded === 0
      && ["created", "authorized", "failed"].includes(payment.status) && remoteOrder.status !== "paid" && remoteOrder.amount_paid === 0;
    const snapshotHash = createHash("sha256").update(JSON.stringify({ payment, order: remoteOrder, refund })).digest("hex");
    order = await stored(database.rpc("production_payment_observe", {
      ...scope, p_order_id: order.id, p_payment_id: payment.id, p_capture_verified: capture,
      p_provider_refunded_paise: payment.amount_refunded, p_review_required: forceReview || (!capture && !pending) || Boolean(refund && !capture), p_snapshot_hash: snapshotHash,
      p_refund_id: refund?.id ?? null, p_refund_amount_paise: refund?.amount ?? null, p_refund_status: refund?.status ?? null,
    }), orderSchema);
    if (refund) {
      const operation = refunds.find(item => item.provider_refund_id === refund.id || item.id === refund.receipt);
      if (operation) {
        await stored(database.rpc("production_payment_refund_result", { ...scope, p_refund_id: operation.id, p_provider_refund_id: refund.id }), refundOperationSchema);
        await stored(database.rpc("production_payment_refund_observed", { p_refund_id: operation.id, p_account_id: config.accountId,
          p_provider_refund_id: refund.id, p_amount_paise: refund.amount, p_status: refund.status }), z.unknown());
        ({ order, refunds, refundIds } = await recovery(order.id));
      }
    }
    return { order, refunds, refundIds };
  }
  async function processEvent(event: z.infer<typeof eventSchema>) {
    if (event.account_id !== config.accountId || event.key_id !== config.keyId) throw new CheckoutRequestError(409, "Webhook identity changed.");
    const result = await observe(event.payment_id, undefined, event.refund_id, event.kind === "dispute" || event.conflicted);
    if (!event.conflicted) await stored(database.rpc("production_payment_event_processed", {
      p_account_id: config.accountId, p_event_id: event.event_id, p_payload_hash: event.payload_hash,
    }), z.unknown());
    return result;
  }
  async function reconcile(orderId: string, suppliedRefundId?: string) {
    let result = await recovery(orderId);
    if (!result.order.provider_order_id) {
      const found = await provider.findOrder(orderId);
      if (!found) throw new CheckoutRequestError(409, "Order creation remains unconfirmed. Do not create another order.");
      if (found.amount !== result.order.amount_paise || found.currency !== result.order.currency) {
        result.order = await stored(database.rpc("production_payment_order_review", { ...scope, p_order_id: orderId }), orderSchema);
        return result;
      }
      result.order = await stored(database.rpc("production_payment_order_result", { ...scope, p_order_id: orderId, p_provider_order_id: found.id }), orderSchema);
    }
    const payments = await provider.fetchOrderPayments(result.order.provider_order_id!);
    const captured = payments.filter(payment => payment.captured || payment.status === "refunded");
    const candidates = captured.length ? captured.slice(0, 2) : payments.slice(0, 1);
    if (!candidates.length) {
      const remote = await provider.fetchOrder(result.order.provider_order_id!);
      if (remote.status === "paid" || remote.amount !== result.order.amount_paise || remote.currency !== result.order.currency) {
        result.order = await stored(database.rpc("production_payment_order_review", { ...scope, p_order_id: orderId }), orderSchema);
        return result;
      }
    }
    for (const payment of candidates) result = await observe(payment.id, result.order, suppliedRefundId, captured.length > 1);
    if (result.order.payment_id) {
      const refunds = await provider.fetchRefunds(result.order.payment_id);
      const unresolved = result.refunds.find(refund => !["processed", "failed"].includes(refund.state));
      const match = unresolved ? refunds.items.find(refund => refund.id === unresolved.provider_refund_id || refund.receipt === unresolved.id)
        : refunds.items.find(refund => refund.status !== "failed" && !result.refundIds.includes(refund.id));
      if (match) result = await observe(result.order.payment_id, result.order, match.id);
    }
    const pending = await stored(database.rpc("production_payment_events_pending", { ...scope, p_order_id: orderId }), z.array(eventSchema).max(25));
    if (pending[0]) result = await processEvent(pending[0]);
    return result;
  }
  return { database, scope, recovery, observe, processEvent, reconcile };
}

export async function handleProductionPayments(request: Request, action: Action) {
  try {
    const config = getProductionPaymentConfig();
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(60_000)]);
    const service = paymentService(config, signal);
    const { database, scope } = service;
    if (action === "webhook") {
      const raw = await readPaymentBody(request, 65_536);
      if (!verifyRazorpayWebhookSignature({ rawBody: raw, signature: request.headers.get("x-razorpay-signature") ?? "", webhookSecret: config.webhookSecret })) {
        throw new CheckoutRequestError(400, "Invalid webhook signature.");
      }
      let input: unknown;
      try { input = JSON.parse(raw.toString("utf8")); }
      catch { throw new CheckoutRequestError(400, "Invalid webhook JSON."); }
      const event = parsed(z.object({ account_id: z.literal(config.accountId), environment: z.literal("live").optional(), event: z.string().max(100), payload: z.unknown() }), input);
      const kind = event.event.startsWith("payment.dispute.") ? "dispute" : event.event.startsWith("refund.") ? "refund"
        : ["payment.captured", "order.paid"].includes(event.event) ? "capture" : ["payment.authorized", "payment.failed"].includes(event.event) ? "pending" : null;
      if (!kind) return paymentReply({ received: true, ignored: true });
      const payload = parsed(z.object({
        payment: z.object({ entity: z.object({ id: identifier("pay"), order_id: identifier("order").nullable().optional() }) }).optional(),
        refund: z.object({ entity: z.object({ id: identifier("rfnd"), payment_id: identifier("pay") }) }).optional(),
        dispute: z.object({ entity: z.object({ payment_id: identifier("pay") }) }).optional(),
      }), event.payload);
      const paymentId = parsed(identifier("pay"), payload.payment?.entity.id ?? payload.refund?.entity.payment_id ?? payload.dispute?.entity.payment_id);
      if ((kind === "refund" && !payload.refund) || (kind === "dispute" && !payload.dispute)
        || (payload.refund && payload.refund.entity.payment_id !== paymentId) || (payload.dispute && payload.dispute.entity.payment_id !== paymentId)) {
        throw new CheckoutRequestError(400, "Webhook payment references conflict.");
      }
      const saved = await stored(database.rpc("production_payment_event_receive", { ...scope, p_webhook_id: config.webhookId,
        p_event_id: parsed(eventIdSchema, request.headers.get("x-razorpay-event-id")), p_payload_hash: createHash("sha256").update(raw).digest("hex"),
        p_payment_id: paymentId, p_provider_order_id: payload.payment?.entity.order_id ?? null, p_refund_id: payload.refund?.entity.id ?? null, p_kind: kind,
      }), eventSchema);
      try { await service.processEvent(saved); return paymentReply({ received: true, queued: false }); }
      catch { return paymentReply({ received: true, queued: true }, 202); }
    }
    if (request.method !== "GET" && (new URL(request.url).origin !== config.origin || request.headers.get("origin") !== config.origin)) {
      throw new CheckoutRequestError(403, "A same-origin request is required.");
    }
    const { data: { user } } = await (await createClient()).auth.getUser();
    if (!user) throw new CheckoutRequestError(401, "Sign in required.");
    const limited = await rateLimitResponse(`live-payments:${action}:${user.id}`, { limit: action === "create" || action === "operator" ? 10 : 30, windowMs: 300_000 });
    if (limited) return limited;
    if (action === "read" || action === "create") {
      const body = action === "read" ? { businessId: new URL(request.url).searchParams.get("businessId") } : await paymentJsonBody(request);
      const input = parsed(action === "read" ? z.strictObject({ businessId: z.uuid() }) : z.strictObject({
        businessId: z.uuid(), idempotencyKey: z.uuid(), termsHash: hashSchema, acceptTerms: z.literal(true),
      }), body);
      const context = await requireOwnedBusiness(input.businessId);
      if (context.userId !== user.id) throw new CheckoutRequestError(401, "Session changed.");
      if (action === "read") {
        const orders = await stored(database.rpc("production_payment_orders_list", { p_business_id: input.businessId, p_user_id: user.id }), z.array(orderSchema).max(20));
        return paymentReply({ quote: createAnnualPaymentQuote(), policy: currentPolicy(), orders: orders.map(order => orderResponse(order, config)) });
      }
      const create = parsed(z.strictObject({ businessId: z.uuid(), idempotencyKey: z.uuid(), termsHash: hashSchema, acceptTerms: z.literal(true) }), body);
      const { hash, ...policy } = getProductionCollectionPolicy();
      if (hash !== create.termsHash) throw new CheckoutRequestError(409, "Payment terms changed. Review the current terms before payment.");
      const funding = await stored(database.rpc("meta_funding_latest_record", { p_business_id: input.businessId, p_environment: "live" }), z.object({ evidenceId: z.uuid() }));
      const claimed = await stored(database.rpc("production_payment_order_claim", { ...scope, p_business_id: input.businessId, p_user_id: user.id,
        p_request_key: create.idempotencyKey, p_order_id: randomUUID(), p_quote: createAnnualPaymentQuote(), p_terms: JSON.stringify(policy), p_terms_hash: hash, p_funding_evidence_id: funding.evidenceId,
      }), z.object({ claimed: z.boolean(), order: orderSchema }));
      if (!claimed.claimed) return paymentReply(orderResponse(claimed.order, config));
      try {
        const remote = await createProductionPaymentClient(process.env, signal).createOrder(claimed.order.id, hash);
        const saved = await stored(database.rpc("production_payment_order_result", { ...scope, p_order_id: claimed.order.id, p_provider_order_id: remote.id }), orderSchema);
        return paymentReply(orderResponse(saved, config), 201);
      } catch {
        await stored(database.rpc("production_payment_order_result", { ...scope, p_order_id: claimed.order.id, p_provider_order_id: null }), orderSchema).catch(() => undefined);
        return paymentReply({ orderId: claimed.order.id, status: "needs_reconciliation", error: "Creation is unconfirmed. Recover this reference; do not create another payment.", spendablePaise: 0, canActivateCampaign: false }, 503);
      }
    }
    if (action === "operator") {
      const allowed = await stored(database.rpc("production_payment_operator_allowed", { p_user_id: user.id }), z.boolean());
      if (!allowed) throw new CheckoutRequestError(403, "Approved payment operator required.");
      if (request.method === "GET") {
        const after = parsed(eventIdSchema.nullable(), new URL(request.url).searchParams.get("after"));
        const events = await stored(database.rpc("production_payment_events_pending", { ...scope, p_after_event_id: after }), z.array(eventSchema).max(25));
        return paymentReply({ events, next: events.length === 25 ? events.at(-1)!.event_id : null });
      }
      const input = parsed(z.discriminatedUnion("action", [
        z.strictObject({ action: z.literal("reconcile"), orderId: z.uuid(), refundId: identifier("rfnd").optional() }),
        z.strictObject({ action: z.literal("event"), eventId: eventIdSchema }),
        z.strictObject({ action: z.literal("refund"), orderId: z.uuid(), idempotencyKey: z.uuid(), approvalReference: z.uuid(),
          termsHash: hashSchema, reason: z.string().trim().min(1).max(1000), amountPaise: z.number().int().min(100).max(1_000_000) }),
      ]), await paymentJsonBody(request));
      if (input.action === "event") {
        const event = await stored(database.rpc("production_payment_event_get", { ...scope, p_event_id: input.eventId }), eventSchema.nullable());
        if (!event) throw new CheckoutRequestError(404, "Pending event not found.");
        return paymentReply({ order: orderResponse((await service.processEvent(event)).order, config) });
      }
      const recovered = await service.reconcile(input.orderId, input.action === "reconcile" ? input.refundId : undefined);
      if (input.action === "reconcile") return paymentReply({ order: orderResponse(recovered.order, config), refunds: recovered.refunds });
      if (process.env.PAYMENTS_LIVE_REFUNDS_ENABLED !== "true") throw new CheckoutRequestError(409, "New refunds are disabled; reconciliation remains available.");
      const claimed = await stored(database.rpc("production_payment_refund_claim", { ...scope, p_order_id: input.orderId, p_actor_id: user.id,
        p_request_key: input.idempotencyKey, p_refund_id: randomUUID(), p_amount_paise: input.amountPaise, p_terms_hash: input.termsHash,
        p_approval_reference: input.approvalReference, p_reason: input.reason,
      }), z.object({ claimed: z.boolean(), refund: refundOperationSchema }));
      if (!claimed.claimed) return paymentReply({ refund: claimed.refund });
      try {
        const refund = await createProductionPaymentClient(process.env, signal).createRefund(recovered.order.payment_id!, claimed.refund.id, claimed.refund.amount_paise);
        await stored(database.rpc("production_payment_refund_result", { ...scope, p_refund_id: claimed.refund.id, p_provider_refund_id: refund.id }), refundOperationSchema);
        const result = await service.observe(recovered.order.payment_id!, recovered.order, refund.id);
        return paymentReply({ order: orderResponse(result.order, config), refunds: result.refunds }, 201);
      } catch {
        await stored(database.rpc("production_payment_refund_result", { ...scope, p_refund_id: claimed.refund.id, p_provider_refund_id: null }), refundOperationSchema).catch(() => undefined);
        return paymentReply({ refundId: claimed.refund.id, status: "needs_reconciliation", error: "Refund result is unconfirmed. Keep this reference; do not resubmit." }, 503);
      }
    }
    const input = parsed(action === "verify" ? z.strictObject({ orderId: z.uuid(), paymentId: identifier("pay"), providerOrderId: identifier("order"), signature: hashSchema })
      : z.strictObject({ orderId: z.uuid() }), await paymentJsonBody(request));
    const saved = await stored(database.rpc("production_payment_order_get", { p_order_id: input.orderId, p_user_id: user.id }), orderSchema.nullable());
    if (!saved) throw new CheckoutRequestError(404, "Payment reference not found.");
    if (saved.account_id !== config.accountId || saved.key_id !== config.keyId) throw new CheckoutRequestError(409, "Merchant identity changed; operator reconciliation is required.");
    if (action === "verify") {
      const callback = parsed(z.strictObject({ orderId: z.uuid(), paymentId: identifier("pay"), providerOrderId: identifier("order"), signature: hashSchema }), input);
      if (saved.provider_order_id !== callback.providerOrderId || !verifyRazorpayCheckoutSignature({ storedOrderId: saved.provider_order_id,
        paymentId: callback.paymentId, signature: callback.signature, keySecret: config.keySecret })) throw new CheckoutRequestError(400, "Invalid checkout signature.");
      return paymentReply(orderResponse((await service.observe(callback.paymentId, saved)).order, config));
    }
    return paymentReply(orderResponse((await service.reconcile(saved.id)).order, config));
  } catch (error) {
    if (error instanceof CheckoutRequestError) return paymentReply({ error: error.message }, error.status);
    if (error instanceof ConnectionAccessError) return paymentReply({ error: "Business access could not be verified." }, error.code === "UNAUTHENTICATED" ? 401 : error.code === "UNAVAILABLE" ? 503 : 403);
    if (error instanceof ProductionPaymentError) return paymentReply({ error: error.message }, error.code === "DISABLED" ? 404 : error.code === "COLLECTION_BLOCKED" ? 409 : 503);
    return paymentReply({ error: "Payment state is unavailable. Preserve the original reference for recovery." }, 503);
  }
}