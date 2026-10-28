import { OWNER_WORDS } from "@/lib/copy/owner-words";
import { localeChosen } from "@/i18n/request-locale";
import { BrandAssets } from "@/components/brand-assets";
import { BrandForm } from "@/components/brand-form";
import { SetupBusinessStep } from "@/components/setup-business-step";
import { WhatsAppMessageCard, type Suggested } from "@/components/whatsapp-message-card";
import { suggestedQuestions } from "@/lib/campaign/whatsapp-questions";
import { whatsappGreeting } from "@/lib/campaign/whatsapp-greeting";
import { Instructions } from "@/components/instructions";
import { PageHeader } from "@/components/ui/page-header";
import {
  getAdInstructions,
  getBrandAssets,
  getPrimaryBusiness,
  hasLaunchedCampaign,
} from "@/lib/supabase/queries";
import { getMetaConnection } from "@/lib/meta/credentials";
import { readWhatsAppStatus, type WhatsAppStatus } from "@/lib/meta/whatsapp-status";

export const metadata = { title: OWNER_WORDS.business };

export default async function BrandPage({ searchParams }: { searchParams: Promise<{ all?: string | string[] }> }) {
  const [business, params] = await Promise.all([getPrimaryBusiness(), searchParams]);
  // #1269 (#1251 WS1 step 1): until a first campaign has gone live, Your business is the five-field setup step;
  // `?all=1` opens the full page. If the check fails, the full page shows as before.
  const setup = params.all !== "1" && (!business || !(await hasLaunchedCampaign(business.id).catch(() => true)));
  if (setup) return <SetupBusinessStep business={business} chooseLanguage={!(await localeChosen())} />;
  const [assets, instructions, connection] = business
    ? await Promise.all([
        getBrandAssets(business.id),
        getAdInstructions(business.id),
        getMetaConnection(business.id),
      ])
    : [[], [], null];
  // The Call now note reads WhatsApp status; it never blocks the page.
  const whatsappStatus: Promise<WhatsAppStatus> | null = business && connection?.ready
    ? readWhatsAppStatus(business.id).catch((): WhatsAppStatus => ({ state: "unavailable" }))
    : null;

  // #847: Meta and WhatsApp connection status live in Settings only; the message itself is business content.
  const showMessage = Boolean(business && connection?.ready);

  return (
    <div>
      <PageHeader
        title={OWNER_WORDS.business}
        description={
          <p>What AdBrain knows about your business. Every ad and campaign uses it.</p>
        }
      />
      <nav
        aria-label="Business sections"
        className="mt-5 flex gap-2 overflow-x-auto border-y border-slate-200/80 py-2 text-sm"
      >
        {[
          ["Basics", "brand-identity"],
          ["Contact details", "brand-contact"],
          ["Brand details", "brand-creative"],
          ...(showMessage ? [["WhatsApp message", "brand-whatsapp"]] : []),
          ["Ad instructions", "brand-guidance"],
          ["Brand assets", "brand-assets"],
        ].map(([label, href]) => (
          <a
            key={href}
            href={`#${href}`}
            className="flex min-h-11 items-center whitespace-nowrap rounded-lg px-3 font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-950"
          >
            {label}
          </a>
        ))}
      </nav>
      <div className="mt-6 flex flex-col gap-6">
        <BrandForm business={business} photoCount={assets.filter((a) => a.type === "product_photo").length} />
        {business && (
          <>
            {showMessage && (
              <section id="brand-whatsapp" className="scroll-mt-6">
                {/* #840: suggestions are today's generated text, per language, from the Brand's offers and areas. */}
                <WhatsAppMessageCard businessId={business.id} businessName={business.name} saved={business.whatsapp_template}
                  firstOffer={business.offers?.[0]}
                  suggestedQuestions={Object.fromEntries((["en", "hi", "hinglish", "pa"] as const).map((language) => [language, suggestedQuestions(business, language)])) as Record<"en" | "hi" | "hinglish" | "pa", string[]>}
                  callNumber={whatsappStatus?.then((status) => status.state === "ready" ? status.numbers.find((number) => number.source === "page")?.masked ?? null : null)}
                  suggested={Object.fromEntries((["en", "hi", "hinglish", "pa"] as const).map((language) => {
                    const text = whatsappGreeting(business, business.offers ?? [], business.locations ?? [], [], language);
                    return [language, { greeting: text.greeting, prefill: text.autofill }];
                  })) as Suggested} />
              </section>
            )}
            <section id="brand-guidance" className="scroll-mt-6">
              <Instructions
                businessId={business.id}
                instructions={instructions}
              />
            </section>
            <section id="brand-assets" className="scroll-mt-6">
              <BrandAssets businessId={business.id} initialAssets={assets} />
            </section>
          </>
        )}
      </div>
    </div>
  );
}
