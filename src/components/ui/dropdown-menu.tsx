"use client";

import * as React from "react";
import * as MenuPrimitive from "@radix-ui/react-dropdown-menu";
import { cn } from "@/lib/utils";

/**
 * #403 S6: the one action menu (shadcn/ui on Radix, MIT). Radix gives roles, arrow keys, typeahead,
 * Escape and focus return to the trigger. Items are 44 px; use `asChild` with <a> for links.
 */
/** #847: non-modal, so opening the menu doesn't aria-hide the page around it (axe aria-hidden-focus). */
export function DropdownMenu({ modal = false, ...props }: React.ComponentProps<typeof MenuPrimitive.Root>) {
  return <MenuPrimitive.Root modal={modal} {...props} />;
}
export const DropdownMenuTrigger = MenuPrimitive.Trigger;

export function DropdownMenuContent({ className, sideOffset = 4, align = "end", ...props }: React.ComponentProps<typeof MenuPrimitive.Content>) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Content
        sideOffset={sideOffset}
        align={align}
        className={cn("z-50 min-w-48 rounded-lg border border-slate-200 bg-white p-1 shadow-lg focus:outline-none", className)}
        {...props}
      />
    </MenuPrimitive.Portal>
  );
}

export function DropdownMenuItem({ className, variant = "default", ...props }: React.ComponentProps<typeof MenuPrimitive.Item> & { variant?: "default" | "danger" }) {
  return (
    <MenuPrimitive.Item
      className={cn(
        "flex min-h-11 cursor-pointer select-none items-center gap-2 rounded-md px-3 text-sm outline-none data-disabled:pointer-events-none data-disabled:opacity-50 data-highlighted:bg-slate-100",
        variant === "danger" ? "text-danger" : "text-slate-800",
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuSeparator({ className, ...props }: React.ComponentProps<typeof MenuPrimitive.Separator>) {
  return <MenuPrimitive.Separator className={cn("my-1 h-px bg-slate-200", className)} {...props} />;
}
