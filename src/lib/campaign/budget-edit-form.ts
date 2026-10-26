import { cappedRunEnded, storedCappedAdSetIds } from "@/lib/campaign/activation";
import type { Campaign, Json } from "@/lib/types";

/** #774: what the Edit budget form starts from: a capped run edits its total and end date, an uncapped one its daily budget. */
export type BudgetFormStart = { capped: boolean; dailyRupees: number; capRupees: number | null; endTime: string | null };
export type BudgetForm = { daily: string; cap: string; endDate: string };
export type BudgetChangeBody = { dailyRupees?: number; capRupees?: number; endTime?: string };
export type BudgetAfter = { dailyRupees: number; capRupees: number | null; endTime: string | null };

type Cap = { adSetId: string; lifetimeBudgetPaise: number; endTime: string };
function readCap(raw: Json | null | undefined): Cap | null {
  const cap = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>).cap : null;
  if (!cap || typeof cap !== "object") return null;
  const { adSetId, lifetimeBudgetPaise, endTime } = cap as Record<string, unknown>;
  return typeof adSetId === "string" && typeof lifetimeBudgetPaise === "number" && typeof endTime === "string" ? { adSetId, lifetimeBudgetPaise, endTime } : null;
}

export function budgetFormStart(campaign: Pick<Campaign, "daily_budget" | "raw">, now = Date.now()): BudgetFormStart | null {
  if (campaign.daily_budget === null || !(campaign.daily_budget > 0)) return null;
  const cap = readCap(campaign.raw);
  if (cap && cappedRunEnded(campaign.raw, now)) return null;
  const capped = Boolean(cap && storedCappedAdSetIds(campaign.raw).includes(cap.adSetId));
  return { capped, dailyRupees: campaign.daily_budget, capRupees: capped ? cap!.lifetimeBudgetPaise / 100 : null, endTime: capped ? cap!.endTime : null };
}

/** The owner's calendar day for an instant (the date input shows local days). */
export function localDay(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function initialBudgetForm(start: BudgetFormStart): BudgetForm {
  return { daily: String(start.dailyRupees), cap: start.capRupees === null ? "" : String(start.capRupees), endDate: start.endTime ? localDay(start.endTime) : "" };
}

const amount = (raw: string) => {
  const value = Number(raw.replace(/[₹,\s]/g, ""));
  return raw.trim() !== "" && Number.isFinite(value) && value > 0 && Math.round(value * 100) === value * 100 ? value : null;
};

/** Only what the owner changed; a new end date keeps the run's time of day. */
export function budgetChangeFromForm(start: BudgetFormStart, form: BudgetForm): { change: BudgetChangeBody } | { error: string } {
  const change: BudgetChangeBody = {};
  if (start.capped) {
    const cap = amount(form.cap);
    if (cap === null) return { error: "Enter the total cap in rupees." };
    if (cap !== start.capRupees) change.capRupees = cap;
    if (start.endTime && form.endDate && form.endDate !== localDay(start.endTime)) {
      const [year, month, day] = form.endDate.split("-").map(Number);
      const end = new Date(start.endTime);
      end.setFullYear(year, month - 1, day);
      if (!Number.isFinite(end.getTime())) return { error: "Choose a valid end date." };
      change.endTime = end.toISOString();
    }
  } else {
    const daily = amount(form.daily);
    if (daily === null) return { error: "Enter the daily budget in rupees." };
    if (daily !== start.dailyRupees) change.dailyRupees = daily;
  }
  return Object.keys(change).length ? { change } : { error: start.capped ? "Change the total cap or the end date." : "Change the daily budget." };
}

/** The card shows the saved budget at once, as the server mirrored it. */
export function applyBudget<T extends Pick<Campaign, "daily_budget" | "raw">>(campaign: T, after: BudgetAfter): T {
  const cap = readCap(campaign.raw);
  if (!cap || after.capRupees === null) return { ...campaign, daily_budget: after.dailyRupees };
  const raw = campaign.raw as Record<string, Json>;
  return { ...campaign, raw: { ...raw, cap: { ...raw.cap as Record<string, Json>, lifetimeBudgetPaise: Math.round(after.capRupees * 100), endTime: after.endTime } } };
}
