import * as React from "react";
import { cn } from "@/lib/utils";

/** #403/#847: primary (leaf, solid; grey when disabled), secondary/outline, quiet/ghost (text), danger (outline; solid red only in a confirm dialog). */
type Variant = "primary" | "secondary" | "outline" | "ghost" | "quiet" | "danger";
type Size = "sm" | "md" | "lg";

const variants: Record<Variant, string> = {
  primary: "bg-primary text-primary-foreground hover:bg-primary-hover disabled:bg-slate-100 disabled:text-slate-500 disabled:opacity-100 aria-disabled:bg-slate-100 aria-disabled:text-slate-500 aria-disabled:opacity-100",
  secondary: "border border-slate-300 bg-white text-slate-900 hover:bg-slate-50",
  outline: "border border-slate-300 bg-white text-slate-900 hover:bg-slate-50",
  ghost: "text-slate-700 hover:bg-slate-100",
  quiet: "text-slate-700 hover:bg-slate-100",
  danger: "border border-danger/40 bg-white text-danger hover:bg-red-50",
};

const sizes: Record<Size, string> = {
  // #847/#1156: 44 px tall on a phone; 36 px from 640 px up, where a pointer is likely.
  sm: "h-9 px-3 text-sm max-sm:min-h-11",
  md: "h-11 px-4 text-sm",
  lg: "h-12 px-6 text-base",
};

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  ref?: React.Ref<HTMLButtonElement>;
}

export function Button({
  className,
  variant = "primary",
  size = "md",
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex shrink-0 items-center justify-center gap-2 rounded-md font-medium tracking-normal transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:pointer-events-none disabled:opacity-50 aria-disabled:opacity-50",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  );
}
