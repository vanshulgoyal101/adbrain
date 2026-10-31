import type { ReactNode } from "react";
import Link from "next/link";
import { Brain } from "lucide-react";
import { LEGAL_LINKS } from "@/lib/legal-links";
import { SIGN_IN_HREF } from "@/lib/site";
import styles from "./ideas.module.css";

export function IdeasShell({ children }: { children: ReactNode }) {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link href="/" aria-label="AdBrain home" className={styles.logo}><Brain aria-hidden="true" size={26} /> AdBrain</Link>
        <Link href={SIGN_IN_HREF} className={styles.signIn}>Sign in</Link>
      </header>
      <main className={styles.main}>{children}</main>
      <footer className={styles.footer}>
        <span>AdBrain</span>
        <nav aria-label="Legal">{LEGAL_LINKS.map(({ href, label }) => <Link key={href} href={href}>{label}</Link>)}</nav>
      </footer>
    </div>
  );
}
