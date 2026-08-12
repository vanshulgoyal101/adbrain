"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, Inbox, LayoutDashboard, Megaphone, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

const items = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/brand", label: "Brand Brain", icon: Building2 },
  { href: "/studio", label: "Creative Studio", icon: Sparkles },
  { href: "/campaigns", label: "Campaigns", icon: Megaphone },
  { href: "/leads", label: "Leads", icon: Inbox },
];

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
          : "flex-row overflow-x-auto",
      )}
    >
      {items.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(href + "/");
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-3 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-emerald-50 text-emerald-700"
                : "text-slate-600 hover:bg-slate-100",
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
