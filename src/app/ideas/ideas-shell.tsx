import type { ReactNode } from "react";
import { PublicFooter, PublicHeader } from "@/components/public-chrome";
import styles from "./ideas.module.css";

export function IdeasShell({ children }: { children: ReactNode }) {
  return (
    <div className={styles.page}>
      <PublicHeader />
      <main className={styles.main}>{children}</main>
      <PublicFooter />
    </div>
  );
}
