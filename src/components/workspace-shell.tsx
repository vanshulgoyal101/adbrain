"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Brain, Building2, ChevronRight, Menu, Plus, X } from "lucide-react";
import { Nav, type ShellLabels } from "@/components/nav";
import en from "../../messages/en.json";
import { SignOutButton } from "@/components/sign-out-button";
import { HelpOnWhatsApp, SupportLinkProvider } from "@/components/support-link";
import { LEGAL_LINKS } from "@/lib/legal-links";
import { usePoll } from "@/lib/use-poll";
import type { AppLocale } from "@/i18n/locale";
import styles from "./workspace-shell.module.css";

const sections: Record<string, keyof ShellLabels> = {
  dashboard: "home", create: "create", studio: "review",
  campaigns: "campaigns", leads: "enquiries", brand: "business",
  assets: "assets", settings: "settings", onboarding: "getStarted",
};

function readViewedAt(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

function saveViewedAt(key: string, time: string) {
  try { localStorage.setItem(key, time); } catch { return; }
}

const UNSEEN_POLL_MS = 120_000;

export function WorkspaceShell({ children, email, ownerId, businessId, businessName, supportUrl = null, firstAd = false, labels = en.shell, locale = "en" }: {
  /** #1877: the app bar and menu in the owner's language. */
  labels?: ShellLabels;
  /** #1895: marks those words with their language. */
  locale?: AppLocale;
  /** #1272: no campaign has gone live yet, so + continues the setup (/create resumes the saved step). */
  firstAd?: boolean;
  children: ReactNode;
  email: string | null;
  ownerId: string;
  businessId: string | null;
  businessName: string | null;
  supportUrl?: string | null;
}) {
  const pathname = usePathname();
  const drawer = useRef<HTMLDialogElement>(null);
  const sectionKey = sections[pathname.split("/")[1]];
  const section = sectionKey ? labels[sectionKey] : labels.workspace;
  const lang = locale === "en" ? undefined : locale;
  const [unseen, setUnseen] = useState<{ key: string; since: string; count: number } | null>(null);
  const viewedKey = businessId ? `lead-viewed:${ownerId}:${businessId}` : null;
  const inInbox = pathname === "/leads" || pathname.startsWith("/leads/");
  const unseenCount = !inInbox && unseen?.key === viewedKey && readViewedAt(viewedKey) === unseen.since ? unseen.count : 0;

  useEffect(() => {
    if (!viewedKey || !inInbox) return;
    const markViewed = () => saveViewedAt(viewedKey, new Date().toISOString());
    markViewed();
    window.addEventListener("pagehide", markViewed);
    return () => { markViewed(); window.removeEventListener("pagehide", markViewed); };
  }, [inInbox, viewedKey]);

  // #270: the badge was 55 calls/hour; every 2 minutes while visible, plus a missed poll on focus.
  // #1541/#1214: a 429 waits out Retry-After and a 401 (signed out) stops it.
  usePoll(async (signal) => {
    if (!viewedKey) return null;
    let since = readViewedAt(viewedKey);
    if (!since || Number.isNaN(Date.parse(since))) {
      since = new Date(0).toISOString();
      saveViewedAt(viewedKey, since);
    }
    const response = await fetch(`/api/leads/unseen?since=${encodeURIComponent(since)}`, { cache: "no-store", signal });
    if (response.ok) {
      const data = await response.json().catch(() => null) as { count?: number } | null;
      if (!signal.aborted && typeof data?.count === "number" && Number.isSafeInteger(data.count) && data.count >= 0) {
        setUnseen({ key: viewedKey, since, count: data.count });
      }
    }
    return response;
  }, { intervalMs: UNSEEN_POLL_MS, enabled: Boolean(viewedKey) && !inInbox, key: viewedKey });

  const identity = <Link href="/brand" className={styles.business}>
    <span className={styles.businessIcon}><Building2 size={17} aria-hidden="true" /></span>
    <span><strong lang={businessName ? undefined : lang}>{businessName || labels.business}</strong><small lang={lang}>{businessName ? labels.business : labels.setUpBusiness}</small></span>
    <ChevronRight size={14} aria-hidden="true" />
  </Link>;

  const account = <div className={styles.account}><HelpOnWhatsApp className={styles.help} label={labels.help} lang={lang} /><div><span className={styles.avatar} aria-hidden="true">{(email || "A").slice(0, 1).toUpperCase()}</span><span title={email || undefined} lang={email ? undefined : lang}>{email || labels.yourAccount}</span></div><SignOutButton label={labels.signOut} failed={labels.signOutFailed} lang={lang} /><nav aria-label={labels.legal} lang={lang} className={styles.legal}>{LEGAL_LINKS.map(link => <Link key={link.href} href={link.href} prefetch={false}>{labels[link.key]}</Link>)}</nav></div>;

  return <SupportLinkProvider url={supportUrl}><div className={styles.shell}>
    <a className={styles.skip} href="#workspace-main" lang={lang}>{labels.skip}</a>
    <aside className={styles.sidebar} aria-label={labels.sidebar}>
      <Link href="/dashboard" className={styles.logo}><Brain size={20} aria-hidden="true" />AdBrain</Link>
      {identity}
      <Nav unseenCount={unseenCount} labels={labels} lang={lang} />
      {account}
    </aside>
    <div className={styles.body}>
      <header className={styles.header}>
        <button className={styles.menu} type="button" title={labels.openNav} aria-label={labels.openNav} lang={lang} aria-haspopup="dialog" onClick={() => drawer.current?.showModal()}><Menu size={21} aria-hidden="true" /></button>
        {/* #847: phones only. On wider screens the sidebar holds Create ads and the H1 names the page. */}
        <div className={styles.breadcrumb}><strong lang={lang}>{section}</strong></div>
        {!pathname.startsWith("/create") && <Link className={styles.create} href="/create" aria-label={firstAd ? labels.continueFirstAd : labels.create} title={firstAd ? labels.continueFirstAd : labels.create} lang={lang}><Plus size={20} aria-hidden="true" /></Link>}
      </header>
      <main id="workspace-main" tabIndex={-1} className={styles.main}>{children}</main>
    </div>
    <dialog ref={drawer} className={styles.drawer} aria-label={labels.menu} onClick={event => {
      if (event.target === event.currentTarget || (event.target instanceof Element && event.target.closest("a"))) drawer.current?.close();
    }}>
      <div className={styles.drawerBody}>
        <div className={styles.drawerHeading}><Link href="/dashboard" className={styles.logo}><Brain size={20} aria-hidden="true" />AdBrain</Link><button type="button" title={labels.closeNav} aria-label={labels.closeNav} lang={lang} onClick={() => drawer.current?.close()}><X size={21} aria-hidden="true" /></button></div>
        {identity}<Nav unseenCount={unseenCount} labels={labels} lang={lang} />{account}
      </div>
    </dialog>
  </div></SupportLinkProvider>;
}