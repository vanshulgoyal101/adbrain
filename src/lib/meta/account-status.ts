/**
 * #1943 (CPO brief, #1925): Meta's ad account `account_status` in plain words with one action. Every status but 1
 * (ACTIVE) blocks Go live. Never says "risk", "policy violation" or "flagged"; Meta's own `disable_reason` belongs
 * under Details only.
 */
export type AdAccountAction =
  | { kind: "open_meta"; url: string; label: string; labelHi: string }
  | { kind: "choose_assets"; label: string; labelHi: string };

export type AdAccountState = { status: number | null; en: string; hi: string; action: AdAccountAction | null; blocksGoLive: true };

const QUALITY = "https://business.facebook.com/accountquality";

function billingUrl(adAccountId?: string): string {
  const id = adAccountId?.replace(/^act_/, "");
  return `https://business.facebook.com/billing_hub/payment_activity${id && /^\d+$/.test(id) ? `?asset_id=${id}` : ""}`;
}

const UNPAID_EN = "Meta couldn't charge your card or UPI.";
const UNPAID_HI = "Meta आपके कार्ड या UPI से पैसे नहीं ले पाया।";

/** Null for an active account (status 1); otherwise what the owner sees and can do. A missing status counts as not active. */
export function adAccountState(status: number | null | undefined, adAccountId?: string): AdAccountState | null {
  if (status === 1) return null;
  const state = (en: string, hi: string, action: AdAccountAction | null): AdAccountState => ({ status: status ?? null, en, hi, action, blocksGoLive: true });
  const pay: AdAccountAction = { kind: "open_meta", url: billingUrl(adAccountId), label: "Pay in Meta", labelHi: "Meta में भुगतान करें" };
  switch (status) {
    case 2:
      return state("Meta has disabled this ad account, so ads can't run. You can ask Meta to review it.",
        "Meta ने यह विज्ञापन खाता बंद कर दिया है, इसलिए विज्ञापन नहीं चल सकते। आप Meta से दोबारा जाँच करवा सकते हैं।",
        { kind: "open_meta", url: QUALITY, label: "Ask Meta to review", labelHi: "Meta से जाँच करवाएँ" });
    case 3:
    case 8:
      return state(`${UNPAID_EN} Pay the balance in Meta and your ads can run again.`, `${UNPAID_HI} Meta में बकाया भरें, फिर विज्ञापन दोबारा चल सकेंगे।`, pay);
    case 9:
      return state(`${UNPAID_EN} Pay the balance in Meta to go live and keep your ads running.`, `${UNPAID_HI} लाइव करने और विज्ञापन चालू रखने के लिए Meta में बकाया भरें।`, pay);
    case 7:
      return state("Meta is checking this new ad account. Ads can start once it's done; there's nothing to do now.",
        "Meta इस नए विज्ञापन खाते की जाँच कर रहा है। जाँच पूरी होते ही विज्ञापन शुरू हो सकते हैं; अभी कुछ करने की ज़रूरत नहीं।", null);
    case 100:
    case 101:
      return state("This ad account is closed in Meta. Connect a different ad account.", "यह विज्ञापन खाता Meta में बंद है। कोई दूसरा विज्ञापन खाता जोड़ें।",
        { kind: "choose_assets", label: "Connect another account", labelHi: "दूसरा खाता जोड़ें" });
    default:
      return state("This ad account is not active. Check Account quality in Meta.", "यह विज्ञापन खाता चालू नहीं है। Meta में Account quality देखें।",
        { kind: "open_meta", url: QUALITY, label: "Open Account quality", labelHi: "Account quality खोलें" });
  }
}

/** The connect/Review blocker for a non-active account (same words as the checklist row). */
export function adAccountBlocker(status: number | null | undefined, adAccountId?: string) {
  const state = adAccountState(status, adAccountId);
  if (!state) return null;
  const action = state.action?.kind === "open_meta" ? { kind: "open_meta" as const, url: state.action.url, label: state.action.label }
    : state.action?.kind === "choose_assets" ? { kind: "choose_assets" as const } : null;
  return { code: "ACCOUNT_RESTRICTED" as const, message: state.en, action };
}
