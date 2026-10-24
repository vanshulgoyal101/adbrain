"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * #403 S6: the one modal (shadcn/ui on Radix, MIT). Radix gives the focus trap, Escape and
 * outside-click close, focus return, scroll lock and an inert page behind. A bottom sheet on
 * phones, centred from `sm`. Every dialog needs a DialogTitle (its accessible name).
 */
export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogTitle = DialogPrimitive.Title;
export const DialogDescription = DialogPrimitive.Description;

export function DialogContent({
  className,
  children,
  onOpenAutoFocus,
  onCloseAutoFocus,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content>) {
  // Radix returns focus to a DialogTrigger; a dialog opened by any other button returns it there.
  const opener = React.useRef<HTMLElement | null>(null);
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-slate-950/55 backdrop-blur-sm" />
      <DialogPrimitive.Content
        className={cn(
          "fixed inset-x-0 bottom-0 z-50 max-h-[92vh] w-full overflow-y-auto rounded-t-xl bg-white shadow-2xl focus:outline-none",
          "sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-[calc(100%-3rem)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl",
          className,
        )}
        onOpenAutoFocus={(event) => {
          opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
          onOpenAutoFocus?.(event);
        }}
        onCloseAutoFocus={(event) => {
          onCloseAutoFocus?.(event);
          if (event.defaultPrevented || !opener.current?.isConnected) return;
          event.preventDefault();
          opener.current.focus();
        }}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

/** A 44 px close target; pass `aria-label` naming what it closes. */
export function DialogClose({ className, children, ...props }: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return (
    <DialogPrimitive.Close
      className={cn(
        "inline-flex size-11 shrink-0 items-center justify-center rounded-md text-slate-700 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
        className,
      )}
      {...props}
    >
      {children ?? <X className="size-5" aria-hidden="true" />}
    </DialogPrimitive.Close>
  );
}
