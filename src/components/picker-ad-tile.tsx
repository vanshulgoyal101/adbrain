import type { ReactNode } from "react";
import { CheckCircle2, Pencil } from "lucide-react";
import { creativeThumbnailUrl } from "@/lib/creative/thumbnail";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/** One ad in Create's "Choose ads" grid; `labels.yours` marks an owner's own photo or video (#781). */
export function PickerAdTile({ ad, selected, hidden, editing, describedBy, labels, livePicture, onToggle, onEdit }: {
  ad: { id: string; headline: string | null; image_url: string | null; media_asset_id?: string | null };
  selected: boolean;
  hidden: boolean;
  editing: boolean;
  describedBy?: string;
  labels: { yours: string; select: string; preview: string; edit: string; editAd: (headline: string | null) => string };
  livePicture: ReactNode;
  onToggle: () => void;
  onEdit: () => void;
}) {
  return (
    // #305: on a phone, ads after the first two rows wait behind "Show all" unless selected.
    <div className={cn("relative flex min-w-0 flex-col gap-1.5", hidden && "max-sm:hidden")}>
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={selected}
        aria-describedby={describedBy}
        aria-label={ad.headline || labels.select}
        className={cn(
          "group relative min-w-0 overflow-hidden rounded-md border-2 text-left transition-colors",
          selected ? "border-slate-950 shadow-[0_8px_18px_rgba(15,23,42,0.12)]" : "border-slate-200 hover:border-slate-300",
        )}
      >
        <div className="relative aspect-square bg-slate-100">
          {livePicture && <div className="absolute inset-0 z-[1] bg-slate-100">{livePicture}</div>}
          {ad.image_url && (
            <img
              src={creativeThumbnailUrl(ad.image_url)}
              alt={ad.headline || labels.preview}
              className="h-full w-full object-contain"
              loading="lazy"
              onError={(event) => {
                if (ad.image_url && event.currentTarget.src !== ad.image_url) event.currentTarget.src = ad.image_url;
              }}
            />
          )}
        </div>
        {selected && (
          <span className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-slate-950 text-white">
            <CheckCircle2 className="h-4 w-4" />
          </span>
        )}
        {ad.media_asset_id && <span className="absolute left-1.5 top-1.5 rounded-full bg-white/90 px-2 py-0.5 text-xs font-medium text-slate-900">{labels.yours}</span>}
        <p className="truncate px-2 py-1.5 text-xs font-medium text-slate-700 max-sm:hidden">{ad.headline}</p>
      </button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        aria-label={labels.editAd(ad.headline)}
        aria-expanded={editing}
        onClick={onEdit}
        className="h-9 w-full max-sm:absolute max-sm:bottom-1.5 max-sm:left-1.5 max-sm:h-9 max-sm:min-h-0 max-sm:w-9 max-sm:rounded-full max-sm:bg-white/95 max-sm:p-0 max-sm:after:absolute max-sm:after:-inset-1 max-sm:after:content-['']"
      >
        {/* #847 T6: on a phone, Edit is a corner icon so a row of ads isn't followed by a row of buttons. */}
        <Pencil className="h-3.5 w-3.5" aria-hidden="true" /><span className="max-sm:sr-only">{labels.edit}</span>
      </Button>
    </div>
  );
}
