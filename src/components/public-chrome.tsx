import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Brain } from "lucide-react";
import { LEGAL_LINKS } from "@/lib/legal-links";
import { SIGN_IN_HREF } from "@/lib/site";
import styles from "./public-chrome.module.css";

/** #2748: the one header every public page uses; only the right-hand action and optional nav links differ. */
export function PublicHeader({ action = "signin", nav }: { action?: "signin" | "home"; nav?: ReactNode }) {
  return (
    <header className={styles.header}>
      <Link href="/" aria-label="AdBrain home" className={styles.logo}><Brain aria-hidden="true" size={26} /> AdBrain</Link>
      <nav aria-label="Main navigation">
        {nav}
        {action === "signin"
          ? <Link href={SIGN_IN_HREF} className={`${styles.action} ${styles.signIn}`}>Sign in <ArrowRight aria-hidden="true" size={16} /></Link>
          : <Link href="/" className={`${styles.action} ${styles.home}`}><ArrowLeft aria-hidden="true" size={16} /> Home</Link>}
      </nav>
    </header>
  );
}

/** #2748: the one footer every public page uses: Guides and the legal links, each a 44px target. */
export function PublicFooter() {
  return (
    <footer className={styles.footer}>
      <span>AdBrain</span>
      <nav aria-label="Resources and legal">
        <Link href="/guides">Guides</Link>
        {LEGAL_LINKS.map((link) => <Link key={link.href} href={link.href}>{link.label}</Link>)}
      </nav>
    </footer>
  );
}
