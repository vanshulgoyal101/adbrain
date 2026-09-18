"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { productPages, type ClientEvent } from "@/lib/observability/client-events";

export function ProductTelemetry() {
  const pathname = usePathname();
  const lastPage = useRef<string | null>(null);
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_PRODUCT_LOGGING_ENABLED === "false" || navigator.doNotTrack === "1"
      || (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl) return;
    const page = productPages.find(candidate => candidate === pathname);
    if (!page) return;
    let errors = 0;
    const send = (name: ClientEvent["name"]) => {
      void fetch("/api/events", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin",
        body: JSON.stringify({ name, page }), keepalive: true,
      }).catch(() => {});
    };
    if (lastPage.current !== page) { lastPage.current = page; send("page.view"); }
    const onError = () => { if (errors++ < 3) send("client.error"); };
    const onRejection = () => { if (errors++ < 3) send("client.rejection"); };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, [pathname]);
  return null;
}