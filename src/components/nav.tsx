"use client";

import Link, { useLinkStatus } from "next/link";
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
  { href: "/create", label: "Create", icon: Wand2 },
  { href: "/studio", label: "Review", icon: Sparkles },
  { href: "/campaigns", label: "Campaigns", icon: Megaphone },
  { href: "/leads", label: "Enquiries", icon: Inbox },
];

const workspaceItems = [
  { href: "/brand", label: "Brand Brain", icon: Building2 },
  { href: "/assets", label: "Assets", icon: ImageIcon },
  { href: "/settings", label: "Settings", icon: Settings },
];

const navClass = (active: boolean) =>
  cn(
    "flex min-h-11 items-center gap-3 whitespace-nowrap rounded-md px-3 py-2.5 text-sm font-medium transition-colors",
    active
      ? "bg-blue-50 text-blue-700"
      : "text-slate-700 hover:bg-slate-100 hover:text-slate-950",
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

export function Nav({
  orientation = "vertical",
}: {
  orientation?: "vertical" | "horizontal";
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
      {orientation === "vertical" && (
        <p className="mb-2 px-3 text-[10px] font-semibold text-slate-500">
          Marketing
        </p>
      )}
      {primaryItems.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(href + "/");
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={navClass(active)}
          >
            <NavLabel label={label} icon={Icon} />
          </Link>
        );
      })}
      {orientation === "vertical" && (
        <p className="mb-2 mt-7 px-3 text-[10px] font-semibold text-slate-500">
          Workspace
        </p>
      )}
      {workspaceItems.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(href + "/");
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={navClass(active)}
          >
            <NavLabel label={label} icon={Icon} />
          </Link>
        );
      })}
    </nav>
  );
}
