"use client";

import { Suspense, use, useState, useTransition } from "react";
import { ChevronLeft, Phone, SendHorizontal } from "lucide-react";
import { creativeThumbnailUrl } from "@/lib/creative/thumbnail";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { saveWhatsAppTemplate, type WhatsAppTemplateResult } from "@/app/(app)/brand/whatsapp-template-actions";
import { ICE_BREAKER_LIMITS } from "@/lib/meta/limits";
import { whatsappTemplateSchema, type WhatsAppTemplate } from "@/lib/campaign/whatsapp-template";
import { prefillWelcome, questionsWelcome } from "@/lib/campaign/whatsapp-greeting";

type Language = WhatsAppTemplate["language"];
/** AdBrain's suggestion per language: a pre-typed message, or up to 3 questions. */
export type SuggestedOpening = { greeting: string; prefill: string; iceBreakers?: string[] };
export type Suggested = Record<Language, SuggestedOpening>;
type ButtonKind = "none" | "call" | "questions";
/** The editor's working copy of a WhatsApp message. */
export type MessageDraft = { language: Language | "auto"; greeting: string; prefill: string; button: ButtonKind; questions: string[] };

const LANGUAGES: [Language | "auto", string][] = [["auto", "Auto (follows each ad)"], ["en", "English"], ["hi", "Hindi"], ["hinglish", "Hinglish"], ["pa", "Punjabi"]];
const LIMIT = 300;
export const threeSlots = (questions: string[]) => [...questions, "", "", ""].slice(0, ICE_BREAKER_LIMITS.count);

export function draftFromTemplate(template: WhatsAppTemplate): MessageDraft {
  const { opening } = template;
  return {
    language: template.language, greeting: template.greeting,
    prefill: opening.kind === "prefill" ? opening.prefill : "",
    button: opening.kind === "ice_breakers" ? "questions" : opening.callButton ? "call" : "none",
    questions: threeSlots(opening.kind === "ice_breakers" ? opening.questions : []),
  };
}

export function draftFromSuggestion(suggested: Suggested, language: Language | "auto"): MessageDraft {
  const words = suggested[language === "auto" ? "en" : language];
  const questions = Boolean(words.iceBreakers?.length);
  return { language, greeting: questions ? questionsWelcome(words.greeting) : words.greeting, prefill: words.prefill, button: questions ? "questions" : "none", questions: threeSlots(words.iceBreakers ?? []) };
}

export function templateFromDraft(draft: MessageDraft): WhatsAppTemplate {
  return {
    greeting: draft.greeting, language: draft.language === "auto" ? "en" : draft.language,
    opening: draft.button === "questions"
      ? { kind: "ice_breakers", questions: draft.questions.map((question) => question.trim()).filter(Boolean) }
      : { kind: "prefill", prefill: draft.prefill, callButton: draft.button === "call" },
  };
}

/**
 * #840: the message's fields (language, welcome, button, questions, pre-typed message), shared by
 * the Brand card and a campaign's "Edit for this campaign".
 */
export function WhatsAppMessageFields({ value, onWords, onLanguage, allowAuto, fieldError, firstOffer, callNumber }: {
  value: MessageDraft;
  onWords: (next: MessageDraft) => void;
  onLanguage: (language: Language | "auto") => void;
  allowAuto: boolean;
  fieldError: (field: string) => string | null;
  firstOffer?: string | null;
  /** The masked number the Call now button rings (the Page's WhatsApp), read from Meta after the fields show. */
  callNumber?: Promise<string | null>;
}) {
  const offer = firstOffer?.trim();
  const questionExample = offer && [...offer].length <= ICE_BREAKER_LIMITS.chars ? offer : "What's the price?";
  const set = (patch: Partial<MessageDraft>) => onWords({ ...value, ...patch });
  // #1121: AdBrain's own welcome follows the button ("Tap a question below" vs "Send this message"); typed words stay.
  const setButton = (button: ButtonKind) => set({
    button, greeting: button === "questions" ? questionsWelcome(value.greeting) : prefillWelcome(value.greeting),
  });
  return <div className="grid min-w-0 gap-4">
    <div className="grid gap-1">
      <label className="grid gap-1 text-sm font-medium text-slate-800">Language
        <select value={value.language} aria-describedby={value.language === "auto" ? "whatsapp-language-auto" : undefined} onChange={(event) => onLanguage(event.target.value as Language | "auto")} className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm">
          {LANGUAGES.filter(([option]) => option !== "auto" || allowAuto).map(([option, label]) => <option key={option} value={option}>{label}</option>)}
        </select>
      </label>
      {value.language === "auto" && <span id="whatsapp-language-auto" className="text-xs text-slate-500">Each campaign writes its message in its ad&apos;s language. Saving keeps these words for every campaign.</span>}
    </div>
    <label className="grid gap-1 text-sm font-medium text-slate-800">Welcome message
      <textarea value={value.greeting} maxLength={LIMIT} rows={3} aria-invalid={Boolean(fieldError("greeting"))} onChange={(event) => set({ greeting: event.target.value })} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal" />
      <span className="text-xs font-normal text-slate-500">{[...value.greeting].length}/{LIMIT}</span>
      {fieldError("greeting") && <span role="alert" className="text-xs font-normal text-red-700">{fieldError("greeting")}</span>}
    </label>
    <fieldset className="grid gap-2">
      <legend className="text-sm font-medium text-slate-800">Button</legend>
      <div className="flex flex-wrap gap-2">
        {([["none", "None"], ["call", "Call now"], ["questions", "Quick questions"]] as const).map(([option, label]) =>
          <label key={option} className="flex min-h-10 cursor-pointer items-center gap-2 rounded-md border border-slate-200 px-3 text-sm"><input type="radio" name="whatsapp-button" checked={value.button === option} onChange={() => setButton(option)} className="accent-blue-600" />{label}</label>)}
      </div>
      {value.button === "call" && <p className="text-xs text-slate-600">
        <Suspense fallback="Calls go to the WhatsApp number on your ads.">{callNumber ? <CallsGoTo number={callNumber} /> : "Calls go to the WhatsApp number on your ads."}</Suspense>
        {" "}Pick up during ad hours, or a missed call costs you the enquiry.</p>}
      {value.button === "questions" && <div className="grid gap-2">
        {value.questions.map((question, index) => <input key={index} value={question} maxLength={ICE_BREAKER_LIMITS.chars} aria-label={`Question ${index + 1}`} placeholder={index === 0 ? `e.g. ${questionExample}` : "Optional"}
          onChange={(event) => set({ questions: value.questions.map((current, i) => i === index ? event.target.value : current) })} className="h-10 min-w-0 rounded-lg border border-slate-300 px-3 text-sm" />)}
        <span className="text-xs text-slate-500">Customers tap a question; there&apos;s no pre-typed message.</span>
        {fieldError("questions") && <span role="alert" className="text-xs text-red-700">{fieldError("questions")}</span>}
      </div>}
    </fieldset>
    {value.button !== "questions" && <label className="grid gap-1 text-sm font-medium text-slate-800">Pre-typed message
      <textarea value={value.prefill} maxLength={LIMIT} rows={2} aria-invalid={Boolean(fieldError("prefill"))} onChange={(event) => set({ prefill: event.target.value })} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal" />
      <span className="text-xs font-normal text-slate-500">Short, in the customer&apos;s words. One question.</span>
      {fieldError("prefill") && <span role="alert" className="text-xs font-normal text-red-700">{fieldError("prefill")}</span>}
    </label>}
  </div>;
}

/**
 * #840: the business's WhatsApp message, the opening a customer sees after tapping an ad. Not the
 * WhatsApp Business app's own greeting. Saving never touches a running campaign.
 */
export function WhatsAppMessageCard({ businessId, businessName, saved, suggested, suggestedQuestions, firstOffer, callNumber }: {
  businessId: string;
  businessName: string;
  saved: unknown;
  suggested: Suggested;
  /** #905: quick questions from the Brand, per language; they fill the empty boxes and send nothing until saved. */
  suggestedQuestions?: Record<Language, string[]>;
  firstOffer?: string | null;
  callNumber?: Promise<string | null>;
}) {
  const initial = whatsappTemplateSchema.safeParse(saved);
  // Until the owner saves, each campaign writes its message in its ad's language ("auto").
  const [draft, setDraft] = useState<MessageDraft>(initial.success ? draftFromTemplate(initial.data) : draftFromSuggestion(suggested, "auto"));
  const [hasSaved, setHasSaved] = useState(initial.success);
  // #905: true while the question boxes hold AdBrain's suggestion, so it follows the language until the owner edits it.
  const [questionsSuggested, setQuestionsSuggested] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string; field?: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const suggestionFor = (language: Language | "auto") => threeSlots(suggestedQuestions?.[language === "auto" ? "en" : language] ?? []);
  const onWords = (next: MessageDraft) => {
    // #905: choosing Quick questions with empty boxes fills them with the Brand's suggestion; typing ends it.
    if (next.button === "questions" && draft.button !== "questions" && suggestedQuestions && next.questions.every((question) => !question.trim())) {
      next = { ...next, questions: suggestionFor(next.language) };
      setQuestionsSuggested(true);
    } else if (next.questions !== draft.questions) setQuestionsSuggested(false);
    setDraft(next); setDirty(true); setMessage(null);
  };
  const onLanguage = (language: Language | "auto") => {
    setMessage(null);
    // A suggested message follows the language; the owner's own words stay as typed.
    const words = suggested[language === "auto" ? "en" : language];
    setDraft((current) => ({ ...current, language, ...(hasSaved ? {} : { greeting: current.button === "questions" ? questionsWelcome(words.greeting) : words.greeting, prefill: words.prefill }), ...(questionsSuggested ? { questions: suggestionFor(language) } : {}) }));
    if (hasSaved) setDirty(true);
  };
  const save = (value: WhatsAppTemplate | null) => startTransition(async () => {
    // #920: a dropped connection rejects; it must not reach the error boundary and lose the owner's words.
    const result = await saveWhatsAppTemplate({ businessId, template: value })
      .catch((): WhatsAppTemplateResult => ({ ok: false, error: "Couldn't save your WhatsApp message. Try again." }));
    if (!result.ok) { setMessage({ ok: false, text: result.error ?? "Couldn't save.", field: result.field }); return; }
    setDraft(value ? draftFromTemplate(value) : draftFromSuggestion(suggested, "auto"));
    setQuestionsSuggested(false);
    setHasSaved(Boolean(value));
    setDirty(false);
    setMessage({ ok: true, text: value ? "Saved. New WhatsApp campaigns will use it." : "Back to the suggested message." });
  });
  const fieldError = (field: string) => message && !message.ok && message.field === field ? message.text : null;

  return <section aria-labelledby="whatsapp-message-title" className="rounded-xl border border-slate-200 bg-white p-4">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h3 id="whatsapp-message-title" className="text-base font-semibold text-slate-950">WhatsApp message</h3>
      <span className="text-xs font-medium text-slate-500">{dirty ? "Unsaved changes" : hasSaved ? "Your message" : "Suggested"}</span>
    </div>
    <p className="mt-1 text-sm text-slate-600">What customers see after tapping your ad. Your WhatsApp Business app greeting is separate.</p>
    {/* On a phone the preview sits between the fields and Save, so the owner sees the chat before saving it. */}
    <div className="mt-4 grid gap-5 lg:grid-cols-[1fr_260px] lg:grid-rows-[auto_1fr]">
      <div className="grid min-w-0 gap-4">
        <WhatsAppMessageFields value={draft} onWords={onWords} onLanguage={onLanguage} allowAuto={!hasSaved} fieldError={fieldError} firstOffer={firstOffer} callNumber={callNumber} />
      </div>
      <div className="lg:col-start-2 lg:row-span-2 lg:row-start-1"><DraftPreview businessName={businessName} draft={draft} /></div>
      <div className="grid min-w-0 content-start gap-4">
        {message?.ok && <Alert>{message.text}</Alert>}
        {message && !message.ok && !message.field && <Alert variant="error">{message.text}</Alert>}
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" disabled={pending} onClick={() => save(templateFromDraft(draft))}>Save WhatsApp message</Button>
          {hasSaved && <Button type="button" variant="outline" disabled={pending} onClick={() => save(null)}>Reset to suggested</Button>}
        </div>
      </div>
    </div>
  </section>;
}

function CallsGoTo({ number }: { number: Promise<string | null> }) {
  const resolved = use(number);
  return resolved ? <>Calls go to <span className="whitespace-nowrap font-medium">{resolved}</span>, your Page&apos;s WhatsApp, unless a campaign picks another number.</> : <>Calls go to the WhatsApp number on your ads.</>;
}

export function DraftPreview({ businessName, draft }: { businessName: string; draft: MessageDraft }) {
  const questions = draft.questions.map((question) => question.trim()).filter(Boolean);
  return <WhatsAppPreview businessName={businessName} greeting={draft.greeting} button={draft.button} questions={questions} prefill={draft.button === "questions" ? "" : draft.prefill} />;
}

/** A phone-shaped preview of the chat, updating as the owner types. */
/** The ad the customer tapped: WhatsApp quotes it above their first message. */
export type PreviewAd = { headline: string | null; imageUrl: string | null };

/**
 * #840/#847: what the customer's phone shows after tapping the ad, drawn like WhatsApp: the business
 * header, your welcome, the Call now button or the quick questions, and the pre-typed message waiting
 * in the message box (quoting the ad when Review knows which one).
 */
export function WhatsAppPreview({ businessName, greeting, button, questions, prefill, ad = null }: { businessName: string; greeting: string; button: ButtonKind; questions: string[]; prefill: string; ad?: PreviewAd | null }) {
  const initial = [...businessName.trim()][0]?.toUpperCase() ?? "";
  return <figure aria-label="WhatsApp preview" className="mx-auto flex min-h-[22rem] w-full max-w-[260px] flex-col overflow-hidden rounded-[1.75rem] border-[6px] border-slate-900 bg-[#efeae2] text-sm text-[#111b21]">
    <figcaption className="flex items-center gap-2 border-b border-[#e9edef] bg-white px-2 py-2">
      <ChevronLeft size={18} aria-hidden="true" className="shrink-0 text-[#54656f]" />
      <span aria-hidden="true" className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#dfe5e7] text-xs font-semibold text-[#54656f]">{initial}</span>
      <span className="min-w-0 truncate font-semibold">{businessName}</span>
    </figcaption>
    <div className="grid flex-1 content-start gap-1.5 p-2.5">
      <div className="max-w-[88%] overflow-hidden rounded-lg rounded-tl-none bg-white shadow-[0_1px_0.5px_rgba(11,20,26,0.13)]">
        <p className="whitespace-pre-wrap break-words px-2.5 py-1.5">{greeting || " "}</p>
        {button === "call" && <p className="flex items-center justify-center gap-1.5 border-t border-[#e9edef] px-2.5 py-2 font-medium text-[#027eb5]"><Phone size={14} aria-hidden="true" />Call now</p>}
      </div>
      {button === "questions" && <ul aria-label="Questions to tap" className="grid max-w-[88%] gap-1">
        {questions.map((question) => <li key={question} className="break-words rounded-lg bg-white px-2.5 py-1.5 text-center font-medium text-[#027eb5] shadow-[0_1px_0.5px_rgba(11,20,26,0.13)]">{question}</li>)}
      </ul>}
    </div>
    <div className="flex items-end gap-1.5 p-2">
      <div className="min-w-0 flex-1 overflow-hidden rounded-[1.25rem] bg-white">
        {prefill && ad?.headline && <div className="m-1 mb-0 flex items-center gap-2 overflow-hidden rounded-lg border-l-4 border-[#1daa61] bg-[#f0f2f5] py-1 pl-2 pr-1">
          <span className="min-w-0 flex-1 truncate text-xs text-[#54656f]">{ad.headline}</span>
          {ad.imageUrl && <img src={creativeThumbnailUrl(ad.imageUrl)} alt="" width={32} height={32} loading="lazy" className="h-8 w-8 shrink-0 rounded object-cover" />}
        </div>}
        {prefill
          ? <p className="break-words px-3 py-2"><span className="sr-only">Ready to send: </span>{prefill}</p>
          : <p aria-hidden="true" className="px-3 py-2 text-[#667781]">Message</p>}
      </div>
      <span aria-hidden="true" className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#1daa61] text-white"><SendHorizontal size={16} /></span>
    </div>
  </figure>;
}
