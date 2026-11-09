"use client";

import type { AssetResults } from "@/lib/campaign/asset-results";
import { resultNounKey } from "@/lib/campaign/verdict";
import { formatMoney, formatNumber } from "@/lib/format";
import { ageText, verdictTranslator, type Words } from "@/i18n/words";

export type AssetResultProps = { results?: AssetResults; words?: Words<"verdict"> };

export function AssetResultsNotice({ results, words }: AssetResultProps) {
  if (!results) return null;
  const t = verdictTranslator(words);
  const message = results?.state === "unavailable" ? t("assets.unavailable")
    : results?.unmatched ? t("assets.unmatched") : null;
  return message ? <p role="status" lang={words?.locale} className="text-sm text-slate-600">{message}</p> : null;
}

/** Counts are lifetime reads, not a winner recommendation. The server pins freshness for hydration. */
export function AssetResultBadge({ results, words, assetId, kind }: AssetResultProps & { assetId: string; kind: "media" | "creative" }) {
  if (!results || results.state !== "ready") return null;
  const t = verdictTranslator(words);
  const groups = (kind === "media" ? results.byMedia : results.byCreative)[assetId];
  // With unlinked ad results, an empty tile may still have results: say so instead of "No results yet".
  if (!groups?.length) return <p lang={words?.locale} className="text-xs text-slate-500">{t(results.unmatched ? "assets.unknown" : "assets.unread")}</p>;
  return (
    <div lang={words?.locale} className="space-y-1 text-xs text-slate-600">
      {groups.map(group => {
        const key = resultNounKey(group.destination);
        const unit = t(key, { n: 1 });
        return (
          <div key={group.destination} className="wrap-break-word">
            <p>{group.delivered ? <>
              {t("ads.count", { n: formatNumber(group.results), unit: t(key, { n: group.results }) })}
              {" \u00b7 "}
              {t("ads.per", { cost: group.results ? formatMoney(group.spendPaise / 100 / group.results) : "\u2014", unit })}
            </> : t("ads.notShown")}</p>
            <p className="text-slate-500">{t("ads.updated", { age: ageText(t, group.syncedAt, new Date(results.asOf)) })}</p>
          </div>
        );
      })}
    </div>
  );
}
