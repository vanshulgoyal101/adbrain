/**
 * #2274: a WhatsApp ad's picture prints the Brand phone, but the chat opens the Page's WhatsApp
 * number. When they differ, Prepare redraws the picture's phone with the chat number (no AI, $0).
 * Never a blocker: a failed redraw leaves the ad as it is and says so in one line.
 */

const digits = (value: string) => value.replace(/\D/g, "");

/** True when the printed phone is a different number from the chat's E.164 number. */
export function printedNumberDiffers(printed: string | null | undefined, chatNumber: string): boolean {
  const shown = digits(printed ?? "");
  if (!shown) return false;
  const chat = digits(chatNumber);
  if (printed!.trim().startsWith("+")) return shown !== chat;
  // Printed without a country code ("98765 44842", "098765 44842"): match the national digits.
  const national = shown.replace(/^0+/, "");
  return national.length < 6 || !chat.endsWith(national);
}

/** The chat number as the picture prints it: "+91 98765 44842" for India, the E.164 form otherwise. */
export function printableChatNumber(chatNumber: string): string {
  const india = /^\+91(\d{5})(\d{5})$/.exec(chatNumber);
  return india ? `+91 ${india[1]} ${india[2]}` : chatNumber;
}

export const chatNumberNotice = (chatNumber: string) =>
  `Your pictures now show your WhatsApp number …${digits(chatNumber).slice(-4)}, the one the chat opens.`;

/** Review's note that Prepare redrew pictures, so the page reloads the ads to show them. */
export const redrewChatNumber = (notes: string[] | undefined) => Boolean(notes?.some((note) => note.startsWith("Your pictures now show your WhatsApp number")));

export const chatNumberStaleNotice = (chatNumber: string) =>
  `A picture still shows a different phone from your WhatsApp number …${digits(chatNumber).slice(-4)}. Edit the phone on the ad's picture.`;

export type PrintedCreative = { id: string; imageUrl: string | null; printedPhone?: string | null };

/**
 * Redraws every picture whose printed phone differs from the chat number. `redraw` returns the new
 * picture's URL, or null when it can't redraw (no background, image-only); a throw counts as null.
 */
export async function alignPrintedNumbers<T extends PrintedCreative>(
  creatives: T[],
  chatNumber: string,
  redraw: (creative: T, phone: string) => Promise<string | null>,
): Promise<{ creatives: T[]; notice: string | null }> {
  const phone = printableChatNumber(chatNumber);
  let redrawn = 0;
  let stale = 0;
  const aligned = await Promise.all(creatives.map(async (creative) => {
    if (!printedNumberDiffers(creative.printedPhone, chatNumber)) return creative;
    const imageUrl = await redraw(creative, phone).catch(() => null);
    if (!imageUrl) {
      stale += 1;
      return creative;
    }
    redrawn += 1;
    return { ...creative, imageUrl, printedPhone: phone };
  }));
  const notice = stale ? chatNumberStaleNotice(chatNumber) : redrawn ? chatNumberNotice(chatNumber) : null;
  return { creatives: aligned, notice };
}
