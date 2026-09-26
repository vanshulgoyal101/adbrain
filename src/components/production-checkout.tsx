"use client";

import Script from "next/script";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { CreditCard, ReceiptText, RefreshCw } from "lucide-react";
import { z } from "zod";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { TestCheckoutOptions } from "@/components/test-checkout";

const identifier = (prefix: string) => z.string().regex(new RegExp(`^${prefix}_[A-Za-z0-9]{1,100}$`));
const policySchema = z.object({ hash: z.string().regex(/^[a-f0-9]{64}$/), serviceScope: z.string(), invoiceTerms: z.string(), refundTerms: z.string() });
const orderSchema = z.object({
  orderId: z.uuid(), environment: z.literal("live"), amountPaise: z.literal(1_000_000), currency: z.literal("INR"),
  status: z.enum(["creating", "created", "captured", "needs_reconciliation", "review_required", "refund_pending", "partially_refunded", "refunded"]),
  capturedPaise: z.number().int().min(0).max(1_000_000), refundedPaise: z.number().int().min(0).max(1_000_000),
  refundReconciliationPending: z.boolean(), spendablePaise: z.literal(0), canActivateCampaign: z.literal(false),
  receipt: z.object({ reference: z.uuid(), paymentId: identifier("pay").nullable(), merchant: z.literal("Vanshul Goyal"),
    amountPaise: z.number().int().min(0).max(1_000_000), currency: z.literal("INR"), isTaxInvoice: z.literal(false) }).nullable(),
  checkout: z.object({ key: z.string().regex(/^rzp_live_[A-Za-z0-9]{1,100}$/), order_id: identifier("order"), amount: z.literal(1_000_000),
    currency: z.literal("INR"), name: z.literal("Vanshul Goyal"), description: z.string() }).nullable(),
});
type Order = z.infer<typeof orderSchema>;
const statusLabels: Record<Order["status"], string> = {
  creating: "Payment preparation pending", created: "Awaiting payment", captured: "Payment confirmed", needs_reconciliation: "Confirmation pending",
  review_required: "Review required", refund_pending: "Refund pending", partially_refunded: "Partially refunded", refunded: "Refunded",
};
const money = (paise: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(paise / 100);

export function ProductionCheckout({ businessId }: { businessId: string }) {
  const [order, setOrder] = useState<Order | null>(null);
  const [policy, setPolicy] = useState<z.infer<typeof policySchema> | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [working, setWorking] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [scriptReady, setScriptReady] = useState(false);
  const [scriptFailed, setScriptFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const active = useRef(false);
  const busy = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const checkout = useRef<InstanceType<NonNullable<Window["Razorpay"]>> | null>(null);
  const storageKey = `adbrain:live-checkout:${businessId}`;

  async function api(path: string, signal: AbortSignal, body?: unknown): Promise<unknown> {
    const response = await fetch(`/api/payments/live/${path}`, { method: body ? "POST" : "GET", cache: "no-store", credentials: "same-origin",
      signal: AbortSignal.any([signal, AbortSignal.timeout(75_000)]),
      ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
    });
    const data: unknown = await response.json();
    signal.throwIfAborted();
    if (!response.ok) {
      const message = z.object({ error: z.string().max(500) }).safeParse(data);
      throw new Error(message.success ? message.data.error : "Payment status is unavailable. Keep the existing reference.");
    }
    return data;
  }

  async function perform(operation: (signal: AbortSignal) => Promise<void>) {
    if (!active.current || busy.current) return;
    busy.current = true; setWorking(true); setError(null);
    const pending = new AbortController();
    controller.current = pending;
    try { await operation(pending.signal); }
    catch (failure) {
      if (active.current && !pending.signal.aborted) setError(failure instanceof Error ? failure.message : "Payment is unconfirmed. Check the existing reference.");
    } finally {
      if (controller.current === pending) { busy.current = false; if (active.current) setWorking(false); }
    }
  }

  async function load(signal: AbortSignal) {
    const result = z.object({ policy: policySchema.nullable(), orders: z.array(orderSchema).max(20) })
      .parse(await api(`orders?businessId=${encodeURIComponent(businessId)}`, signal));
    setPolicy(result.policy); setOrder(result.orders[0] ?? null); setLoaded(true);
  }
  const restore = useEffectEvent(() => perform(load));
  useEffect(() => {
    active.current = true;
    let disposed = false;
    queueMicrotask(() => { if (!disposed) void restore(); });
    return () => { disposed = true; active.current = false; controller.current?.abort(); busy.current = false; checkout.current?.close(); checkout.current = null; };
  }, [businessId]);
  useEffect(() => {
    if (!policy || scriptReady) return;
    const timer = setTimeout(() => setScriptFailed(true), 15_000);
    return () => clearTimeout(timer);
  }, [policy, scriptReady]);

  async function checkStatus() {
    await perform(async signal => {
      if (order) setOrder(orderSchema.parse(await api("reconcile", signal, { orderId: order.orderId })));
      else await load(signal);
      setNotice(null);
    });
  }

  async function pay() {
    if (!policy || !accepted || !scriptReady || !window.Razorpay || checkoutOpen) return;
    await perform(async signal => {
      let ready = order;
      if (!ready) {
        const raw = sessionStorage.getItem(storageKey);
        const idempotencyKey = raw ? z.uuid().parse(raw) : crypto.randomUUID();
        sessionStorage.setItem(storageKey, idempotencyKey);
        ready = orderSchema.parse(await api("orders", signal, { businessId, idempotencyKey, termsHash: policy.hash, acceptTerms: true }));
        setOrder(ready);
      } else {
        const refreshed = z.object({ policy: policySchema.nullable(), orders: z.array(orderSchema).max(20) })
          .parse(await api(`orders?businessId=${encodeURIComponent(businessId)}`, signal));
        setPolicy(refreshed.policy);
        ready = refreshed.orders.find(candidate => candidate.orderId === ready!.orderId) ?? null;
        if (!ready) throw new Error("Saved payment could not be found. Do not start another payment.");
        setOrder(ready);
        if (!refreshed.policy || refreshed.policy.hash !== policy.hash) {
          setAccepted(false);
          throw new Error("Payment terms changed. Review the current terms before continuing.");
        }
      }
      if (!ready.checkout || ready.status !== "created") return;
      const launched = ready;
      let callbackReceived = false;
      const options: TestCheckoutOptions = {
        ...ready.checkout, retry: { enabled: false }, theme: { color: "#2563eb" },
        config: { display: { blocks: { test_methods: { name: "Payment methods", instruments: [{ method: "card" }, { method: "netbanking" }, { method: "upi" }] } },
          sequence: ["block.test_methods"], preferences: { show_default_blocks: false } } },
        handler(value) {
          if (!active.current || callbackReceived || checkout.current !== instance) return;
          callbackReceived = true; setCheckoutOpen(false);
          const proof = z.object({ razorpay_order_id: z.literal(launched.checkout!.order_id), razorpay_payment_id: identifier("pay"),
            razorpay_signature: z.string().regex(/^[a-f0-9]{64}$/) }).safeParse(value);
          if (!proof.success) { setError("Checkout returned inconsistent payment details. Check the saved reference."); return; }
          busy.current = false;
          void perform(async verificationSignal => {
            setOrder(orderSchema.parse(await api("verify", verificationSignal, { orderId: launched.orderId, paymentId: proof.data.razorpay_payment_id,
              providerOrderId: proof.data.razorpay_order_id, signature: proof.data.razorpay_signature })));
            setNotice(null);
          });
        },
        modal: { confirm_close: true, ondismiss() {
          if (!active.current || callbackReceived || checkout.current !== instance) return;
          setCheckoutOpen(false); setNotice("Checkout closed. Payment status is unconfirmed.");
        } },
      };
      const instance = new window.Razorpay!(options);
      instance.on("payment.failed", () => {
        if (!active.current || callbackReceived || checkout.current !== instance) return;
        setNotice("A payment attempt failed. The saved order still requires confirmation.");
      });
      checkout.current = instance; setCheckoutOpen(true); instance.open();
    });
  }

  const canPay = loaded && policy && (!order || (order.status === "created" && order.checkout));
  return (
    <section aria-labelledby="production-checkout-title" className="min-w-0 space-y-4 border-t border-slate-200 pt-5">
      {policy && <Script id="razorpay-live-checkout" src="https://checkout.razorpay.com/v1/checkout.js" strategy="afterInteractive"
        onReady={() => { setScriptReady(Boolean(window.Razorpay)); setScriptFailed(!window.Razorpay); }} onError={() => setScriptFailed(true)} />}
      <h3 id="production-checkout-title" className="flex items-center gap-2 font-semibold text-slate-900"><CreditCard size={18} aria-hidden="true" />Annual service</h3>
      <dl className="grid gap-4 text-sm sm:grid-cols-3">
        <div><dt className="text-slate-500">Total</dt><dd className="mt-1 text-xl font-semibold tabular-nums">{money(1_000_000)}</dd></div>
        <div><dt className="text-slate-500">Service allocation</dt><dd className="mt-1 font-semibold tabular-nums">{money(200_000)}</dd></div>
        <div><dt className="text-slate-500">Meta costs, including applicable tax</dt><dd className="mt-1 font-semibold tabular-nums">{money(800_000)}</dd></div>
      </dl>
      <p className="text-sm text-slate-600">Merchant: Vanshul Goyal. Gateway fees absorbed by AdBrain. No automatic renewal.</p>
      <p role="status" aria-live="polite" className="min-h-6 text-sm font-medium text-slate-800">{working ? "Checking payment" : checkoutOpen ? "Checkout open"
        : order ? statusLabels[order.status] : loaded ? policy ? "Ready for payment" : "Collection is not enabled" : "Loading payment"}</p>
      {order && <p className="break-all text-xs text-slate-500">Payment reference: {order.orderId}</p>}
      {notice && <Alert>{notice}</Alert>}
      {error && <Alert variant="error">{error}</Alert>}
      {scriptFailed && <Alert variant="error">Checkout could not load. The saved payment is unchanged.</Alert>}
      {order?.refundReconciliationPending && <Alert>Refund evidence is awaiting reconciliation. Funds remain held.</Alert>}
      {order && order.refundedPaise > 0 && <p className="text-sm font-medium">Verified refunds: {money(order.refundedPaise)}</p>}
      {policy && <details className="border-y border-slate-200 py-3 text-sm">
        <summary className="cursor-pointer font-medium">Service, invoice and refund terms</summary>
        <dl className="mt-3 space-y-3 break-words">
          <div><dt className="font-medium">Service scope</dt><dd className="whitespace-pre-wrap text-slate-600">{policy.serviceScope}</dd></div>
          <div><dt className="font-medium">Invoice terms</dt><dd className="whitespace-pre-wrap text-slate-600">{policy.invoiceTerms}</dd></div>
          <div><dt className="font-medium">Refund terms</dt><dd className="whitespace-pre-wrap text-slate-600">{policy.refundTerms}</dd></div>
        </dl>
      </details>}
      {canPay && <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1 h-4 w-4 shrink-0" checked={accepted}
        onChange={event => setAccepted(event.target.checked)} disabled={working || checkoutOpen} />I accept the service, invoice and refund terms.</label>}
      <div className="flex flex-wrap gap-2">
        {canPay && <Button onClick={() => void pay()} disabled={!accepted || !scriptReady || scriptFailed || working || checkoutOpen} className="h-auto min-h-11 whitespace-normal">
          <CreditCard size={16} aria-hidden="true" />{order ? "Continue saved checkout" : "Pay INR 10,000"}</Button>}
        <Button variant="outline" onClick={() => void checkStatus()} disabled={working || checkoutOpen} className="h-auto min-h-11 whitespace-normal">
          <RefreshCw size={16} aria-hidden="true" />Check payment status</Button>
      </div>
      {order?.receipt && <details className="border-t border-slate-200 pt-3 text-sm">
        <summary className="cursor-pointer font-medium"><ReceiptText size={16} className="mr-2 inline" aria-hidden="true" />Payment receipt</summary>
        <dl className="mt-3 space-y-2">
          <div><dt className="text-slate-500">Merchant</dt><dd>{order.receipt.merchant}</dd></div>
          <div><dt className="text-slate-500">Captured amount</dt><dd>{money(order.receipt.amountPaise)}</dd></div>
          <div><dt className="text-slate-500">Payment ID</dt><dd className="break-all font-mono">{order.receipt.paymentId}</dd></div>
        </dl>
        <p className="mt-3 text-xs text-slate-500">This receipt is not a tax invoice. Payment confirmation does not authorize ad activation.</p>
      </details>}
    </section>
  );
}