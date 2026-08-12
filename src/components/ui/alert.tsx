import * as React from "react";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { cn } from "@/lib/utils";

type Variant = "error" | "warning" | "success" | "info";

const styles: Record<Variant, string> = {
  error: "border-red-200 bg-red-50 text-red-700",
  warning: "border-amber-200 bg-amber-50 text-amber-700",
  success: "border-blue-200 bg-blue-50 text-blue-700",
  info: "border-slate-200 bg-slate-50 text-slate-600",
};

const icons: Record<Variant, typeof Info> = {
  error: AlertTriangle,
  warning: AlertTriangle,
  success: CheckCircle2,
  info: Info,
};

export function Alert({
  variant = "info",
  className,
  children,
}: {
  variant?: Variant;
  className?: string;
  children: React.ReactNode;
}) {
  const Icon = icons[variant];
  return (
    <div
      role={variant === "error" ? "alert" : undefined}
      className={cn(
        "flex items-start gap-2 rounded-lg border px-3 py-2 text-sm",
        styles[variant],
        className,
      )}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
