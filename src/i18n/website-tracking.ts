import { createTranslator } from "use-intl/core";
import en from "../../messages/en.json";
import type { BrandTrackingCopy } from "@/components/brand-tracking-card";
import type { WebsiteGoalCopy, WebsiteReviewDetails } from "@/components/campaign-destination";
import type { Words } from "@/i18n/words";

export function websiteTrackingCopy(words?: Words<"websiteTracking">): {
  card: BrandTrackingCopy;
  goals: WebsiteGoalCopy;
  review: WebsiteReviewDetails["copy"];
  chat: { draftMismatch: string };
} {
  const t = createTranslator({
    locale: words?.locale ?? "en",
    messages: { websiteTracking: words?.messages ?? en.websiteTracking },
    namespace: "websiteTracking",
  });
  return {
    card: {
      title: t("card.title"), intro: t("card.intro"), legend: t("card.legend"),
      noSource: t("card.noSource"), noSourceHelp: t("card.noSourceHelp"),
      unreadable: t("card.unreadable"), unreadableHelp: t("card.unreadableHelp"),
      choose: t("card.choose"), quiet: t("card.quiet"), missing: t("card.missing"),
      selectionUnavailable: t("card.selectionUnavailable"), pixelUnavailable: t("card.pixelUnavailable"),
      unnamed: (n) => t("card.unnamed", { n }),
      leadCount: (n) => t("card.leadCount", { n }),
      purchaseCount: (n) => t("card.purchaseCount", { n }),
      window: (since, until) => t("card.window", { since, until }),
      countsNote: t("card.countsNote"), checkAgain: t("card.checkAgain"),
      checking: t("card.checking"), checkAccess: t("card.checkAccess"), eventsManager: t("card.eventsManager"),
    },
    goals: {
      legend: t("goals.legend"), visits: t("goals.visits"), leads: t("goals.leads"), sales: t("goals.sales"),
      needsTracking: t("goals.needsTracking"), unavailable: t("goals.unavailable"),
      noSource: t("card.noSource"), chooseTracking: t("card.choose"), unreadable: t("card.unreadable"),
      quiet: t("card.quiet"), missing: t("goals.missing"), finish: t("goals.finish"),
    },
    review: {
      goals: {
        visits: { label: t("goals.visits"), hint: t("review.visitsHint") },
        leads: { label: t("goals.leads"), hint: t("review.leadsHint") },
        sales: { label: t("goals.sales"), hint: t("review.salesHint") },
      },
      attributionLabel: t("review.attributionLabel"), attributionHelp: t("review.attributionHelp"),
      attributionUnavailable: t("review.attributionUnavailable"),
    },
    chat: { draftMismatch: t("chat.draftMismatch") },
  };
}
