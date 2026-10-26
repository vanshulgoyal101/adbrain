"use client";

import { createContext, useContext, type ReactNode } from "react";
import { MessageCircle } from "lucide-react";

const SupportLinkContext = createContext<string | null>(null);

export function SupportLinkProvider({ url, children }: { url: string | null; children: ReactNode }) {
  return <SupportLinkContext.Provider value={url}>{children}</SupportLinkContext.Provider>;
}

/** #796: a person to ask, on WhatsApp, wherever an owner may get stuck (menu, Connect, Launch). */
export function HelpOnWhatsApp({ label = "Help on WhatsApp", className }: { label?: string; className?: string }) {
  const url = useContext(SupportLinkContext);
  if (!url) return null;
  return <a href={url} target="_blank" rel="noopener noreferrer" className={className ?? "inline-flex items-center gap-1.5 text-sm font-medium text-emerald-700 hover:underline"}>
    <MessageCircle size={15} aria-hidden="true" />{label}
  </a>;
}
