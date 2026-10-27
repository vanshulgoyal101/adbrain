import type { ReviewDTO } from "@/lib/campaign/connect-contracts";
import { WhatsAppPreview } from "@/components/whatsapp-message-card";

type Message = NonNullable<ReviewDTO["whatsappMessage"]>;
type Language = "en" | "hi" | "hinglish" | "pa";

const LANGUAGE_NAMES: Record<Language, string> = { en: "English", hi: "Hindi", hinglish: "Hinglish", pa: "Punjabi" };
const SOURCE: Record<Message["source"], string> = { edited: "Edited for this campaign", saved: "Your saved message", suggested: "Suggested by AdBrain" };

/** One plain line for what the customer sees after tapping, e.g. "…a Call now button, and 'Can I get more info on this' ready to send." */
export function whenTheyTapLine(message: Message): string {
  const questions = message.iceBreakers ?? [];
  if (questions.length) return `Customers see your welcome and ${questions.length === 1 ? "a question" : `${questions.length} questions`} to tap: ${questions.map((question) => `'${question}'`).join(", ")}.`;
  const ready = message.autofill ? `'${message.autofill}' ready to send` : "";
  if (message.callButton) return ready ? `Customers see your welcome, a Call now button, and ${ready}.` : "Customers see your welcome and a Call now button.";
  return ready ? `Customers see your welcome and ${ready}.` : "Customers see your welcome.";
}

/**
 * #840: Review's "When they tap": the WhatsApp message this launch sends, as a preview and one
 * line. A message in another language than the ads gets a soft note; it never blocks.
 */
export function WhenTheyTap({ message, businessName, adsLanguage, onEdit }: { message: Message; businessName: string; adsLanguage: Language; onEdit: () => void }) {
  const mismatch = message.language && message.language !== adsLanguage;
  return <section aria-label="When they tap" className="mt-3 grid gap-3 rounded-lg border border-slate-200 bg-white p-3 font-normal text-slate-800 sm:grid-cols-[1fr_220px]">
    <div className="min-w-0">
      <p className="text-sm font-semibold text-slate-950">When they tap <span className="font-normal text-slate-500">· {SOURCE[message.source]}</span></p>
      <p className="mt-1 break-words text-sm">{whenTheyTapLine(message)}</p>
      {mismatch && <p className="mt-2 text-sm text-amber-800">
        Your ads are in {LANGUAGE_NAMES[adsLanguage]}; your WhatsApp message is in {LANGUAGE_NAMES[message.language!]}.{" "}
        <button type="button" onClick={onEdit} className="font-medium text-blue-700 underline">Edit</button>
      </p>}
    </div>
    <WhatsAppPreview businessName={businessName} greeting={message.greeting} button={message.iceBreakers?.length ? "questions" : message.callButton ? "call" : "none"} questions={message.iceBreakers ?? []} prefill={message.iceBreakers?.length ? "" : message.autofill} />
  </section>;
}
