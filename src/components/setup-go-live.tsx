"use client";

import { PictureSourceBadge } from "@/components/picture-source-badge";
import type { AppLocale } from "@/i18n/locale";
import { setupTranslator, type SetupWords } from "@/i18n/setup-words";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
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
import type { SetupWelcome } from "@/lib/campaign/setup-welcome";
import { whenTheyTapLine } from "@/components/when-they-tap";
import type { Business, Creative } from "@/lib/types";
import { cn } from "@/lib/utils";

/** #1251: the first run is 2 days by default, so the most it can spend is shown with the daily amount. */
export const SETUP_RUN_DAYS = 2;
/** #1530 (CEO): 2 days stays the self-serve default; pilots pick 7 (₹300 a day, ₹2,478 at most with GST). */
export const SETUP_RUN_DAY_CHOICES = [SETUP_RUN_DAYS, 7] as const;

export type SetupFunding = "operator" | "managed" | "own";

/**
 * #1251 CEO (owner's margin rule): row 2b ('Ad money', pay AdBrain) stays off until pricing is the flat
 * ₹999/month with pass-through ad money; 'Add ₹{pay}' next to 'Stops at ₹{total}' would show our share.
 * Until then every owner sees row 2a: pay Meta on their own ad account.
 */
const SHOW_ADBRAIN_AD_MONEY = false;

function Row({ done, title, status, action, labels }: { done: boolean; title: string; status: string; action?: React.ReactNode; labels: { done: string; toDo: string } }) {
  return (
    <li className="flex items-start gap-3 py-3">
      {done
        ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-label={labels.done} />
        : <Circle className="mt-0.5 h-5 w-5 shrink-0 text-slate-400" aria-label={labels.toDo} />}
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

/** #1989: set when Connect is tapped, so a return to step 3 after Facebook in this tab still counts as a try. */
const CONNECT_TRIED_KEY = "adbrain.setup.connectTried";
const INVITES_URL = "https://developers.facebook.com/requests";
const noSubscription = () => () => {};
const inviteWords = {
  en: {
    hintBefore: "Facebook is still reviewing AdBrain. Until then, your Facebook account needs our invite: open your invites and accept ",
    hintAfter: ", then tap Connect.",
    retry: "Didn't connect? If Facebook said the app isn't available, accept the invite first, then try again.",
    open: "Open my invites",
    again: "Try again",
  },
  hi: {
    hintBefore: "Facebook अभी AdBrain की जाँच कर रहा है। तब तक आपके Facebook अकाउंट को हमारा इनवाइट चाहिए: अपने इनवाइट खोलें और ",
    hintAfter: " स्वीकार करें, फिर Connect दबाएँ।",
    retry: "जुड़ा नहीं? अगर Facebook ने कहा कि ऐप उपलब्ध नहीं है, तो पहले इनवाइट स्वीकार करें, फिर दोबारा कोशिश करें।",
    open: "मेरे इनवाइट खोलें",
    again: "फिर से कोशिश करें",
  },
} satisfies Record<AppLocale, Record<string, string>>;

/**
 * #1989 (CPO #1983): before App Review only Testers can log in, and anyone else gets Meta's "app not available"
 * page inside the Facebook window, which AdBrain can't detect. Before the first tap say so; once the owner is
 * back with nothing connected, say what to do and offer Connect again.
 */
function TesterInviteHint({ tried, locale, onRetry }: { tried: boolean; locale: AppLocale; onRetry: () => void }) {
  const words = inviteWords[locale];
  const invites = <a href={INVITES_URL} target="_blank" rel="noopener noreferrer" className={linkClass}>{words.open}</a>;
  if (!tried) {
    return (
      <div className="mt-1 text-sm text-slate-700">
        <p>{words.hintBefore}<strong>adBrain</strong>{words.hintAfter}</p>
        {invites}
      </div>
    );
  }
  return (
    <div role="status" className="mt-1 text-sm text-slate-950">
      <p>{words.retry}</p>
      <div className="flex flex-wrap gap-x-4">
        {invites}
        <button type="button" onClick={onRetry} className={linkClass}>{words.again}</button>
      </div>
    </div>
  );
}

/**
 * #1271 (#1251 WS1 step 3): what will run, the budget for 2 or 7 days (#1530), and a checklist whose one primary
 * walks Connect Facebook Page → Go live. Go live is one tap (4b): save the draft, review it, create it paused, then
 * turn it on as a capped run of the chosen days (setup-go-live-flow). Nothing is spent before that tap; the server enforces the cap.
 */
export function SetupGoLive({ business, ads, pageConnected, funding, whatsappNumber, weeklyCap, welcome = null, returning = false, initialDaily, words, appReviewPending = false }: {
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
  /** #1438: the owner's app language (#1901: the picture badge's and #1989's invite hint too); English without it. */
  words?: SetupWords;
  /** #1989: Meta App Review (#156) is pending, so only the app's Testers can connect (`META_APP_REVIEW_PENDING`). */
  appReviewPending?: boolean;
}) {
  const router = useRouter();
  const t = setupTranslator(words);
  const locale: AppLocale = words?.locale ?? "en";
  const rowLabels = { done: t("goLive.done"), toDo: t("goLive.toDo") };
  const [daily, setDaily] = useState<number>(initialDaily ?? BUDGET_PRESETS[0]);
  const [days, setDays] = useState<number>(SETUP_RUN_DAYS);
  const [connectOpen, setConnectOpenState] = useState(false);
  const showInviteHint = appReviewPending && !pageConnected;
  // #1989: this tab's storage, so the server (and hydration) render the before-the-tap hint.
  const connectTried = useSyncExternalStore(noSubscription,
    () => Boolean(sessionStore()?.getItem(CONNECT_TRIED_KEY)), () => false) && !connectOpen;

  useEffect(() => {
    if (pageConnected) sessionStore()?.removeItem(CONNECT_TRIED_KEY);
  }, [pageConnected]);

  function setConnectOpen(open: boolean) {
    if (open) sessionStore()?.setItem(CONNECT_TRIED_KEY, "1");
    setConnectOpenState(open);
  }
  const [step, setStep] = useState<GoLiveStep | null>(null);
  const [result, setResult] = useState<GoLiveResult | null>(null);
  const running = useRef(false);
  // #1251 CPO/Dev 2: the most it can cost includes Meta's GST, worked out as activation's reserve check does.
  const total = capWithGstPaise({ dailyRupees: daily, days }) / 100;
  const cap = weeklyCap ? weeklyCapNotice(weeklyCap.active, daily, weeklyCap.capRupees) : null;
  const areas = (business.locations ?? []).filter((place) => place.trim()).join(", ");
  const ids = ads.map((ad) => ad.id).join(",");
  const ownAccount = funding === "own";
  const payMetaRow = ownAccount || !SHOW_ADBRAIN_AD_MONEY;
  const reviewHref = `/campaigns?all=1&new=1&review=1&budget=${daily}&creatives=${ids}`;

  async function startGoLive() {
    if (running.current) return;
    running.current = true;
    setResult(null);
    try {
      const outcome = await goLive(
        { client: createMetaConnectClient(), fetch: (...args) => fetch(...args), storage: sessionStore() },
        { businessId: business.id, businessName: business.name, ads, dailyBudgetRupees: daily, capDays: days },
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
    ? { label: t("goLive.connectPage"), onClick: () => setConnectOpen(true) }
    : result?.kind === "live"
      ? { label: t("goLive.openCampaign"), href: "/campaigns?all=1" }
      : {
          label: t("goLive.goLive", { amount: formatMoney(daily) }),
          disabled: Boolean(cap?.exceeds) || step !== null,
          onClick: () => void startGoLive(),
        };

  return (
    <SetupSpine step={3} primary={primary} again={returning} words={words}>
      {/* #1587: a readable column at 1440, not the full width. */}
      <div className="max-w-2xl">
      <h2 className="text-xl font-semibold text-slate-950">{t("step3")}</h2>
      <dl className="mt-4 flex flex-col gap-4 text-sm">
        <div>
          <dt className="text-slate-500">{t("goLive.adsPicked", { n: ads.length })}</dt>
          <dd className="mt-2 flex flex-wrap gap-2">
            {ads.map((ad) => ad.image_url && (
              <figure key={ad.id} className="flex flex-col items-start gap-1">
                <img src={creativeThumbnailUrl(ad.image_url)} alt={ad.headline ?? t("goLive.yourAd")} className="h-16 w-16 rounded-md bg-slate-100 object-cover" />
                <PictureSourceBadge generation={ad.generation} locale={locale} />
              </figure>
            ))}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">{t("goLive.budget")}</dt>
          <dd className="mt-1 font-medium text-slate-950">{t("goLive.budgetLine", { daily: formatMoney(daily), days, total: formatMoney(total) })}</dd>
          {/* #2007: a capped run is a lifetime budget, so Meta paces the total, not each day. The total isn't repeated (#1587). */}
          <dd className="mt-1 text-slate-600">{t("pacing", { d: formatMoney(daily) })}</dd>
          <dd className="mt-2"><div className="flex flex-wrap gap-2" role="group" aria-label={t("goLive.dailyBudget")}>
            {BUDGET_PRESETS.map((amount, index) => (
              <button key={amount} type="button" aria-pressed={daily === amount} aria-label={t("goLive.perDay", { amount: formatMoney(amount) })} disabled={step !== null || result?.kind === "live"}
                onClick={() => { setDaily(amount); setResult(null); }}
                className={cn("min-h-11 rounded-full border px-4 text-sm font-medium",
                  daily === amount ? "border-primary bg-primary/10 text-primary" : "border-slate-300 bg-white text-slate-700")}>
                {/* #1587: one solid primary on the step; 'a day' once, so the chips fit one row at 390. */}
                {index === 0 ? t("goLive.perDay", { amount: formatMoney(amount) }) : formatMoney(amount)}
              </button>
            ))}
          </div></dd>
          <dd className="mt-2"><div className="flex flex-wrap gap-2" role="group" aria-label={t("goLive.runDays")}>
            {SETUP_RUN_DAY_CHOICES.map((choice) => (
              <button key={choice} type="button" aria-pressed={days === choice} disabled={step !== null || result?.kind === "live"}
                onClick={() => { setDays(choice); setResult(null); }}
                className={cn("min-h-11 rounded-full border px-4 text-sm font-medium",
                  days === choice ? "border-primary bg-primary/10 text-primary" : "border-slate-300 bg-white text-slate-700")}>
                {t("goLive.dayChoice", { days: choice })}
              </button>
            ))}
          </div></dd>
          <dd><WeeklyCapLine notice={cap} className="mt-2" /></dd>
        </div>
        <div>
          <dt className="text-slate-500">{t("goLive.where")}</dt>
          <dd className="mt-1 font-medium text-slate-950">{areas || t("goLive.whereFallback")}</dd>
        </div>
        <div>
          <dt className="text-slate-500">{t("goLive.whenTap")}</dt>
          <dd className="mt-1 font-medium text-slate-950">
            {whatsappNumber ? t("goLive.messageAt", { number: whatsappNumber }) : t("goLive.message")}
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
          {t("goLive.changeWho")}
        </Link>
      )}

      <ul aria-label={t("goLive.before")} className="mt-4 divide-y divide-slate-200 border-y border-slate-200">
        <Row labels={rowLabels} done={pageConnected} title={t("goLive.page")} status={pageConnected ? t("goLive.connected") : t("goLive.notConnected")}
          action={showInviteHint ? <TesterInviteHint tried={connectTried} locale={locale} onRetry={() => setConnectOpen(true)} /> : undefined} />
        {payMetaRow ? (
          returning ? <Row labels={rowLabels} done title={t("goLive.payMeta")} status={t("goLive.payLast")} /> : <Row labels={rowLabels} done={false} title={t("goLive.payMeta")} status={t("goLive.payAdd")}
            action={<a href="https://business.facebook.com/billing_hub/payment_settings" target="_blank" rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline underline-offset-4">{t("goLive.payLink")}</a>} />
        ) : (
          // Off until the flat-price switch (SHOW_ADBRAIN_AD_MONEY); its words get Hindi when it turns on.
          <Row labels={rowLabels} done={false} title="Ad money" status="Pay by UPI or card"
            action={<Link href="/settings" className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline underline-offset-4">Add money</Link>} />
        )}
        <Row labels={rowLabels} done title={t("goLive.stopsAt", { total: formatMoney(total) })} status={t("goLive.stopsDetail", { days, daily: formatMoney(daily) })} />
      </ul>
      <p className="mt-4 text-sm text-slate-600">{t("goLive.metaChecks")}</p>
      {/* #718 (CEO, path A): AdBrain's own price, said before the first Go live. */}
      {ownAccount && !returning && <p className="mt-3 text-sm text-slate-600">{t("goLive.price")}</p>}
      {/* #1292: the Connect moment's trust line, next to the Connect Facebook Page primary. */}
      {!pageConnected && funding && <p className="mt-3 text-sm font-medium text-slate-800">{t(funding === "managed" ? "goLive.trustManaged" : "goLive.trustOwn")}</p>}

      {step && <p role="status" className="mt-4 text-sm font-medium text-slate-950">{t(`goLive.steps.${step}`)}</p>}
      {result?.kind === "live" && (
        <p role="status" className="mt-4 text-sm font-medium text-slate-950">{t("goLive.live")}</p>
      )}
      {result?.kind === "blocked" && (
        <div role="alert" className="mt-4 text-sm text-slate-950">
          <ul className="list-disc pl-5">{result.messages.map((message) => <li key={message}>{message}</li>)}</ul>
          <Link href={reviewHref} className={linkClass}>{t("goLive.fixInReview")}</Link>
        </div>
      )}
      {result?.kind === "refused" && (
        <div role="alert" className="mt-4 text-sm text-slate-950">
          <p>{result.message}</p>
          <p className="mt-1">{t("goLive.savedPaused")}</p>
          <Link href="/campaigns?all=1" className={linkClass}>{t("goLive.openCampaigns")}</Link>
        </div>
      )}
      {result?.kind === "failed" && <p role="alert" className="mt-4 text-sm text-slate-950">{result.message}</p>}

      {connectOpen && (
        <MetaConnectDialog businessId={business.id} intent={{ kind: "setup" }} open={connectOpen}
          onClose={() => setConnectOpen(false)}
          onConnected={() => { sessionStore()?.removeItem(CONNECT_TRIED_KEY); setConnectOpen(false); router.refresh(); }} />
      )}
      </div>
    </SetupSpine>
  );
}
