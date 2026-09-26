import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { rateLimitResponse } from "@/lib/security/rate-limit";
import { createRazorpayTestClient, getRazorpayTestConfig, TestPaymentError, TEST_PAYMENT_AMOUNT_PAISE } from "./razorpay-test";
import { capturedPaymentMatchesOrder, verifyRazorpayCheckoutSignature, verifyRazorpayWebhookSignature } from "./razorpay-verification";

const savedOrderSchema = z.object({
  id: z.uuid(), business_id: z.uuid(), user_id: z.uuid(), account_id: z.string(), key_id: z.string(),
  environment: z.literal("test"), amount_paise: z.literal(TEST_PAYMENT_AMOUNT_PAISE), currency: z.literal("INR"),
  state: z.enum(["creating", "created", "captured", "needs_reconciliation"]),
  provider_order_id: z.string().regex(/^order_[A-Za-z0-9]{1,100}$/).nullable(),
  payment_id: z.string().regex(/^pay_[A-Za-z0-9]{1,100}$/).nullable(),
});
type SavedOrder = z.infer<typeof savedOrderSchema>;
type TestConfig = ReturnType<typeof getRazorpayTestConfig>;

class CheckoutRequestError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

function reply(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

function orderResponse(order: SavedOrder, config: TestConfig) {
  return {
    orderId: order.id, environment: "test", status: order.state, amountPaise: order.amount_paise,
    currency: order.currency, canActivateCampaign: false, spendablePaise: 0,
    checkout: order.state === "created" && order.provider_order_id ? {
      key: config.keyId, order_id: order.provider_order_id, amount: order.amount_paise, currency: order.currency,
      name: "Vanshul Goyal", description: "AdBrain test payment only. No advertising or service is purchased.",
    } : null,
  };
}

async function persistedOrder(request: PromiseLike<{ data: unknown; error: unknown }>): Promise<SavedOrder> {
  const { data, error } = await request;
  const parsed = savedOrderSchema.safeParse(data);
  if (error || !parsed.success) throw new CheckoutRequestError(503, "Test payment storage is unavailable. Check the local migration before retrying.");
  return parsed.data;
}

async function readBody(request: Request, maximum = 4096): Promise<Buffer> {
  if (Number(request.headers.get("content-length")) > maximum) throw new CheckoutRequestError(413, "Request body is too large.");
  const reader = request.body?.getReader();
  if (!reader) throw new CheckoutRequestError(400, "Request body is required.");
  const chunks: Uint8Array[] = [];
  let length = 0;
  let expired = false;
  const timer = setTimeout(() => { expired = true; void reader.cancel().catch(() => undefined); }, 5000);
  try {
    for (;;) {
      const next = await reader.read();
      if (expired) throw new CheckoutRequestError(408, "Request body timed out.");
      if (next.done) return Buffer.concat(chunks);
      length += next.value.byteLength;
      if (length > maximum) throw new CheckoutRequestError(413, "Request body is too large.");
      chunks.push(next.value);
    }
  } finally {
    clearTimeout(timer);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

async function jsonBody(request: Request): Promise<unknown> {
  try { return JSON.parse((await readBody(request)).toString("utf8")); }
  catch (error) {
    if (error instanceof CheckoutRequestError) throw error;
    throw new CheckoutRequestError(400, "Invalid JSON request.");
  }
}

async function verifyProviderPayment(input: {
  config: TestConfig; paymentId: string; expectedOrder?: SavedOrder; eventId?: string; payloadHash?: string;
}) {
  const provider = createRazorpayTestClient();
  const payment = await provider.fetchPayment(input.paymentId);
  const database = createAdminClient();
  const saved = input.expectedOrder ?? await persistedOrder(database.rpc("razorpay_test_order_find", {
    p_provider_order_id: payment.order_id, p_account_id: input.config.accountId, p_key_id: input.config.keyId,
  }));
  if (saved.account_id !== input.config.accountId || saved.key_id !== input.config.keyId || saved.provider_order_id !== payment.order_id) {
    throw new CheckoutRequestError(409, "Test payment does not match this stored order.");
  }
  const order = await provider.fetchOrder(payment.order_id);
  const matches = order.receipt === saved.id && order.amount === saved.amount_paise && payment.amount === saved.amount_paise;
  const captured = matches && capturedPaymentMatchesOrder(payment, { providerOrderId: saved.provider_order_id, totalPaise: saved.amount_paise, currency: saved.currency })
    && order.status === "paid" && order.amount_paid === saved.amount_paise && order.amount_due === 0;
  const pending = matches && ["created", "authorized", "failed"].includes(payment.status) && !payment.captured
    && payment.amount_refunded === 0 && payment.refund_status === null && order.status !== "paid";
  const snapshotHash = createHash("sha256").update(JSON.stringify({ payment, order })).digest("hex");
  return persistedOrder(database.rpc("razorpay_test_order_observe", {
    p_order_id: saved.id, p_account_id: input.config.accountId, p_key_id: input.config.keyId,
    p_payment_id: payment.id, p_event_id: input.eventId ?? `verify:${snapshotHash}`,
    p_payload_hash: input.payloadHash ?? snapshotHash,
    p_outcome: captured ? "captured" : pending ? "pending" : "needs_reconciliation",
  }));
}

export async function handleTestPayments(request: Request, action: "create" | "read" | "verify" | "webhook") {
  try {
    const config = getRazorpayTestConfig();
    if (action === "webhook") {
      const rawBody = await readBody(request, 65_536);
      if (!verifyRazorpayWebhookSignature({ rawBody, signature: request.headers.get("x-razorpay-signature") ?? "", webhookSecret: config.webhookSecret })) {
        throw new CheckoutRequestError(400, "Invalid webhook signature.");
      }
      let body: unknown;
      try { body = JSON.parse(rawBody.toString("utf8")); }
      catch { throw new CheckoutRequestError(400, "Invalid webhook JSON."); }
      const event = z.object({ account_id: z.literal(config.accountId), event: z.string(), payload: z.unknown() })
        .safeParse(body);
      if (!event.success) throw new CheckoutRequestError(400, "Webhook account or payload is invalid.");
      if (!["payment.captured", "payment.authorized", "payment.failed", "refund.processed", "order.paid"].includes(event.data.event)) {
        return reply({ received: true, ignored: true, environment: "test" });
      }
      const eventId = z.string().regex(/^[A-Za-z0-9_:.-]{1,128}$/).safeParse(request.headers.get("x-razorpay-event-id"));
      const payload = z.object({
        payment: z.object({ entity: z.object({ id: z.string().regex(/^pay_[A-Za-z0-9]{1,100}$/) }) }).optional(),
        refund: z.object({ entity: z.object({ payment_id: z.string().regex(/^pay_[A-Za-z0-9]{1,100}$/) }) }).optional(),
      }).safeParse(event.data.payload);
      const paymentId = payload.success ? payload.data.payment?.entity.id ?? payload.data.refund?.entity.payment_id : undefined;
      if (!eventId.success || !paymentId) throw new CheckoutRequestError(400, "A payment and event reference are required.");
      await verifyProviderPayment({ config, paymentId, eventId: `webhook:${eventId.data}`, payloadHash: createHash("sha256").update(rawBody).digest("hex") });
      return reply({ received: true, environment: "test" });
    }

    if (action !== "read" && request.headers.get("origin") !== new URL(request.url).origin) {
      throw new CheckoutRequestError(403, "A same-origin request is required.");
    }
    const { data: { user } } = await (await createClient()).auth.getUser();
    if (!user) throw new CheckoutRequestError(401, "Sign in required.");
    const limited = await rateLimitResponse(`test-payments:${action}:${user.id}`, { limit: action === "create" ? 10 : 60, windowMs: 300_000 });
    if (limited) return limited;
    const database = createAdminClient();

    if (action === "create") {
      const parsed = z.strictObject({ businessId: z.uuid(), idempotencyKey: z.uuid() }).safeParse(await jsonBody(request));
      if (!parsed.success) throw new CheckoutRequestError(400, "Business and idempotency key are required; amounts cannot be supplied by the browser.");
      const { data, error } = await database.rpc("razorpay_test_order_claim", {
        p_business_id: parsed.data.businessId, p_user_id: user.id, p_request_key: parsed.data.idempotencyKey,
        p_order_id: randomUUID(), p_account_id: config.accountId, p_key_id: config.keyId,
      });
      const claim = z.object({ claimed: z.boolean(), order: savedOrderSchema }).safeParse(data);
      if (error || !claim.success) throw new CheckoutRequestError(503, "Test order ownership or storage could not be verified. No provider order was requested.");
      if (!claim.data.claimed) return reply(orderResponse(claim.data.order, config));
      try {
        const order = await createRazorpayTestClient().createOrder(claim.data.order.id);
        const saved = await persistedOrder(database.rpc("razorpay_test_order_result", { p_order_id: claim.data.order.id, p_provider_order_id: order.id }));
        return reply(orderResponse(saved, config), 201);
      } catch {
        await Promise.resolve(database.rpc("razorpay_test_order_result", { p_order_id: claim.data.order.id, p_provider_order_id: null })).catch(() => undefined);
        return reply({ orderId: claim.data.order.id, status: "needs_reconciliation", environment: "test", canActivateCampaign: false, spendablePaise: 0,
          error: "Order creation is unconfirmed. Query this order or reuse the original idempotency key; do not create a new request to recover it." }, 503);
      }
    }

    const input = action === "read" ? { orderId: new URL(request.url).searchParams.get("orderId") } : await jsonBody(request);
    const parsed = z.strictObject({
      orderId: z.uuid(), paymentId: z.string().regex(/^pay_[A-Za-z0-9]{1,100}$/).optional(), signature: z.string().regex(/^[a-fA-F0-9]{64}$/).optional(),
      providerOrderId: z.string().regex(/^order_[A-Za-z0-9]{1,100}$/).optional(),
    }).safeParse(input);
    if (!parsed.success) throw new CheckoutRequestError(400, "Invalid test order request.");
    const { data, error } = await database.rpc("razorpay_test_order_get", { p_order_id: parsed.data.orderId, p_user_id: user.id });
    if (error) throw new CheckoutRequestError(503, "Test order storage is unavailable.");
    if (!data) throw new CheckoutRequestError(404, "Test order not found.");
    const saved = savedOrderSchema.parse(data);
    if (saved.account_id !== config.accountId || saved.key_id !== config.keyId) throw new CheckoutRequestError(409, "Test merchant configuration changed. Reconcile the existing order.");
    if (action === "read") return reply(orderResponse(saved, config));
    if (parsed.data.providerOrderId && parsed.data.providerOrderId !== saved.provider_order_id) {
      throw new CheckoutRequestError(400, "Checkout order does not match the stored order.");
    }
    if (!parsed.data.paymentId || !parsed.data.signature || !saved.provider_order_id || !verifyRazorpayCheckoutSignature({
      storedOrderId: saved.provider_order_id, paymentId: parsed.data.paymentId, signature: parsed.data.signature, keySecret: config.keySecret,
    })) throw new CheckoutRequestError(400, "Invalid checkout signature.");
    return reply(orderResponse(await verifyProviderPayment({ config, paymentId: parsed.data.paymentId, expectedOrder: saved }), config));
  } catch (error) {
    if (error instanceof CheckoutRequestError) return reply({ error: error.message }, error.status);
    if (error instanceof TestPaymentError && error.code === "DISABLED") return reply({ error: "Test payments are disabled." }, 404);
    return reply({ error: "Test payment verification is unavailable. No advertising funds were credited." }, 503);
  }
}