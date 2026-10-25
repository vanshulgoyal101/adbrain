"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

export type ConfirmOptions = {
  title: string;
  description?: string;
  confirmLabel: string;
  cancelLabel?: string;
  /** `danger` for deleting or disconnecting: the confirm button is solid red (S1's rule). */
  tone?: "default" | "danger";
};

/**
 * #403 S6: the one confirmation, replacing `window.confirm` (unstyled, and suppressed by some
 * in-app browsers). Render the returned element; `await confirm({...})` resolves true only on the
 * confirm button. Escape, the overlay and Cancel all resolve false.
 */
export function useConfirm(): [(options: ConfirmOptions) => Promise<boolean>, React.ReactNode] {
  const [options, setOptions] = React.useState<ConfirmOptions | null>(null);
  // Kept after closing so Radix closes the content itself and returns focus to the opener.
  const [shown, setShown] = React.useState<ConfirmOptions | null>(null);
  const resolver = React.useRef<((confirmed: boolean) => void) | null>(null);

  const settle = React.useCallback((confirmed: boolean) => {
    resolver.current?.(confirmed);
    resolver.current = null;
    setOptions(null);
  }, []);

  const confirm = React.useCallback((next: ConfirmOptions) => {
    resolver.current?.(false);
    setOptions(next);
    setShown(next);
    return new Promise<boolean>((resolve) => { resolver.current = resolve; });
  }, []);

  React.useEffect(() => () => resolver.current?.(false), []);

  const dialog = (
    <Dialog open={options !== null} onOpenChange={(open) => { if (!open) settle(false); }}>
      {shown && (
        // Radix links the description itself; without one, say so explicitly.
        <DialogContent className="p-6 sm:max-w-md" {...(shown.description ? {} : { "aria-describedby": undefined })}>
          <DialogTitle className="text-lg font-semibold text-slate-950">{shown.title}</DialogTitle>
          {shown.description && <DialogDescription className="mt-2 text-sm text-slate-600">{shown.description}</DialogDescription>}
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => settle(false)}>{shown.cancelLabel ?? "Cancel"}</Button>
            <Button
              className={shown.tone === "danger" ? "border-red-700 bg-red-700 text-white hover:bg-red-800" : undefined}
              onClick={() => settle(true)}
            >
              {shown.confirmLabel}
            </Button>
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
  return [confirm, dialog];
}
