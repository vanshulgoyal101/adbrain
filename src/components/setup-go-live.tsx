"use client";

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
import type { Business, Creative } from "@/lib/types";
import { cn } from "@/lib/utils";

/** #1251: the first run is 2 days, so the most it can spend is shown with the daily amount. */
export const SETUP_RUN_DAYS = 2;

export type SetupFunding = "operator" | "managed" | "own";

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
export function SetupGoLive({ business, ads, pageConnected, funding, whatsappNumber, weeklyCap }: {
  business: Pick<Business, "id" | "name" | "locations">;
  ads: Creative[];
  pageConnected: boolean;
  funding: SetupFunding | null;
  /** Masked, as the owner sees it elsewhere. */
  whatsappNumber: string | null;
  weeklyCap: { capRupees: number | null; active: CampaignSpend[] } | null;
}) {
  const router = useRouter();
  const [daily, setDaily] = useState<number>(BUDGET_PRESETS[0]);
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
    <SetupSpine step={3} primary={primary}>
      <h2 className="text-xl font-semibold text-slate-950">Go live</h2>
      <dl className="mt-4 flex flex-col gap-4 text-sm">
        <div>
          <dt className="text-slate-500">Ads: {ads.length} picked</dt>
          <dd className="mt-2 flex gap-2">
            {ads.map((ad) => ad.image_url && (
              <img key={ad.id} src={creativeThumbnailUrl(ad.image_url)} alt={ad.headline ?? "Your ad"} className="h-16 w-16 rounded-md bg-slate-100 object-cover" />
            ))}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">Budget</dt>
          <dd className="mt-1 font-medium text-slate-950">{formatMoney(daily)} a day for {SETUP_RUN_DAYS} days, {formatMoney(total)} at most including Meta&apos;s GST</dd>
          <dd className="mt-2"><div className="flex flex-wrap gap-2" role="group" aria-label="Daily budget">
            {BUDGET_PRESETS.map((amount) => (
              <button key={amount} type="button" aria-pressed={daily === amount} disabled={step !== null || result?.kind === "live"}
                onClick={() => { setDaily(amount); setResult(null); }}
                className={cn("min-h-11 rounded-full border px-4 text-sm font-medium",
                  daily === amount ? "border-primary bg-primary text-primary-foreground" : "border-slate-300 bg-white text-slate-700")}>
                {formatMoney(amount)} a day
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
        </div>
      </dl>
      <Link href={`/campaigns?all=1&new=1&creatives=${ids}`} className="mt-3 inline-flex min-h-11 items-center text-sm font-medium text-slate-700 underline underline-offset-4">
        Change who sees it
      </Link>

      <ul aria-label="Before you go live" className="mt-4 divide-y divide-slate-200 border-y border-slate-200">
        <Row done={pageConnected} title="Facebook Page" status={pageConnected ? "Connected" : "Not connected"} />
        {ownAccount ? (
          <Row done={false} title="Payment on Meta" status="Add a card or UPI in Meta"
            action={<a href="https://business.facebook.com/billing_hub/payment_settings" target="_blank" rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline underline-offset-4">Add payment in Meta</a>} />
        ) : (
          <Row done={false} title="Ad money" status="Pay by UPI or card"
            action={<Link href="/settings" className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline underline-offset-4">Add money</Link>} />
        )}
        <Row done title={`Stops at ${formatMoney(total)}`} status={`${SETUP_RUN_DAYS} days at ${formatMoney(daily)} a day, including Meta's GST`} />
      </ul>
      <p className="mt-4 text-sm text-slate-600">Meta checks your ads first, usually within a day. Spending starts only after that and stops at {formatMoney(total)}, including Meta&apos;s GST.</p>
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
    </SetupSpine>
  );
}
