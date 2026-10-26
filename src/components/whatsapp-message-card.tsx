"use client";

import { Suspense, use, useState, useTransition } from "react";
import { Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { saveWhatsAppTemplate } from "@/app/(app)/brand/whatsapp-template-actions";
import { ICE_BREAKER_LIMITS } from "@/lib/meta/limits";
import { whatsappTemplateSchema, type WhatsAppTemplate } from "@/lib/campaign/whatsapp-template";

type Language = WhatsAppTemplate["language"];
type Suggested = Record<Language, { greeting: string; prefill: string }>;
type Button = "none" | "call" | "questions";

const LANGUAGES: [Language | "auto", string][] = [["auto", "Auto (follows each ad)"], ["en", "English"], ["hi", "Hindi"], ["hinglish", "Hinglish"], ["pa", "Punjabi"]];
const LIMIT = 300;

/**
 * #840: the business's WhatsApp message, the opening a customer sees after tapping an ad. Not the
 * WhatsApp Business app's own greeting. Saving never touches a running campaign.
 */
export function WhatsAppMessageCard({ businessId, businessName, saved, suggested, firstOffer, callNumber }: {
  businessId: string;
  businessName: string;
  saved: unknown;
  suggested: Suggested;
  firstOffer?: string | null;
  /** The masked number the Call now button rings (the Page's WhatsApp), read from Meta after the card shows. */
  callNumber?: Promise<string | null>;
}) {
  const initial = whatsappTemplateSchema.safeParse(saved);
  const savedTemplate = initial.success ? initial.data : null;
  // Until the owner saves, each campaign writes its message in its ad's language ("auto").
  const [language, setLanguage] = useState<Language | "auto">(savedTemplate?.language ?? "auto");
  const [greeting, setGreeting] = useState(savedTemplate?.greeting ?? suggested.en.greeting);
  const [prefill, setPrefill] = useState(savedTemplate?.opening.kind === "prefill" ? savedTemplate.opening.prefill : suggested.en.prefill);
  const [button, setButton] = useState<Button>(savedTemplate?.opening.kind === "ice_breakers" ? "questions" : savedTemplate?.opening.kind === "prefill" && savedTemplate.opening.callButton ? "call" : "none");
  const [questions, setQuestions] = useState<string[]>(savedTemplate?.opening.kind === "ice_breakers" ? [...savedTemplate.opening.questions, "", "", ""].slice(0, 3) : ["", "", ""]);
  const [hasSaved, setHasSaved] = useState(Boolean(savedTemplate));
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string; field?: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const filled = questions.map((question) => question.trim()).filter(Boolean);
  const template = (): WhatsAppTemplate => ({
    greeting, language: language === "auto" ? "en" : language,
    opening: button === "questions" ? { kind: "ice_breakers", questions: filled } : { kind: "prefill", prefill, callButton: button === "call" },
  });
  const edit = (apply: () => void) => { apply(); setDirty(true); setMessage(null); };
  const pickLanguage = (next: Language | "auto") => {
    setLanguage(next);
    setMessage(null);
    // A suggested message follows the language; the owner's own words stay as typed.
    const words = suggested[next === "auto" ? "en" : next];
    if (!hasSaved) { setGreeting(words.greeting); setPrefill(words.prefill); }
    if (hasSaved) setDirty(true);
  };
  const save = (value: WhatsAppTemplate | null) => startTransition(async () => {
    const result = await saveWhatsAppTemplate({ businessId, template: value });
    if (!result.ok) { setMessage({ ok: false, text: result.error ?? "Couldn't save.", field: result.field }); return; }
    if (!value) { setLanguage("auto"); setGreeting(suggested.en.greeting); setPrefill(suggested.en.prefill); setButton("none"); setQuestions(["", "", ""]); }
    if (value) setLanguage(value.language);
    setHasSaved(Boolean(value));
    setDirty(false);
    setMessage({ ok: true, text: value ? "Saved. New WhatsApp campaigns will use it." : "Back to the suggested message." });
  });
  const offer = firstOffer?.trim();
  const questionExample = offer && [...offer].length <= ICE_BREAKER_LIMITS.chars ? offer : "What's the price?";
  const fieldError = (field: string) => message && !message.ok && message.field === field ? message.text : null;

  return <section aria-labelledby="whatsapp-message-title" className="rounded-xl border border-slate-200 bg-white p-4">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h3 id="whatsapp-message-title" className="text-base font-semibold text-slate-950">WhatsApp message</h3>
      <span className="text-xs font-medium text-slate-500">{dirty ? "Unsaved changes" : hasSaved ? "Your message" : "Suggested"}</span>
    </div>
    <p className="mt-1 text-sm text-slate-600">What customers see after tapping your ad. Your WhatsApp Business app greeting is separate.</p>
    <div className="mt-4 grid gap-5 lg:grid-cols-[1fr_260px]">
      <div className="grid gap-4">
        <div className="grid gap-1">
          <label className="grid gap-1 text-sm font-medium text-slate-800">Language
            <select value={language} aria-describedby={language === "auto" ? "whatsapp-language-auto" : undefined} onChange={(event) => pickLanguage(event.target.value as Language | "auto")} className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm">
              {LANGUAGES.filter(([value]) => value !== "auto" || !hasSaved).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          {language === "auto" && <span id="whatsapp-language-auto" className="text-xs text-slate-500">Each campaign writes its message in its ad&apos;s language. Saving keeps these words for every campaign.</span>}
        </div>
        <label className="grid gap-1 text-sm font-medium text-slate-800">Welcome message
          <textarea value={greeting} maxLength={LIMIT} rows={3} aria-invalid={Boolean(fieldError("greeting"))} onChange={(event) => edit(() => setGreeting(event.target.value))} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal" />
          <span className="text-xs font-normal text-slate-500">{[...greeting].length}/{LIMIT}</span>
          {fieldError("greeting") && <span role="alert" className="text-xs font-normal text-red-700">{fieldError("greeting")}</span>}
        </label>
        <fieldset className="grid gap-2">
          <legend className="text-sm font-medium text-slate-800">Button</legend>
          <div className="flex flex-wrap gap-2">
            {([["none", "None"], ["call", "Call now"], ["questions", "Quick questions"]] as const).map(([value, label]) =>
              <label key={value} className="flex min-h-10 cursor-pointer items-center gap-2 rounded-md border border-slate-200 px-3 text-sm"><input type="radio" name="whatsapp-button" checked={button === value} onChange={() => edit(() => setButton(value))} className="accent-blue-600" />{label}</label>)}
          </div>
          {button === "call" && <p className="text-xs text-slate-600">
            <Suspense fallback="Calls go to the WhatsApp number on your ads.">{callNumber ? <CallsGoTo number={callNumber} /> : "Calls go to the WhatsApp number on your ads."}</Suspense>
            {" "}Pick up during ad hours, or a missed call costs you the enquiry.</p>}
          {button === "questions" && <div className="grid gap-2">
            {questions.map((question, index) => <input key={index} value={question} maxLength={ICE_BREAKER_LIMITS.chars} aria-label={`Question ${index + 1}`} placeholder={index === 0 ? `e.g. ${questionExample}` : "Optional"}
              onChange={(event) => edit(() => setQuestions((current) => current.map((value, i) => i === index ? event.target.value : value)))} className="h-10 rounded-lg border border-slate-300 px-3 text-sm" />)}
            <span className="text-xs text-slate-500">Customers tap a question; there&apos;s no pre-typed message.</span>
            {fieldError("questions") && <span role="alert" className="text-xs text-red-700">{fieldError("questions")}</span>}
          </div>}
        </fieldset>
        {button !== "questions" && <label className="grid gap-1 text-sm font-medium text-slate-800">Pre-typed message
          <textarea value={prefill} maxLength={LIMIT} rows={2} aria-invalid={Boolean(fieldError("prefill"))} onChange={(event) => edit(() => setPrefill(event.target.value))} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal" />
          <span className="text-xs font-normal text-slate-500">Short, in the customer&apos;s words. One question.</span>
          {fieldError("prefill") && <span role="alert" className="text-xs font-normal text-red-700">{fieldError("prefill")}</span>}
        </label>}
        {message?.ok && <Alert>{message.text}</Alert>}
        {message && !message.ok && !message.field && <Alert variant="error">{message.text}</Alert>}
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" disabled={pending} onClick={() => save(template())}>Save WhatsApp message</Button>
          {hasSaved && <Button type="button" variant="outline" disabled={pending} onClick={() => save(null)}>Reset to suggested</Button>}
        </div>
      </div>
      <WhatsAppPreview businessName={businessName} greeting={greeting} button={button} questions={filled} prefill={button === "questions" ? "" : prefill} />
    </div>
  </section>;
}

function CallsGoTo({ number }: { number: Promise<string | null> }) {
  const resolved = use(number);
  return resolved ? <>Calls go to <span className="whitespace-nowrap font-medium">{resolved}</span>, your Page&apos;s WhatsApp, unless a campaign picks another number.</> : <>Calls go to the WhatsApp number on your ads.</>;
}

/** A phone-shaped preview of the chat, updating as the owner types. */
export function WhatsAppPreview({ businessName, greeting, button, questions, prefill }: { businessName: string; greeting: string; button: Button; questions: string[]; prefill: string }) {
  return <figure aria-label="WhatsApp preview" className="mx-auto w-full max-w-[260px] overflow-hidden rounded-[1.5rem] border-4 border-slate-800 bg-[#efeae2] text-sm">
    <figcaption className="bg-[#075e54] px-3 py-2 font-semibold text-white">{businessName}</figcaption>
    <div className="grid min-h-48 content-start gap-2 p-3">
      <div className="max-w-[90%] whitespace-pre-wrap break-words rounded-lg bg-white px-3 py-2 text-slate-900 shadow-sm">{greeting || " "}</div>
      {button === "call" && <div className="flex max-w-[90%] items-center justify-center gap-1.5 rounded-lg bg-white px-3 py-1.5 font-medium text-[#027eb5] shadow-sm"><Phone size={14} aria-hidden="true" />Call now</div>}
      {button === "questions" && questions.map((question) => <div key={question} className="max-w-[90%] break-words rounded-lg bg-white px-3 py-1.5 text-center font-medium text-[#027eb5] shadow-sm">{question}</div>)}
    </div>
    {prefill && <div className="border-t border-slate-300 bg-white px-3 py-2 text-slate-700"><span className="sr-only">Ready to send: </span>{prefill}</div>}
  </figure>;
}
