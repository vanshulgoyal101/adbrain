"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Brain, Building2, ChevronRight, Menu, Plus, X } from "lucide-react";
import { Nav } from "@/components/nav";
import { SignOutButton } from "@/components/sign-out-button";
import { LEGAL_LINKS } from "@/lib/legal-links";
import styles from "./workspace-shell.module.css";

const sections: Record<string, string> = {
  dashboard: "Overview", create: "Create", studio: "Creative review",
  campaigns: "Campaigns", leads: "Enquiries", brand: "Brand Brain",
  assets: "Brand assets", settings: "Settings",
};

function readViewedAt(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

function saveViewedAt(key: string, time: string) {
  try { localStorage.setItem(key, time); } catch { return; }
}

export function WorkspaceShell({ children, email, ownerId, businessId, businessName }: {
  children: ReactNode;
  email: string | null;
  ownerId: string;
  businessId: string | null;
  businessName: string | null;
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
    const loadCount = async () => {
      try {
        const response = await fetch(`/api/leads/unseen?since=${encodeURIComponent(since)}`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) return;
        const data = await response.json() as { count?: number };
        if (!controller.signal.aborted && typeof data.count === "number" && Number.isSafeInteger(data.count) && data.count >= 0) {
          setUnseen({ key: viewedKey, since, count: data.count });
        }
      } catch { return; }
    };
    void loadCount();
    const timer = window.setInterval(() => { void loadCount(); }, 60_000);
    const onFocus = () => { void loadCount(); };
    window.addEventListener("focus", onFocus);
    return () => { controller.abort(); window.clearInterval(timer); window.removeEventListener("focus", onFocus); };
  }, [inInbox, viewedKey]);

  const identity = <Link href="/brand" className={styles.business}>
    <span className={styles.businessIcon}><Building2 size={17} aria-hidden="true" /></span>
    <span><strong>{businessName || "Your workspace"}</strong><small>{businessName ? "Business workspace" : "Set up your business"}</small></span>
    <ChevronRight size={14} aria-hidden="true" />
  </Link>;

  const account = <div className={styles.account}><div><span className={styles.avatar} aria-hidden="true">{(email || "A").slice(0, 1).toUpperCase()}</span><span title={email || undefined}>{email || "Your account"}</span></div><SignOutButton /></div>;

  return <div className={styles.shell}>
    <a className={styles.skip} href="#workspace-main">Skip to workspace</a>
    <aside className={styles.sidebar} aria-label="Main sidebar">
      <Link href="/dashboard" className={styles.logo}><Brain size={23} aria-hidden="true" />AdBrain</Link>
      {identity}
      <Nav unseenCount={unseenCount} />
      {account}
    </aside>
    <div className={styles.body}>
      <header className={styles.header}>
        <button className={styles.menu} type="button" title="Open navigation" aria-label="Open navigation" aria-haspopup="dialog" onClick={() => drawer.current?.showModal()}><Menu size={21} aria-hidden="true" /></button>
        <div className={styles.breadcrumb}><span title={businessName || undefined}>{businessName || "Workspace"}</span><ChevronRight size={14} aria-hidden="true" /><strong>{section}</strong></div>
        {!pathname.startsWith("/create") && <Link className={styles.create} href="/create"><Plus size={16} aria-hidden="true" /><span>New creative</span></Link>}
      </header>
      <main id="workspace-main" tabIndex={-1} className={styles.main}>{children}</main>
      <footer className={styles.footer}><span>AdBrain workspace</span><nav aria-label="Legal">{LEGAL_LINKS.map(link => <Link key={link.href} href={link.href}>{link.label}</Link>)}</nav></footer>
    </div>
    <dialog ref={drawer} className={styles.drawer} aria-label="Workspace menu" onClick={event => {
      if (event.target === event.currentTarget || (event.target instanceof Element && event.target.closest("a"))) drawer.current?.close();
    }}>
      <div className={styles.drawerBody}>
        <div className={styles.drawerHeading}><Link href="/dashboard" className={styles.logo}><Brain size={23} aria-hidden="true" />AdBrain</Link><button type="button" title="Close navigation" aria-label="Close navigation" onClick={() => drawer.current?.close()}><X size={21} aria-hidden="true" /></button></div>
        {identity}<Nav unseenCount={unseenCount} />{account}
      </div>
    </dialog>
  </div>;
}