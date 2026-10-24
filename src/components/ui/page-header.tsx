import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  description,
  actions,
  className,
  titleInTopBarOnPhone = false,
}: {
  /** @deprecated #403: no eyebrow labels; kept so call sites compile until S3 removes them. */
  eyebrow?: string;
  /** The phone top bar already names the page; keep the h1 for screen readers only there. */
  titleInTopBarOnPhone?: boolean;
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
      <div className="min-w-0">
        <h1 className={cn("font-display text-2xl font-semibold tracking-[-0.01em] text-slate-950", titleInTopBarOnPhone && "max-sm:sr-only")}>
          {title}
        </h1>
        {description && (
          <div className={cn("mt-2 max-w-2xl text-sm leading-6 text-slate-500", titleInTopBarOnPhone && "max-sm:mt-0")}>{description}</div>
        )}
      </div>
      {actions && <div className="flex-none">{actions}</div>}
    </header>
  );
}