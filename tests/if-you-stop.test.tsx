// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BillingSection } from "@/components/managed-billing";
import { MetaConnectionPanel } from "@/components/meta-connection";
import type { MetaConnection } from "@/lib/meta/credentials";
import { pausableCampaigns } from "@/lib/campaign/gone-in-meta";
import type { Campaign } from "@/lib/types";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  refresh.mockClear();
});

const businessId = "11111111-1111-4111-8111-111111111111";
const connection: MetaConnection = {
  source: "oauth", ready: true, pending: false, adAccountId: null,
  pageId: null, tokenExpiresAt: null, expired: false, scopes: [],
};
const dialogs = [
  {
    locale: "en",
    title: "Disconnect Facebook?",
    body: "Your ads keep running in Meta until you pause them there. After this, AdBrain can't pause them or update their results.",
    confirm: "Disconnect",
    cancel: "Keep connected",
  },
  {
    locale: "hi",
    title: "Facebook हटाएँ?",
    body: "आपके विज्ञापन Meta में तब तक चलते रहेंगे जब तक आप उन्हें वहाँ न रोकें। इसके बाद AdBrain उन्हें रोक या उनके नतीजे अपडेट नहीं कर पाएगा।",
    confirm: "हटाएँ",
    cancel: "जुड़ा रहने दें",
  },
] as const;

describe("If you stop (#1916)", () => {
  it("shows the three plain lines under an own-account plan", () => {
    render(<BillingSection mode="own" connection={null} />);
    const block = screen.getByRole("list", { name: "If you stop" });
    expect(within(block).getAllByRole("listitem").map(row => row.textContent)).toMatchInlineSnapshot(`
      [
        "If you stop paying: your running ads keep running on Meta, and your results and enquiries stay here. We'll remind you on Home when a payment is due. Nothing is deleted.",
        "If you disconnect Facebook: your ads keep running in Meta until you pause them there. AdBrain can't pause them or update results after that.",
        "To delete your data: use Privacy and data requests below. Your campaigns stay in your own Meta ad account.",
      ]
    `);
  });

  it("shows all three lines in Hindi", () => {
    render(<BillingSection mode="own" connection={null} locale="hi" />);
    // #2095: the heading and price line are Hindi too, not English above Hindi lines.
    expect(screen.getByRole("heading", { name: "बिलिंग" })).toBeInTheDocument();
    expect(screen.getByText("आप अपने विज्ञापन खाते से सीधे Meta को भुगतान करते हैं। AdBrain का पहला महीना मुफ़्त है; उसके बाद ₹999 हर महीने।")).toBeInTheDocument();
    const block = screen.getByRole("list", { name: "अगर आप रुकें" });
    expect(within(block).getAllByRole("listitem").map(row => row.textContent)).toMatchInlineSnapshot(`
      [
        "भुगतान बंद करने पर: आपके चल रहे विज्ञापन Meta पर चलते रहेंगे, और नतीजे व पूछताछ यहाँ रहेंगी। भुगतान बाकी होने पर हम होम पर याद दिलाएँगे। कुछ भी डिलीट नहीं होगा।",
        "Facebook हटाने पर: आपके विज्ञापन Meta में तब तक चलते रहेंगे जब तक आप उन्हें वहाँ न रोकें। उसके बाद AdBrain उन्हें रोक या नतीजे अपडेट नहीं कर पाएगा।",
        "अपना डेटा हटाने के लिए: नीचे Privacy and data requests इस्तेमाल करें। आपके कैंपेन आपके अपने Meta विज्ञापन खाते में रहेंगे।",
      ]
    `);
  });

  it.each(["managed", "operator", null] as const)("hides own-account promises for funding mode %s", mode => {
    render(<BillingSection mode={mode} connection={null} />);
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it.each(dialogs)("renders the real $locale warning and keeps Facebook connected on cancel", async copy => {
    const request = vi.fn();
    vi.stubGlobal("fetch", request);
    render(<MetaConnectionPanel businessId={businessId} connection={connection} oauthConfigured locale={copy.locale} />);
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    const dialog = await screen.findByRole("dialog", { name: copy.title });
    expect(dialog).toHaveAccessibleDescription(copy.body);
    expect(within(dialog).getByRole("button", { name: copy.confirm })).toBeInTheDocument();
    expect(request).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: copy.cancel }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeEnabled();
    expect(request).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it.each(dialogs)("disconnects only after the real $locale confirmation", async copy => {
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true })));
    vi.stubGlobal("fetch", request);
    render(<MetaConnectionPanel businessId={businessId} connection={connection} oauthConfigured locale={copy.locale} />);
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    const dialog = await screen.findByRole("dialog", { name: copy.title });
    expect(request).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: copy.confirm }));
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(request).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith("/api/meta/disconnect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ businessId }),
    });
  });
});

describe("Pause all in Settings (#1968, frame 7)", () => {
  const campaign = (id: string, status: Campaign["status"], raw: Campaign["raw"] = {}) =>
    ({ id, name: `Ad ${id}`, status, raw, meta_ad_account_id: "act_999", meta_campaign_id: `12${id}` }) as Campaign;

  it("keeps only campaigns still running in Meta, in the shape Pause all takes", () => {
    expect(pausableCampaigns([campaign("1", "active"), campaign("2", "paused"), campaign("3", "active", { metaStatus: "DELETED" })]))
      .toEqual([{ id: "1", name: "Ad 1", meta_ad_account_id: "act_999", meta_campaign_id: "121" }]);
  });

  it("offers the same sheet under If you stop while a campaign runs, and opens the confirm", () => {
    render(<BillingSection mode="own" connection={null} runningCampaigns={pausableCampaigns([campaign("1", "active")])} />);
    const section = screen.getByRole("region", { name: "Billing" });
    fireEvent.click(within(section).getByRole("button", { name: "Pause all ads" }));
    expect(within(screen.getByRole("dialog")).getByText("Pause all your ads?")).toBeInTheDocument();
  });

  it("hides it while nothing runs, and on plans without If you stop", () => {
    const { unmount } = render(<BillingSection mode="own" connection={null} runningCampaigns={[]} />);
    expect(screen.queryByRole("button", { name: "Pause all ads" })).toBeNull();
    unmount();
    render(<BillingSection mode="operator" connection={null} runningCampaigns={pausableCampaigns([campaign("1", "active")])} />);
    expect(screen.queryByRole("button", { name: "Pause all ads" })).toBeNull();
  });
});
