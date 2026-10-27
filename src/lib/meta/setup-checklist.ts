/**
 * #1016 (#795 slice 1): after Connect, five things an owner needs before a launch can deliver, each
 * ✓ or one action with a Meta link and a Hindi/English line. Read-only; nothing here changes Meta.
 * Client-safe: the Settings section renders it, `MetaClient.setupReads()` supplies the reads.
 */
export type SetupReads = {
  /** The ad account's business portfolio, or null when the account isn't in one. */
  portfolio: { id: string; name: string | null } | null;
  accountActive: boolean;
  currency: string | null;
  /** Meta has a card, UPI or prepaid balance on the ad account (`funding_source_details`). */
  paymentMethod: boolean;
  /** This Facebook login can see the connected Page. */
  pageListed: boolean;
  /** Ads can use a WhatsApp number: the Page's own, or one on the portfolio's WhatsApp Business account. */
  whatsapp: boolean;
};

export type SetupRowKey = "portfolio" | "adAccount" | "page" | "whatsapp" | "payment";
export type SetupAction = { label: string; href: string; en: string; hi: string };
export type SetupRow = { key: SetupRowKey; label: string; done: boolean; detail?: string; action?: SetupAction };

export function setupChecklistEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.META_SETUP_CHECKLIST === "true";
}

export function setupChecklist(reads: SetupReads, ids: { adAccountId: string }): SetupRow[] {
  const account = ids.adAccountId.replace(/^act_/, "");
  const inRupees = reads.currency === "INR";
  return [
    {
      key: "portfolio", label: "Business portfolio", done: Boolean(reads.portfolio), detail: reads.portfolio?.name ?? undefined,
      action: reads.portfolio ? undefined : {
        label: "Create a business portfolio", href: "https://business.facebook.com/overview",
        en: "Create a free business portfolio in Meta (1 minute), then connect again.",
        hi: "Meta में मुफ़्त बिज़नेस पोर्टफ़ोलियो बनाइए (1 मिनट), फिर दोबारा कनेक्ट कीजिए।",
      },
    },
    {
      key: "adAccount", label: "Ad account in rupees", done: reads.accountActive && inRupees,
      detail: reads.accountActive && inRupees ? "Your own ad account; Meta bills you directly" : undefined,
      action: reads.accountActive && inRupees ? undefined : {
        label: inRupees ? "Check your ad account" : "Use an ad account in rupees", href: `https://adsmanager.facebook.com/adsmanager/manage/accounts?act=${account}`,
        en: inRupees ? "Meta has this ad account turned off. Open it in Meta to see why." : "This ad account isn't in Indian rupees (₹). Connect one that is.",
        hi: inRupees ? "Meta ने यह विज्ञापन खाता बंद किया है। कारण देखने के लिए इसे Meta में खोलिए।" : "यह विज्ञापन खाता भारतीय रुपये (₹) में नहीं है। रुपये वाला खाता कनेक्ट कीजिए।",
      },
    },
    {
      key: "page", label: "Facebook Page", done: reads.pageListed,
      action: reads.pageListed ? undefined : {
        label: "Open your Pages", href: "https://www.facebook.com/pages/?category=your_pages",
        en: "This Facebook login can't manage the connected Page. Sign in with the Page's admin, or create a Page.",
        hi: "यह Facebook लॉगिन कनेक्ट किए गए पेज को नहीं चला सकता। पेज के एडमिन से लॉगिन कीजिए, या नया पेज बनाइए।",
      },
    },
    {
      key: "whatsapp", label: "WhatsApp on the Page", done: reads.whatsapp,
      action: reads.whatsapp ? undefined : {
        label: "Link WhatsApp", href: "https://business.facebook.com/latest/settings/whatsapp_account",
        en: "Link your WhatsApp Business number to your Page so customers can message you from the ad.",
        hi: "अपना WhatsApp Business नंबर पेज से जोड़िए, ताकि ग्राहक विज्ञापन से सीधे मैसेज कर सकें।",
      },
    },
    {
      key: "payment", label: "Payment method", done: reads.paymentMethod,
      detail: reads.paymentMethod ? "Meta charges you directly; AdBrain never sees your card" : undefined,
      action: reads.paymentMethod ? undefined : {
        label: "Add a card or UPI", href: `https://business.facebook.com/billing_hub/payment_settings/?asset_id=${account}`,
        en: "Add a card or UPI in Meta. Meta takes payment directly; AdBrain never sees it. Ads can't run without it.",
        hi: "Meta में कार्ड या UPI जोड़िए। भुगतान सीधे Meta लेता है; AdBrain इसे कभी नहीं देखता। इसके बिना विज्ञापन नहीं चलेंगे।",
      },
    },
  ];
}
