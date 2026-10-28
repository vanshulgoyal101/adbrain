import { notFound } from "next/navigation";
import { VerdictGalleryCard } from "@/components/verdict-gallery-card";
import { galleryCards } from "@/lib/campaign/verdict-gallery";
import { isInternalUser } from "@/lib/internal-accounts";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Card states" };

/** #1255 (CPO): every campaign-card state on one page, for the team's walks. Internal accounts only; no data read. */
export default async function VerdictGalleryPage() {
  const { data: { user } } = await (await createClient()).auth.getUser();
  if (!isInternalUser(user)) notFound();
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-950">Card states</h1>
        <p className="mt-1 text-sm text-slate-600">Examples for the team&apos;s walks. Nothing here is a real campaign; buttons don&apos;t change anything.</p>
      </header>
      <ul className="grid gap-4 lg:grid-cols-2">
        {galleryCards().map((card) => <VerdictGalleryCard key={card.name} card={card} />)}
      </ul>
    </div>
  );
}
