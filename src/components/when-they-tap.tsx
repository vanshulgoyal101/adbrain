import type { ReviewDTO } from "@/lib/campaign/connect-contracts";
import { WhatsAppPreview, type PreviewAd, type WhatsAppMessageWords } from "@/components/whatsapp-message-card";
import { whatsappMessageTranslator } from "@/i18n/words";
import { handoffLine, isGenericAsk, type Handoff } from "@/lib/campaign/whatsapp-handoff";

type Message = NonNullable<ReviewDTO["whatsappMessage"]>;
type Language = "en" | "hi" | "hinglish" | "pa";

/**
 * One plain line for what the customer sees after tapping, e.g. "…a Call now button, and 'Can I get more info on this' ready to send."
 * #2749/#1438: in the owner's language on step 3 and on Campaigns' review; English without words.
 */
export function whenTheyTapLine(message: Message, t = whatsappMessageTranslator()): string {
  const quote = (text: string) => `'${text}'`;
  const questions = message.iceBreakers ?? [];
  if (questions.length) return t("tap.questions", { n: questions.length, questions: questions.map(quote).join(", ") });
  const text = message.autofill ? quote(message.autofill) : "";
  if (message.callButton) return text ? t("tap.callReady", { text }) : t("tap.call");
  return text ? t("tap.ready", { text }) : t("tap.welcome");
}

/**
 * #840: Review's "When they tap": the WhatsApp message this launch sends, as a preview and one
 * line. A message in another language than the ads gets a soft note; it never blocks.
 * #1081: the business's past open → message rate, and a note when the pre-typed ask is too general.
 */
export function WhenTheyTap({ message, businessName, adsLanguage, onEdit, handoff = null, offers = [], ad = null, words }: {
  message: Message; businessName: string; adsLanguage: Language; onEdit: () => void; handoff?: Handoff | null; offers?: string[];
  /** The campaign's first ad, quoted in the preview's message box like WhatsApp does. */
  ad?: PreviewAd | null;
  /** #1438: the section's words in the owner's language; English without. */
  words?: WhatsAppMessageWords;
}) {
  const t = whatsappMessageTranslator(words);
  const mismatch = message.language && message.language !== adsLanguage;
  const generic = !message.iceBreakers?.length && isGenericAsk(message.autofill, offers);
  return <section aria-label={t("tap.title")} className="mt-3 grid gap-3 rounded-lg border border-slate-200 bg-white p-3 font-normal text-slate-800 sm:grid-cols-[1fr_220px]">
    <div className="min-w-0">
      <p className="text-sm font-semibold text-slate-950">{t("tap.title")} <span className="font-normal text-slate-500">· {t(`tap.source.${message.source}`)}</span></p>
      <p className="mt-1 break-words text-sm">{whenTheyTapLine(message, t)}</p>
      {handoff && <p className="mt-1 text-sm text-slate-600">{handoffLine(handoff, t)}</p>}
      {generic && <p className="mt-2 text-sm text-amber-800">
        {t("tap.generic", { ask: message.autofill })}
        {!mismatch && <>{" "}<button type="button" onClick={onEdit} className="font-medium text-blue-700 underline">{t("tap.edit")}</button></>}
      </p>}
      {mismatch && <p className="mt-2 text-sm text-amber-800">
        {t("tap.mismatch", { ads: t(`languages.${adsLanguage}`), message: t(`languages.${message.language!}`) })}{" "}
        <button type="button" onClick={onEdit} className="font-medium text-blue-700 underline">{t("tap.edit")}</button>
      </p>}
    </div>
    <WhatsAppPreview businessName={businessName} greeting={message.greeting} button={message.iceBreakers?.length ? "questions" : message.callButton ? "call" : "none"} questions={message.iceBreakers ?? []} prefill={message.iceBreakers?.length ? "" : message.autofill} ad={ad} words={words} />
  </section>;
}
