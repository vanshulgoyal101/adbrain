"use client";

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
import en from "../../messages/en.json";

/** #1877: the menu and app-bar words in the owner's language (`shell` in messages/); English by default. */
export type ShellLabels = typeof en.shell;

const primaryItems: { href: string; key: keyof ShellLabels; icon: LucideIcon }[] = [
  { href: "/dashboard", key: "home", icon: LayoutDashboard },
  { href: "/create", key: "create", icon: Wand2 },
  { href: "/studio", key: "review", icon: Sparkles },
  { href: "/campaigns", key: "campaigns", icon: Megaphone },
  { href: "/leads", key: "enquiries", icon: Inbox },
];

const workspaceItems: typeof primaryItems = [
  { href: "/brand", key: "business", icon: Building2 },
  { href: "/assets", key: "assets", icon: ImageIcon },
  { href: "/settings", key: "settings", icon: Settings },
];

const navClass = (active: boolean) =>
  cn(
    "flex min-h-11 items-center gap-3 whitespace-nowrap rounded-md px-3 py-2.5 text-sm font-medium transition-colors",
    active
      ? "bg-white text-slate-950 ring-1 ring-slate-200"
      : "text-slate-600 hover:bg-white/70 hover:text-slate-950",
  );

function NavLabel({ label, icon: Icon, lang }: { label: string; icon: LucideIcon; lang?: string }) {
  const { pending } = useLinkStatus();
  return <>
    {pending
      ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
      : <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />}
    <span aria-busy={pending} lang={lang}>{label}</span>
  </>;
}

function NavItem({ href, label, icon, active, unseenCount = 0, lang }: {
  href: string; label: string; icon: LucideIcon; active: boolean; unseenCount?: number; lang?: string;
}) {
  const [intent, setIntent] = useState(false);
  function warmRoute() {
    if (!active) setIntent(true);
  }
  return (
    <Link href={href} prefetch={intent && !active ? true : null} aria-current={active ? "page" : undefined} className={navClass(active)}
      onMouseEnter={warmRoute} onFocus={warmRoute} onTouchStart={warmRoute}>
      <NavLabel label={label} icon={icon} lang={lang} />
      {unseenCount > 0 && <span aria-label={`${unseenCount} new enquiries`} className="ml-auto shrink-0 text-xs font-semibold tabular-nums text-blue-700">{unseenCount > 99 ? "99+" : unseenCount}</span>}
    </Link>
  );
}

export function Nav({
  orientation = "vertical",
  unseenCount = 0,
  labels = en.shell,
  lang,
}: {
  orientation?: "vertical" | "horizontal";
  unseenCount?: number;
  labels?: ShellLabels;
  lang?: string;
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
      {primaryItems.map(({ href, key, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(href + "/");
        return (
          <NavItem key={href} href={href} label={labels[key]} icon={Icon} active={active} unseenCount={href === "/leads" ? unseenCount : 0} lang={lang} />
        );
      })}
      {orientation === "vertical" && <div className="h-4" aria-hidden="true" />}
      {workspaceItems.map(({ href, key, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(href + "/");
        return (
          <NavItem key={href} href={href} label={labels[key]} icon={Icon} active={active} lang={lang} />
        );
      })}
    </nav>
  );
}
