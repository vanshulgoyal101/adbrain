import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: {
  eyebrow: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between",
        className,
      )}
    >
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-700">
          {eyebrow}
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-[-0.03em] text-slate-950">
          {title}
        </h1>
        {description && (
          <div className="mt-1 max-w-2xl text-slate-600">{description}</div>
        )}
      </div>
      {actions && <div className="flex-none">{actions}</div>}
    </header>
  );
}