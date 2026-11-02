import type { ReviewDTO } from "@/lib/campaign/connect-contracts";
import { WhatsAppPreview, type PreviewAd } from "@/components/whatsapp-message-card";
import { setupTranslator } from "@/i18n/setup-words";
import { handoffLine, isGenericAsk, type Handoff } from "@/lib/campaign/whatsapp-handoff";

type Message = NonNullable<ReviewDTO["whatsappMessage"]>;
type Language = "en" | "hi" | "hinglish" | "pa";

const LANGUAGE_NAMES: Record<Language, string> = { en: "English", hi: "Hindi", hinglish: "Hinglish", pa: "Punjabi" };
const SOURCE: Record<Message["source"], string> = { edited: "Edited for this campaign", saved: "Your saved message", suggested: "Suggested by AdBrain" };

/**
 * One plain line for what the customer sees after tapping, e.g. "…a Call now button, and 'Can I get more info on this' ready to send."
 * #2749: in the owner's language on step 3; the review on Campaigns passes nothing and reads English.
 */
export function whenTheyTapLine(message: Message, t: ReturnType<typeof setupTranslator> = setupTranslator()): string {
  const quote = (text: string) => `'${text}'`;
  const questions = message.iceBreakers ?? [];
  if (questions.length) return t("goLive.tapQuestions", { n: questions.length, questions: questions.map(quote).join(", ") });
  const text = message.autofill ? quote(message.autofill) : "";
  if (message.callButton) return text ? t("goLive.tapCallReady", { text }) : t("goLive.tapCall");
  return text ? t("goLive.tapReady", { text }) : t("goLive.tapWelcome");
}

/**
 * #840: Review's "When they tap": the WhatsApp message this launch sends, as a preview and one
 * line. A message in another language than the ads gets a soft note; it never blocks.
 * #1081: the business's past open → message rate, and a note when the pre-typed ask is too general.
 */
export function WhenTheyTap({ message, businessName, adsLanguage, onEdit, handoff = null, offers = [], ad = null }: {
  message: Message; businessName: string; adsLanguage: Language; onEdit: () => void; handoff?: Handoff | null; offers?: string[];
  /** The campaign's first ad, quoted in the preview's message box like WhatsApp does. */
  ad?: PreviewAd | null;
}) {
  const mismatch = message.language && message.language !== adsLanguage;
  const generic = !message.iceBreakers?.length && isGenericAsk(message.autofill, offers);
  return <section aria-label="When they tap" className="mt-3 grid gap-3 rounded-lg border border-slate-200 bg-white p-3 font-normal text-slate-800 sm:grid-cols-[1fr_220px]">
    <div className="min-w-0">
      <p className="text-sm font-semibold text-slate-950">When they tap <span className="font-normal text-slate-500">· {SOURCE[message.source]}</span></p>
      <p className="mt-1 break-words text-sm">{whenTheyTapLine(message)}</p>
      {handoff && <p className="mt-1 text-sm text-slate-600">{handoffLine(handoff)}</p>}
      {generic && <p className="mt-2 text-sm text-amber-800">
        &lsquo;{message.autofill}&rsquo; is general. People send a concrete, local ask more often, like your offer and your city.
        {!mismatch && <>{" "}<button type="button" onClick={onEdit} className="font-medium text-blue-700 underline">Edit</button></>}
      </p>}
      {mismatch && <p className="mt-2 text-sm text-amber-800">
        Your ads are in {LANGUAGE_NAMES[adsLanguage]}; your WhatsApp message is in {LANGUAGE_NAMES[message.language!]}.{" "}
        <button type="button" onClick={onEdit} className="font-medium text-blue-700 underline">Edit</button>
      </p>}
    </div>
    <WhatsAppPreview businessName={businessName} greeting={message.greeting} button={message.iceBreakers?.length ? "questions" : message.callButton ? "call" : "none"} questions={message.iceBreakers ?? []} prefill={message.iceBreakers?.length ? "" : message.autofill} ad={ad} />
  </section>;
}
