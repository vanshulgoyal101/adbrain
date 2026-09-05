"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, Image as ImageIcon, Inbox, LayoutDashboard, Megaphone, Settings, Sparkles, Wand2 } from "lucide-react";
import { cn } from "@/lib/utils";

const primaryItems = [
  { href: "/dashboard", label: "Home", icon: LayoutDashboard },
  { href: "/create", label: "Create", icon: Wand2 },
  { href: "/studio", label: "Review", icon: Sparkles },
  { href: "/campaigns", label: "Launch", icon: Megaphone },
  { href: "/leads", label: "Results", icon: Inbox },
];

const workspaceItems = [
  { href: "/brand", label: "Brand Brain", icon: Building2 },
  { href: "/assets", label: "Assets", icon: ImageIcon },
  { href: "/settings", label: "Settings", icon: Settings },
];

const navClass = (active: boolean) =>
  cn(
    "flex items-center gap-3 whitespace-nowrap rounded-xl px-3 py-2.5 text-sm font-medium transition-all",
    active
      ? "bg-blue-50 text-blue-700 md:bg-white/14 md:text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]"
      : "text-slate-300 hover:bg-white/6 hover:text-white md:text-slate-300",
  );

export function Nav({
  orientation = "vertical",
}: {
  orientation?: "vertical" | "horizontal";
}) {
  const pathname = usePathname();
  return (
    <nav
      className={cn(
        "flex gap-1",
        orientation === "vertical"
          ? "flex-col"
          : "scrollbar-none flex-row overflow-x-auto",
      )}
    >
      {orientation === "vertical" && (
        <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
          Workbench
        </p>
      )}
      {primaryItems.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(href + "/");
        return (
          <Link key={href} href={href} className={navClass(active)}>
            <Icon className="h-4 w-4" />
            {label}
          </Link>
        );
      })}
      {orientation === "vertical" && (
        <p className="mb-2 mt-7 px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
          Workspace
        </p>
      )}
      {workspaceItems.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(href + "/");
        return (
          <Link key={href} href={href} className={navClass(active)}>
            <Icon className="h-4 w-4" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
