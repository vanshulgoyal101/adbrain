"use client";

import { Suspense, use, useState, useTransition } from "react";
import { Phone } from "lucide-react";
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
    <div className="mt-4 grid gap-5 lg:grid-cols-[1fr_260px]">
      <div className="grid min-w-0 gap-4">
        <WhatsAppMessageFields value={draft} onWords={onWords} onLanguage={onLanguage} allowAuto={!hasSaved} fieldError={fieldError} firstOffer={firstOffer} callNumber={callNumber} />
        {message?.ok && <Alert>{message.text}</Alert>}
        {message && !message.ok && !message.field && <Alert variant="error">{message.text}</Alert>}
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" disabled={pending} onClick={() => save(templateFromDraft(draft))}>Save WhatsApp message</Button>
          {hasSaved && <Button type="button" variant="outline" disabled={pending} onClick={() => save(null)}>Reset to suggested</Button>}
        </div>
      </div>
      <DraftPreview businessName={businessName} draft={draft} />
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
export function WhatsAppPreview({ businessName, greeting, button, questions, prefill }: { businessName: string; greeting: string; button: ButtonKind; questions: string[]; prefill: string }) {
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
