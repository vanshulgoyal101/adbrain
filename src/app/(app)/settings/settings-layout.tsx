import type { ReactNode } from "react";
import styles from "./settings-layout.module.css";

export function SettingsColumns({ primary, secondary }: { primary: ReactNode; secondary: ReactNode }) {
  return <div className={`${styles.columns} space-y-6 xl:grid xl:grid-cols-2 xl:items-start xl:gap-6 xl:space-y-0`}>
    <div className={`${styles.primary} min-w-0 space-y-6`}>{primary}</div>
    <div className={`${styles.secondary} min-w-0 space-y-6`}>{secondary}</div>
  </div>;
}

export function SettingsLoading({ label, status = `Loading ${label}`, tall, primary }: {
  label: string;
  status?: string;
  tall?: boolean;
  primary?: boolean;
}) {
  return <section role="status" aria-label={status} data-settings-primary-loading={primary ? "" : undefined}
    className={`${tall ? "min-h-[22rem]" : "min-h-64"} space-y-5 rounded-lg border border-slate-200 bg-white p-6`}>
    <h2 className="font-semibold text-slate-900">{label}</h2>
    <div aria-hidden="true" className="space-y-4 motion-safe:animate-pulse">
      <div className="h-4 w-3/4 rounded bg-slate-100" />
      <div className="h-10 rounded bg-slate-100" />
      <div className="h-10 w-32 rounded bg-slate-100" />
    </div>
  </section>;
}
