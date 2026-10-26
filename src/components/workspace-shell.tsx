"use client";

import { OWNER_WORDS } from "@/lib/copy/owner-words";
import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Brain, Building2, ChevronRight, Menu, Plus, X } from "lucide-react";
import { Nav } from "@/components/nav";
import { SignOutButton } from "@/components/sign-out-button";
import { HelpOnWhatsApp, SupportLinkProvider } from "@/components/support-link";
import { LEGAL_LINKS } from "@/lib/legal-links";
import styles from "./workspace-shell.module.css";

const sections: Record<string, string> = {
  dashboard: "Home", create: "Create ads", studio: "Review",
  campaigns: "Campaigns", leads: "Enquiries", brand: OWNER_WORDS.business,
  assets: "Assets", settings: "Settings",
};

function readViewedAt(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

function saveViewedAt(key: string, time: string) {
  try { localStorage.setItem(key, time); } catch { return; }
}

const UNSEEN_POLL_MS = 120_000;

export function WorkspaceShell({ children, email, ownerId, businessId, businessName, supportUrl = null }: {
  children: ReactNode;
  email: string | null;
  ownerId: string;
  businessId: string | null;
  businessName: string | null;
  supportUrl?: string | null;
}) {
  const pathname = usePathname();
  const drawer = useRef<HTMLDialogElement>(null);
  const section = sections[pathname.split("/")[1]] ?? "Workspace";
  const [unseen, setUnseen] = useState<{ key: string; since: string; count: number } | null>(null);
  const viewedKey = businessId ? `lead-viewed:${ownerId}:${businessId}` : null;
  const inInbox = pathname === "/leads" || pathname.startsWith("/leads/");
  const unseenCount = !inInbox && unseen?.key === viewedKey && readViewedAt(viewedKey) === unseen.since ? unseen.count : 0;

  useEffect(() => {
    if (!viewedKey) return;
    const markViewed = () => saveViewedAt(viewedKey, new Date().toISOString());
    if (inInbox) {
      markViewed();
      window.addEventListener("pagehide", markViewed);
      return () => { markViewed(); window.removeEventListener("pagehide", markViewed); };
    }
    let since = readViewedAt(viewedKey);
    if (!since || Number.isNaN(Date.parse(since))) {
      since = new Date(0).toISOString();
      saveViewedAt(viewedKey, since);
    }
    const controller = new AbortController();
    let lastLoad = 0;
    const loadCount = async () => {
      lastLoad = Date.now();
      try {
        const response = await fetch(`/api/leads/unseen?since=${encodeURIComponent(since)}`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) return;
        const data = await response.json() as { count?: number };
        if (!controller.signal.aborted && typeof data.count === "number" && Number.isSafeInteger(data.count) && data.count >= 0) {
          setUnseen({ key: viewedKey, since, count: data.count });
        }
      } catch { return; }
    };
    // #270: the badge was 55 calls/hour; poll only while visible, at most every 2 minutes, plus on focus.
    const visible = () => document.visibilityState !== "hidden";
    if (visible()) void loadCount();
    const timer = window.setInterval(() => {
      if (visible() && Date.now() - lastLoad >= UNSEEN_POLL_MS) void loadCount();
    }, 30_000);
    const onFocus = () => { if (visible()) void loadCount(); };
    window.addEventListener("focus", onFocus);
    return () => { controller.abort(); window.clearInterval(timer); window.removeEventListener("focus", onFocus); };
  }, [inInbox, viewedKey]);

  const identity = <Link href="/brand" className={styles.business}>
    <span className={styles.businessIcon}><Building2 size={17} aria-hidden="true" /></span>
    <span><strong>{businessName || OWNER_WORDS.business}</strong><small>{businessName ? OWNER_WORDS.business : "Set up your business"}</small></span>
    <ChevronRight size={14} aria-hidden="true" />
  </Link>;

  const account = <div className={styles.account}><HelpOnWhatsApp className={styles.help} /><div><span className={styles.avatar} aria-hidden="true">{(email || "A").slice(0, 1).toUpperCase()}</span><span title={email || undefined}>{email || "Your account"}</span></div><SignOutButton /><nav aria-label="Legal" className={styles.legal}>{LEGAL_LINKS.map(link => <Link key={link.href} href={link.href} prefetch={false}>{link.label}</Link>)}</nav></div>;

  return <SupportLinkProvider url={supportUrl}><div className={styles.shell}>
    <a className={styles.skip} href="#workspace-main">Skip to workspace</a>
    <aside className={styles.sidebar} aria-label="Main sidebar">
      <Link href="/dashboard" className={styles.logo}><Brain size={20} aria-hidden="true" />AdBrain</Link>
      {identity}
      <Nav unseenCount={unseenCount} />
      {account}
    </aside>
    <div className={styles.body}>
      <header className={styles.header}>
        <button className={styles.menu} type="button" title="Open navigation" aria-label="Open navigation" aria-haspopup="dialog" onClick={() => drawer.current?.showModal()}><Menu size={21} aria-hidden="true" /></button>
        {/* #847: phones only. On wider screens the sidebar holds Create ads and the H1 names the page. */}
        <div className={styles.breadcrumb}><strong>{section}</strong></div>
        {!pathname.startsWith("/create") && <Link className={styles.create} href="/create" aria-label="Create ads" title="Create ads"><Plus size={20} aria-hidden="true" /></Link>}
      </header>
      <main id="workspace-main" tabIndex={-1} className={styles.main}>{children}</main>
    </div>
    <dialog ref={drawer} className={styles.drawer} aria-label="Workspace menu" onClick={event => {
      if (event.target === event.currentTarget || (event.target instanceof Element && event.target.closest("a"))) drawer.current?.close();
    }}>
      <div className={styles.drawerBody}>
        <div className={styles.drawerHeading}><Link href="/dashboard" className={styles.logo}><Brain size={20} aria-hidden="true" />AdBrain</Link><button type="button" title="Close navigation" aria-label="Close navigation" onClick={() => drawer.current?.close()}><X size={21} aria-hidden="true" /></button></div>
        {identity}<Nav unseenCount={unseenCount} />{account}
      </div>
    </dialog>
  </div></SupportLinkProvider>;
}