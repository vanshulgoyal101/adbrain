"use client";

import Script from "next/script";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { CheckCircle2, CreditCard, RefreshCw, ShieldCheck } from "lucide-react";
import { z } from "zod";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

const paymentProofSchema = z.object({
  paymentId: z.string().regex(/^pay_[A-Za-z0-9]{1,100}$/), signature: z.string().regex(/^[a-fA-F0-9]{64}$/),
  providerOrderId: z.string().regex(/^order_[A-Za-z0-9]{1,100}$/).optional(),
});
const recoverySchema = z.strictObject({
  version: z.literal(1), idempotencyKey: z.uuid(), orderId: z.uuid().nullable(), opened: z.boolean(),
  proof: paymentProofSchema.optional(),
});
const orderSchema = z.object({
  orderId: z.uuid(), environment: z.literal("test"), amountPaise: z.literal(1_000_000), currency: z.literal("INR"),
  status: z.enum(["creating", "created", "captured", "needs_reconciliation"]),
  canActivateCampaign: z.literal(false), spendablePaise: z.literal(0),
  checkout: z.object({
    key: z.string().regex(/^rzp_test_[A-Za-z0-9]{1,100}$/), order_id: z.string().regex(/^order_[A-Za-z0-9]{1,100}$/),
    amount: z.literal(1_000_000), currency: z.literal("INR"), name: z.string(), description: z.string(),
  }).nullable(),
});
type Recovery = z.infer<typeof recoverySchema>;
type Order = z.infer<typeof orderSchema>;
export type TestCheckoutOptions = NonNullable<Order["checkout"]> & {
  handler: (value: unknown) => void;
  modal: { ondismiss: () => void; confirm_close: boolean };
  retry: { enabled: boolean };
  theme: { color: string };
  config: { display: {
    blocks: { test_methods: { name: string; instruments: { method: "card" | "netbanking" | "upi" }[] } };
    sequence: string[]; preferences: { show_default_blocks: boolean };
  } };
};
type CheckoutInstance = { open: () => void; close: () => void; on: (event: "payment.failed", handler: () => void) => void };
declare global {
  interface Window { Razorpay?: new (options: TestCheckoutOptions) => CheckoutInstance }
}

type Phase = "loading" | "ready" | "creating" | "checkout" | "verifying" | "pending" | "captured" | "hold";

export function TestCheckout({ businessId }: { businessId: string }) {
  const storageKey = `adbrain:test-checkout:${businessId}`;
  const [phase, setPhase] = useState<Phase>("loading");
  const [recovery, setRecovery] = useState<Recovery | null>(null);
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scriptReady, setScriptReady] = useState(false);
  const [scriptFailed, setScriptFailed] = useState(false);
  const recoveryRef = useRef<Recovery | null>(null);
  const active = useRef(false);
  const busy = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const checkout = useRef<CheckoutInstance | null>(null);
  const payButton = useRef<HTMLButtonElement | null>(null);

  function persist(next: Recovery) {
    sessionStorage.setItem(storageKey, JSON.stringify(next));
    recoveryRef.current = next;
    setRecovery(next);
  }

  function acceptOrder(next: Order, snapshot: Recovery) {
    if (snapshot.orderId && snapshot.orderId !== next.orderId) throw new Error("Order mismatch");
    persist({ ...snapshot, orderId: next.orderId, ...(next.status === "captured" ? { proof: undefined } : {}) });
    setOrder(next);
    setPhase(next.status === "captured" ? "captured" : next.status === "needs_reconciliation" ? "hold"
      : next.status === "created" && !snapshot.opened && !snapshot.proof ? "ready" : "pending");
  }

  async function synchronize(snapshot: Recovery, signal: AbortSignal): Promise<Order> {
    const path = snapshot.orderId ? snapshot.proof ? "/api/payments/test/verify"
      : `/api/payments/test/orders?orderId=${encodeURIComponent(snapshot.orderId)}` : "/api/payments/test/orders";
    const body = snapshot.orderId ? snapshot.proof ? { orderId: snapshot.orderId, ...snapshot.proof } : undefined
      : { businessId, idempotencyKey: snapshot.idempotencyKey };
    const response = await fetch(path, {
      method: body ? "POST" : "GET", credentials: "same-origin", cache: "no-store",
      ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
      signal: AbortSignal.any([signal, AbortSignal.timeout(45_000)]),
    });
    const data: unknown = await response.json();
    signal.throwIfAborted();
    if (!response.ok) {
      const uncertain = z.object({ orderId: z.uuid(), status: z.literal("needs_reconciliation") }).safeParse(data);
      if (uncertain.success && !snapshot.orderId) persist({ ...snapshot, orderId: uncertain.data.orderId });
      throw new Error("Payment state unavailable");
    }
    const parsed = orderSchema.parse(data);
    acceptOrder(parsed, snapshot);
    return parsed;
  }

  async function checkStatus(snapshot = recoveryRef.current) {
    if (!snapshot || busy.current || !active.current) return;
    busy.current = true;
    setError(null);
    setPhase("verifying");
    const operation = new AbortController();
    controller.current = operation;
    try { await synchronize(snapshot, operation.signal); }
    catch {
      if (active.current && !operation.signal.aborted) {
        setPhase("pending");
        setError("Payment status is unconfirmed. Check this order again before making another payment.");
      }
    } finally {
      if (controller.current === operation) busy.current = false;
    }
  }

  const restore = useEffectEvent(async () => {
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (!raw) { setPhase("ready"); return; }
      const saved = recoverySchema.parse(JSON.parse(raw));
      recoveryRef.current = saved;
      setRecovery(saved);
      await checkStatus(saved);
    } catch {
      setPhase("hold");
      setError("Saved payment details are unavailable. Do not start another payment until the earlier order is checked.");
    }
  });

  useEffect(() => {
    active.current = true;
    let disposed = false;
    queueMicrotask(() => { if (!disposed) void restore(); });
    return () => {
      disposed = true;
      active.current = false;
      controller.current?.abort();
      busy.current = false;
      checkout.current?.close();
    };
  }, [storageKey]);

  useEffect(() => {
    if (scriptReady) return;
    const timer = setTimeout(() => setScriptFailed(true), 15_000);
    return () => clearTimeout(timer);
  }, [scriptReady]);

  async function pay() {
    if (busy.current || !scriptReady || !window.Razorpay || recoveryRef.current?.opened || phase !== "ready") return;
    busy.current = true;
    setError(null);
    setPhase("creating");
    const operation = new AbortController();
    controller.current = operation;
    try {
      const snapshot = recoveryRef.current ?? { version: 1 as const, idempotencyKey: crypto.randomUUID(), orderId: null, opened: false };
      persist(snapshot);
      const fresh = await synchronize(snapshot, operation.signal);
      if (fresh.status !== "created" || !fresh.checkout) return;
      const launched = { ...snapshot, orderId: fresh.orderId, opened: true };
      let callbackReceived = false;
      const instance = new window.Razorpay({
        ...fresh.checkout,
        theme: { color: "#2563eb" }, retry: { enabled: false },
        config: { display: {
          blocks: { test_methods: { name: "Payment methods", instruments: [{ method: "card" }, { method: "netbanking" }, { method: "upi" }] } },
          sequence: ["block.test_methods"], preferences: { show_default_blocks: false },
        } },
        handler(value) {
          if (!active.current || callbackReceived || checkout.current !== instance) return;
          callbackReceived = true;
          const proof = z.object({ razorpay_order_id: z.literal(fresh.checkout!.order_id),
            razorpay_payment_id: paymentProofSchema.shape.paymentId, razorpay_signature: paymentProofSchema.shape.signature }).safeParse(value);
          if (!proof.success) {
            setPhase("hold");
            setError("Checkout returned mismatched payment details. The order needs review.");
            return;
          }
          const pending = { ...launched, proof: { paymentId: proof.data.razorpay_payment_id, signature: proof.data.razorpay_signature,
            providerOrderId: proof.data.razorpay_order_id } };
          try { persist(pending); }
          catch { recoveryRef.current = pending; setRecovery(pending); }
          busy.current = false;
          void checkStatus(pending);
        },
        modal: { confirm_close: true, ondismiss() {
          if (!active.current || callbackReceived || checkout.current !== instance) return;
          setPhase("pending");
          setError("Checkout closed. Payment is not confirmed; check the saved order before retrying.");
          payButton.current?.focus();
        } },
      });
      instance.on("payment.failed", () => {
        if (!active.current || callbackReceived || checkout.current !== instance) return;
        setPhase("pending");
        setError("Razorpay reported a failed attempt. Check the saved order for its final status.");
      });
      persist(launched);
      checkout.current = instance;
      setPhase("checkout");
      instance.open();
    } catch {
      if (active.current && !operation.signal.aborted) {
        setPhase(recoveryRef.current ? "pending" : "hold");
        setError("Checkout could not be opened. Saved payment details must be available before continuing.");
      }
    } finally {
      if (controller.current === operation) busy.current = false;
    }
  }

  const working = ["loading", "creating", "verifying", "checkout"].includes(phase);
  const status = { loading: "Loading payment", ready: "Ready", creating: "Preparing checkout", checkout: "Checkout open",
    verifying: "Verifying payment", pending: "Awaiting confirmation", captured: "Test payment confirmed", hold: "Review required" }[phase];

  return (
    <section aria-labelledby="test-checkout-title" className="min-w-0 space-y-4 border-t border-slate-200 pt-5">
      <Script id="razorpay-test-checkout" src="https://checkout.razorpay.com/v1/checkout.js" strategy="afterInteractive"
        onReady={() => { setScriptReady(Boolean(window.Razorpay)); setScriptFailed(!window.Razorpay); }}
        onError={() => setScriptFailed(true)} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="test-checkout-title" className="flex items-center gap-2 font-semibold text-slate-900"><CreditCard size={18} aria-hidden="true" />Razorpay test checkout</h3>
        <span className="text-xs font-semibold text-amber-800">Test mode</span>
      </div>
      <p className="text-sm text-slate-600">Test money only. No advertising or service is purchased.</p>
      <dl className="grid grid-cols-2 gap-4 text-sm">
        <div><dt className="text-slate-500">Test amount</dt><dd className="mt-1 text-xl font-semibold tabular-nums text-slate-950">INR 10,000</dd></div>
        <div><dt className="text-slate-500">Advertising credit</dt><dd className="mt-1 text-xl font-semibold tabular-nums text-slate-950">INR 0</dd></div>
      </dl>
      <p role="status" aria-live="polite" className="flex min-h-6 items-center gap-2 text-sm font-medium text-slate-800">
        {phase === "captured" ? <CheckCircle2 size={18} className="text-emerald-700" aria-hidden="true" /> : working ? <Spinner /> : <ShieldCheck size={18} aria-hidden="true" />}{status}
      </p>
      {recovery?.orderId && <p className="break-all text-xs text-slate-500">Order: {recovery.orderId}</p>}
      {error && <Alert variant="error">{error}</Alert>}
      {scriptFailed && <Alert variant="error">Razorpay Checkout could not load. Your saved order is unchanged.</Alert>}
      <div className="flex flex-wrap gap-2">
        {phase === "ready" && !recovery?.opened && <Button onClick={() => void pay()} disabled={!scriptReady || scriptFailed} className="h-auto min-h-11 whitespace-normal">
          <CreditCard size={16} className="shrink-0" aria-hidden="true" />{scriptReady ? "Pay INR 10,000 (test)" : "Loading checkout"}
        </Button>}
        {recovery && phase !== "captured" && <button ref={payButton} type="button" disabled={working}
          onClick={() => void checkStatus()} className="inline-flex min-h-11 items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 disabled:opacity-50">
          <RefreshCw size={16} aria-hidden="true" />Check payment status
        </button>}
        {scriptFailed && <Button variant="outline" onClick={() => window.location.reload()}><RefreshCw size={16} aria-hidden="true" />Reload checkout</Button>}
        {phase === "captured" && order && <Button variant="outline" onClick={() => {
          try { sessionStorage.removeItem(storageKey); recoveryRef.current = null; setRecovery(null); setOrder(null); setError(null); setPhase("ready"); }
          catch { setError("The saved order could not be cleared. No new payment was started."); }
        }}><CreditCard size={16} aria-hidden="true" />New test payment</Button>}
      </div>
    </section>
  );
}