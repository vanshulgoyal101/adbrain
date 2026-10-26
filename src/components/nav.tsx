"use client";

import { OWNER_WORDS } from "@/lib/copy/owner-words";
import Link, { useLinkStatus } from "next/link";
import { useState } from "react";
import { usePathname } from "next/navigation";
import {
  Building2,
  Image as ImageIcon,
  Inbox,
  LayoutDashboard,
  Megaphone,
  Settings,
  Sparkles,
  Wand2,
  Loader2,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

const primaryItems = [
  { href: "/dashboard", label: "Home", icon: LayoutDashboard },
  { href: "/create", label: "Create ads", icon: Wand2 },
  { href: "/studio", label: "Review", icon: Sparkles },
  { href: "/campaigns", label: "Campaigns", icon: Megaphone },
  { href: "/leads", label: "Enquiries", icon: Inbox },
];

const workspaceItems = [
  { href: "/brand", label: OWNER_WORDS.business, icon: Building2 },
  { href: "/assets", label: "Assets", icon: ImageIcon },
  { href: "/settings", label: "Settings", icon: Settings },
];

const navClass = (active: boolean) =>
  cn(
    "flex min-h-11 items-center gap-3 whitespace-nowrap rounded-md px-3 py-2.5 text-sm font-medium transition-colors",
    active
      ? "bg-white text-slate-950 ring-1 ring-slate-200"
      : "text-slate-600 hover:bg-white/70 hover:text-slate-950",
  );

function NavLabel({ label, icon: Icon }: { label: string; icon: LucideIcon }) {
  const { pending } = useLinkStatus();
  return <>
    {pending
      ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
      : <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />}
    <span aria-busy={pending}>{label}</span>
  </>;
}

function NavItem({ href, label, icon, active, unseenCount = 0 }: {
  href: string; label: string; icon: LucideIcon; active: boolean; unseenCount?: number;
}) {
  const [intent, setIntent] = useState(false);
  function warmRoute() {
    if (!active) setIntent(true);
  }
  return (
    <Link href={href} prefetch={intent && !active ? true : null} aria-current={active ? "page" : undefined} className={navClass(active)}
      onMouseEnter={warmRoute} onFocus={warmRoute} onTouchStart={warmRoute}>
      <NavLabel label={label} icon={icon} />
      {unseenCount > 0 && <span aria-label={`${unseenCount} new enquiries`} className="ml-auto shrink-0 text-xs font-semibold tabular-nums text-blue-700">{unseenCount > 99 ? "99+" : unseenCount}</span>}
    </Link>
  );
}

export function Nav({
  orientation = "vertical",
  unseenCount = 0,
}: {
  orientation?: "vertical" | "horizontal";
  unseenCount?: number;
}) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Workspace navigation"
      className={cn(
        "flex gap-1",
        orientation === "vertical"
          ? "flex-col"
          : "scrollbar-none flex-row overflow-x-auto",
      )}
    >
      {primaryItems.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(href + "/");
        return (
          <NavItem key={href} href={href} label={label} icon={Icon} active={active} unseenCount={href === "/leads" ? unseenCount : 0} />
        );
      })}
      {orientation === "vertical" && <div className="h-4" aria-hidden="true" />}
      {workspaceItems.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(href + "/");
        return (
          <NavItem key={href} href={href} label={label} icon={Icon} active={active} />
        );
      })}
    </nav>
  );
}
