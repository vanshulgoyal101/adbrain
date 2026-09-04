import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowRight,
  Brain,
  Image as ImageIcon,
  Inbox,
  MapPin,
  Rocket,
  Sparkles,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { JsonLd } from "@/components/json-ld";
import { faqSchema, MARKETING_FAQS } from "@/lib/seo/jsonLd";
import { LEGAL_LINKS } from "@/lib/legal-links";
import { getUser } from "@/lib/supabase/queries";

const FEATURES = [
  {
    icon: Brain,
    title: "Brand Brain",
    body: "Your voice, USPs, colours, and offers in one place — every ad is generated from it.",
  },
  {
    icon: Sparkles,
    title: "Creative Studio",
    body: "Type a goal and get 3–6 complete ad variants — image, headline, and copy — in seconds.",
  },
  {
    icon: MapPin,
    title: "Simple targeting",
    body: "Pick cities and a radius, include or exclude areas, or let AdBrain choose for you.",
  },
  {
    icon: Rocket,
    title: "One-click Meta launch",
    body: "Create a paused Advantage+ lead campaign — nothing spends until you activate it.",
  },
  {
    icon: Inbox,
    title: "Lead inbox + digests",
    body: "Every enquiry in one place, with a WhatsApp-ready summary of recent leads.",
  },
  {
    icon: Zap,
    title: "Plain-language results",
    body: "See how campaigns are doing in one friendly sentence — no jargon, no dashboards.",
  },
];

const STEPS = [
  {
    title: "Fill your Brand Brain",
    body: "Add your business once — or autofill it straight from your website.",
  },
  {
    title: "Type a goal",
    body: "“More leads in Jaipur this month.” AdBrain writes the ads.",
  },
  {
    title: "Approve & launch",
    body: "Review the variants, then create a paused Meta campaign in one click.",
  },
];

export default async function Home() {
  const user = await getUser();
  if (user) redirect("/dashboard");

  return (
    <div className="flex min-h-full flex-col">
      <JsonLd data={faqSchema()} />

      <header className="mx-auto flex w-full max-w-6xl items-center justify-between p-6">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-white">
            <Brain className="h-5 w-5" />
          </span>
          <span className="text-lg font-bold tracking-tight">AdBrain</span>
        </div>
        <Link href="/login">
          <Button variant="outline" size="sm">
            Sign in
          </Button>
        </Link>
      </header>

      <main className="flex flex-1 flex-col">
        {/* Hero */}
        <section className="mx-auto flex w-full max-w-3xl flex-col items-center px-6 py-16 text-center">
          <span className="mb-4 inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-sm font-medium text-blue-700">
            <Sparkles className="h-4 w-4" /> AI ad creative for any local business
          </span>
          <h1 className="text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
            Fill your brand brain. Type a goal.
            <br />
            Get ads ready to launch.
          </h1>
          <p className="mt-5 max-w-xl text-lg text-slate-600">
            AdBrain turns your brand into on-brand ad creatives — image,
            headline, and copy — in seconds. You approve; Meta Advantage+ does
            the targeting.
          </p>
          <div className="mt-8 flex items-center gap-3">
            <Link href="/login">
              <Button size="lg">
                Get started <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </div>
        </section>

        {/* How it works */}
        <section className="mx-auto w-full max-w-5xl px-6 py-12">
          <h2 className="text-center text-2xl font-bold tracking-tight text-slate-900">
            From brand to live ads in three steps
          </h2>
          <ol className="mt-10 grid gap-6 sm:grid-cols-3">
            {STEPS.map((step, i) => (
              <li
                key={step.title}
                className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-sm font-bold text-white">
                  {i + 1}
                </span>
                <h3 className="mt-4 font-semibold text-slate-900">
                  {step.title}
                </h3>
                <p className="mt-1 text-sm text-slate-600">{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* Features */}
        <section className="mx-auto w-full max-w-5xl px-6 py-12">
          <h2 className="text-center text-2xl font-bold tracking-tight text-slate-900">
            Everything a local business needs to run ads
          </h2>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ icon: Icon, title, body }) => (
              <div
                key={title}
                className="rounded-xl border border-slate-200 bg-white p-5 text-left shadow-sm"
              >
                <Icon className="h-5 w-5 text-blue-600" />
                <h3 className="mt-3 font-semibold text-slate-900">{title}</h3>
                <p className="mt-1 text-sm text-slate-600">{body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* FAQ */}
        <section className="mx-auto w-full max-w-3xl px-6 py-12">
          <h2 className="text-center text-2xl font-bold tracking-tight text-slate-900">
            Frequently asked questions
          </h2>
          <dl className="mt-8 divide-y divide-slate-200">
            {MARKETING_FAQS.map((faq) => (
              <div key={faq.question} className="py-5">
                <dt className="font-semibold text-slate-900">{faq.question}</dt>
                <dd className="mt-2 text-sm leading-relaxed text-slate-600">
                  {faq.answer}
                </dd>
              </div>
            ))}
          </dl>
          <div className="mt-8 flex justify-center">
            <Link href="/login">
              <Button size="lg">
                Get started <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200 py-8">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-3 px-6 text-sm text-slate-500 sm:flex-row">
          <div className="flex items-center gap-2">
            <ImageIcon className="h-4 w-4 text-blue-600" />
            <span>AdBrain — AI ad creative for any local business</span>
          </div>
          <nav className="flex items-center gap-4">
            {LEGAL_LINKS.map((l) => (
              <Link key={l.href} href={l.href} className="hover:underline">
                {l.label}
              </Link>
            ))}
            <span>© {new Date().getFullYear()} AdBrain.</span>
          </nav>
        </div>
      </footer>
    </div>
  );
}
