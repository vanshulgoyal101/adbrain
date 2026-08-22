import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge Tailwind class names, resolving conflicts. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Format an integer with thousands separators. */
export function formatNumber(n: number): string {
  return new Intl.NumberFormat("en-IN").format(n);
}

/** Format a rupee amount. */
export function formatCurrency(n: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);
}

/**
 * Deterministic short date, e.g. "12 Mar, 3:40 pm". Uses a fixed locale and
 * timezone so the server and client always render the same string — this
 * avoids React hydration mismatches (which cause visible flicker) when a
 * client component renders a timestamp during SSR.
 */
export function formatDateShort(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(d);
}

/** Short relative time, e.g. "just now", "5m ago", "2h ago", "3d ago". */
export function timeAgo(date: Date, now: Date = new Date()): string {
  const secs = Math.max(0, Math.round((now.getTime() - date.getTime()) / 1000));
  if (secs < 45) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}
