import { translator, type AppLocale } from "@/i18n/locale";
import { pictureSource } from "@/lib/creative/picture-source";
import { cn } from "@/lib/utils";

/** #1901: "Your photo" / "AI picture" on every ad tile (Create step 2, Studio, Review); channel-neutral. */
export function PictureSourceBadge({ generation, locale = "en", className }: { generation: unknown; locale?: AppLocale; className?: string }) {
  const source = pictureSource(generation);
  if (!source) return null;
  const t = translator(locale, "creative");
  return (
    <span className={cn("inline-flex min-h-6 items-center rounded-full bg-white/90 px-2 text-xs font-medium text-slate-700 ring-1 ring-slate-200", className)}>
      {source === "yours" ? t("yourPhoto") : t("aiPicture")}
    </span>
  );
}
