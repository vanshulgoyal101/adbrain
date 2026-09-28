"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { productActions, productPages, type ClientEvent } from "@/lib/observability/client-events";

export function ProductTelemetry() {
  const pathname = usePathname();
  const lastPage = useRef<string | null>(null);
  useEffect(() => {
    const disabled = () => process.env.NEXT_PUBLIC_PRODUCT_LOGGING_ENABLED === "false" || navigator.doNotTrack === "1"
      || (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl;
    if (disabled()) return;
    const page = productPages.find(candidate => candidate === pathname);
    if (!page) return;
    let errors = 0;
    let sent = 0;
    let windowStarted = performance.now();
    let visibleSince: number | null = document.visibilityState === "visible" ? performance.now() : null;
    let foregroundMs = 0;
    const send = (event: ClientEvent) => {
      if (disabled()) return;
      const now = performance.now();
      if (now - windowStarted >= 60_000) { sent = 0; windowStarted = now; }
      if (sent >= 45) return;
      sent += 1;
      const viewport = window.innerWidth < 640 ? "compact" : window.innerWidth < 1024 ? "medium" : "wide";
      try {
        void fetch("/api/events", {
          method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin",
          body: JSON.stringify({ ...event, viewport }), keepalive: true,
        }).catch(() => {});
      } catch { return; }
    };
    const flushEngagement = () => {
      if (visibleSince !== null) { foregroundMs += Math.max(0, performance.now() - visibleSince); visibleSince = null; }
      const durationMs = Math.min(3_600_000, Math.floor(foregroundMs));
      if (durationMs >= 1000) { send({ name: "page.engagement", page, durationMs }); foregroundMs = 0; }
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flushEngagement();
      else if (visibleSince === null) visibleSince = performance.now();
    };
    const onClick = (event: MouseEvent) => {
      const control = event.target instanceof Element ? event.target.closest("[data-product-event]") : null;
      if (!control || control.matches(":disabled, [aria-disabled='true']")) return;
      const action = productActions.find(candidate => candidate === control.getAttribute("data-product-event"));
      if (action) send({ name: "ui.action", page, action });
    };
    if (lastPage.current !== page) { lastPage.current = page; send({ name: "page.view", page }); }
    const onError = () => { if (errors++ < 3) send({ name: "client.error", page }); };
    const onRejection = () => { if (errors++ < 3) send({ name: "client.rejection", page }); };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    document.addEventListener("click", onClick, true);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flushEngagement);
    window.addEventListener("pageshow", onVisibility);
    return () => {
      flushEngagement();
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flushEngagement);
      window.removeEventListener("pageshow", onVisibility);
    };
  }, [pathname]);
  return null;
}