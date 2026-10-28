"use client";

import { PictureSourceBadge } from "@/components/picture-source-badge";
import type { AppLocale } from "@/i18n/locale";
import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, Circle } from "lucide-react";
import { MetaConnectDialog } from "@/components/meta-connect/meta-connect-dialog";
import { SetupSpine } from "@/components/setup-spine";
import { WeeklyCapLine } from "@/components/weekly-cap-line";
import { BUDGET_PRESETS } from "@/lib/campaign/budget";
import { capWithGstPaise } from "@/lib/payments/allocation";
import { goLive, type GoLiveResult, type GoLiveStep } from "@/lib/campaign/setup-go-live-flow";
import { weeklyCapNotice, type CampaignSpend } from "@/lib/campaign/spend";
import { creativeThumbnailUrl } from "@/lib/creative/thumbnail";
import { formatMoney } from "@/lib/format";
import { createMetaConnectClient } from "@/lib/meta-connect-ui/client";
import { connectTrustLine } from "@/lib/trust-lines";
import type { SetupWelcome } from "@/lib/campaign/setup-welcome";
import { whenTheyTapLine } from "@/components/when-they-tap";
import type { Business, Creative } from "@/lib/types";
import { cn } from "@/lib/utils";

/** #1251: the first run is 2 days, so the most it can spend is shown with the daily amount. */
export const SETUP_RUN_DAYS = 2;

export type SetupFunding = "operator" | "managed" | "own";

/**
 * #1251 CEO (owner's margin rule): row 2b ('Ad money', pay AdBrain) stays off until pricing is the flat
 * ₹999/month with pass-through ad money; 'Add ₹{pay}' next to 'Stops at ₹{total}' would show our share.
 * Until then every owner sees row 2a: pay Meta on their own ad account.
 */
const SHOW_ADBRAIN_AD_MONEY = false;

function Row({ done, title, status, action }: { done: boolean; title: string; status: string; action?: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3 py-3">
      {done
        ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-label="Done" />
        : <Circle className="mt-0.5 h-5 w-5 shrink-0 text-slate-400" aria-label="To do" />}
      <div className="min-w-0 flex-1">
        <p className="font-medium text-slate-950">{title}</p>
        <p className="text-sm text-slate-600">{status}</p>
        {action}
      </div>
    </li>
  );
}

const linkClass = "inline-flex min-h-11 items-center text-sm font-medium text-primary underline underline-offset-4";

function sessionStore(): Storage | null {
  try { return window.sessionStorage; } catch { return null; }
}

/**
 * #1271 (#1251 WS1 step 3): what will run, the budget for 2 days, and a checklist whose one primary walks
 * Connect Facebook Page → Go live. Go live is one tap (4b): save the draft, review it, create it paused, then turn
 * it on as a 2-day capped run (setup-go-live-flow). Nothing is spent before that tap; the server enforces the cap.
 */
export function SetupGoLive({ business, ads, pageConnected, funding, whatsappNumber, weeklyCap, welcome = null, returning = false, initialDaily, locale = "en" }: {
  business: Pick<Business, "id" | "name" | "locations">;
  ads: Creative[];
  pageConnected: boolean;
  funding: SetupFunding | null;
  /** Masked, as the owner sees it elsewhere. */
  whatsappNumber: string | null;
  weeklyCap: { capRupees: number | null; active: CampaignSpend[] } | null;
  /** #1529: the WhatsApp welcome Go live sends (as Review works it out); null if it couldn't be read. */
  welcome?: SetupWelcome | null;
  /** #1934: a returning owner's new campaign: payment was set up for the last one, and Back keeps the mode. */
  returning?: boolean;
  /** #1934: the offered amount nearest the last campaign's daily budget. */
  initialDaily?: number;
  /** #1901: the picture badge's language. */
  locale?: AppLocale;
}) {
  const router = useRouter();
  const [daily, setDaily] = useState<number>(initialDaily ?? BUDGET_PRESETS[0]);
  const [connectOpen, setConnectOpen] = useState(false);
  const [step, setStep] = useState<GoLiveStep | null>(null);
  const [result, setResult] = useState<GoLiveResult | null>(null);
  const running = useRef(false);
  // #1251 CPO/Dev 2: the most it can cost includes Meta's GST, worked out as activation's reserve check does.
  const total = capWithGstPaise({ dailyRupees: daily, days: SETUP_RUN_DAYS }) / 100;
  const cap = weeklyCap ? weeklyCapNotice(weeklyCap.active, daily, weeklyCap.capRupees) : null;
  const areas = (business.locations ?? []).filter((place) => place.trim()).join(", ");
  const ids = ads.map((ad) => ad.id).join(",");
  const ownAccount = funding === "own";
  const payMetaRow = ownAccount || !SHOW_ADBRAIN_AD_MONEY;
  const reviewHref = `/campaigns?all=1&new=1&review=1&budget=${daily}&creatives=${ids}`;
  const stepWords: Record<GoLiveStep, string> = {
    check: "Checking your campaign…",
    create: "Creating it on Meta, paused…",
    activate: "Turning it on…",
  };

  async function startGoLive() {
    if (running.current) return;
    running.current = true;
    setResult(null);
    try {
      const outcome = await goLive(
        { client: createMetaConnectClient(), fetch: (...args) => fetch(...args), storage: sessionStore() },
        { businessId: business.id, businessName: business.name, ads, dailyBudgetRupees: daily, capDays: SETUP_RUN_DAYS },
        setStep,
      );
      if (outcome.kind === "connect") setConnectOpen(true);
      else setResult(outcome);
    } finally {
      running.current = false;
      setStep(null);
    }
  }

  const primary = !pageConnected
    ? { label: "Connect Facebook Page", onClick: () => setConnectOpen(true) }
    : result?.kind === "live"
      ? { label: "Open your campaign", href: "/campaigns?all=1" }
      : {
          label: `Go live · ${formatMoney(daily)} a day`,
          disabled: Boolean(cap?.exceeds) || step !== null,
          onClick: () => void startGoLive(),
        };

  return (
    <SetupSpine step={3} primary={primary} again={returning}>
      {/* #1587: a readable column at 1440, not the full width. */}
      <div className="max-w-2xl">
      <h2 className="text-xl font-semibold text-slate-950">Go live</h2>
      <dl className="mt-4 flex flex-col gap-4 text-sm">
        <div>
          <dt className="text-slate-500">Ads: {ads.length} picked</dt>
          <dd className="mt-2 flex flex-wrap gap-2">
            {ads.map((ad) => ad.image_url && (
              <figure key={ad.id} className="flex flex-col items-start gap-1">
                <img src={creativeThumbnailUrl(ad.image_url)} alt={ad.headline ?? "Your ad"} className="h-16 w-16 rounded-md bg-slate-100 object-cover" />
                <PictureSourceBadge generation={ad.generation} locale={locale} />
              </figure>
            ))}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">Budget</dt>
          <dd className="mt-1 font-medium text-slate-950">{formatMoney(daily)} a day for {SETUP_RUN_DAYS} days, {formatMoney(total)} at most including Meta&apos;s GST</dd>
          <dd className="mt-2"><div className="flex flex-wrap gap-2" role="group" aria-label="Daily budget">
            {BUDGET_PRESETS.map((amount, index) => (
              <button key={amount} type="button" aria-pressed={daily === amount} aria-label={`${formatMoney(amount)} a day`} disabled={step !== null || result?.kind === "live"}
                onClick={() => { setDaily(amount); setResult(null); }}
                className={cn("min-h-11 rounded-full border px-4 text-sm font-medium",
                  daily === amount ? "border-primary bg-primary/10 text-primary" : "border-slate-300 bg-white text-slate-700")}>
                {/* #1587: one solid primary on the step; 'a day' once, so the chips fit one row at 390. */}
                {index === 0 ? `${formatMoney(amount)} a day` : formatMoney(amount)}
              </button>
            ))}
          </div></dd>
          <dd><WeeklyCapLine notice={cap} className="mt-2" /></dd>
        </div>
        <div>
          <dt className="text-slate-500">Where</dt>
          <dd className="mt-1 font-medium text-slate-950">{areas || "Where your business serves"}</dd>
        </div>
        <div>
          <dt className="text-slate-500">When they tap</dt>
          <dd className="mt-1 font-medium text-slate-950">
            {whatsappNumber ? `They message you on WhatsApp at ${whatsappNumber}` : "They message you on WhatsApp"}
          </dd>
          {welcome && <>
            <dd className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-3 text-slate-800">&ldquo;{welcome.greeting}&rdquo;</dd>
            <dd className="mt-1 text-slate-600">{whenTheyTapLine(welcome)}</dd>
          </>}
        </div>
      </dl>
      {/* #1529: before the Page is connected, the full composer is the pre-access panel, a dead end. */}
      {pageConnected && (
        <Link href={`/campaigns?all=1&new=1&creatives=${ids}`} className="mt-3 inline-flex min-h-11 items-center text-sm font-medium text-slate-700 underline underline-offset-4">
          Change who sees it
        </Link>
      )}

      <ul aria-label="Before you go live" className="mt-4 divide-y divide-slate-200 border-y border-slate-200">
        <Row done={pageConnected} title="Facebook Page" status={pageConnected ? "Connected" : "Not connected"} />
        {payMetaRow ? (
          returning ? <Row done title="Payment on Meta" status="Set up for your last campaign" /> : <Row done={false} title="Payment on Meta" status="Add a card or UPI in Meta"
            action={<a href="https://business.facebook.com/billing_hub/payment_settings" target="_blank" rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline underline-offset-4">Add payment in Meta</a>} />
        ) : (
          <Row done={false} title="Ad money" status="Pay by UPI or card"
            action={<Link href="/settings" className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline underline-offset-4">Add money</Link>} />
        )}
        <Row done title={`Stops at ${formatMoney(total)}`} status={`${SETUP_RUN_DAYS} days at ${formatMoney(daily)} a day, including Meta's GST`} />
      </ul>
      <p className="mt-4 text-sm text-slate-600">Meta checks your ads first, usually within a few hours and up to a day.</p>
      {/* #718 (CEO, path A): AdBrain's own price, said before the first Go live. */}
      {ownAccount && !returning && <p className="mt-3 text-sm text-slate-600">Your first month of AdBrain is free. After that it&apos;s ₹999 a month; we&apos;ll remind you before it&apos;s due.</p>}
      {/* #1292: the Connect moment's trust line, next to the Connect Facebook Page primary. */}
      {!pageConnected && funding && <p className="mt-3 text-sm font-medium text-slate-800">{connectTrustLine(funding)}</p>}

      {step && <p role="status" className="mt-4 text-sm font-medium text-slate-950">{stepWords[step]}</p>}
      {result?.kind === "live" && (
        <p role="status" className="mt-4 text-sm font-medium text-slate-950">You&apos;re live. Meta is checking your ads; they usually start within a day.</p>
      )}
      {result?.kind === "blocked" && (
        <div role="alert" className="mt-4 text-sm text-slate-950">
          <ul className="list-disc pl-5">{result.messages.map((message) => <li key={message}>{message}</li>)}</ul>
          <Link href={reviewHref} className={linkClass}>Fix in campaign review</Link>
        </div>
      )}
      {result?.kind === "refused" && (
        <div role="alert" className="mt-4 text-sm text-slate-950">
          <p>{result.message}</p>
          <p className="mt-1">Your campaign is saved, paused. Nothing was spent.</p>
          <Link href="/campaigns?all=1" className={linkClass}>Open Campaigns</Link>
        </div>
      )}
      {result?.kind === "failed" && <p role="alert" className="mt-4 text-sm text-slate-950">{result.message}</p>}

      {connectOpen && (
        <MetaConnectDialog businessId={business.id} intent={{ kind: "setup" }} open={connectOpen}
          onClose={() => setConnectOpen(false)}
          onConnected={() => { setConnectOpen(false); router.refresh(); }} />
      )}
      </div>
    </SetupSpine>
  );
}
