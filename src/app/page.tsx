import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, Sparkles, Sun, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getUser } from "@/lib/supabase/queries";

export default async function Home() {
  const user = await getUser();
  if (user) redirect("/dashboard");

  return (
    <div className="flex min-h-full flex-col">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between p-6">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600 text-white">
            <Sun className="h-5 w-5" />
          </span>
          <span className="text-lg font-bold tracking-tight">AdBrain</span>
        </div>
        <Link href="/login">
          <Button variant="outline" size="sm">
            Sign in
          </Button>
        </Link>
      </header>

      <section className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center px-6 py-16 text-center">
        <span className="mb-4 inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-sm font-medium text-emerald-700">
          <Sparkles className="h-4 w-4" /> AI ad creative for solar businesses
        </span>
        <h1 className="text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
          Fill your brand brain. Type a goal.
          <br />
          Get ads ready to launch.
        </h1>
        <p className="mt-5 max-w-xl text-lg text-slate-600">
          AdBrain turns your brand into on-brand solar ad creatives — image,
          headline, and copy — in seconds. You approve; Meta Advantage+ does the
          targeting.
        </p>
        <div className="mt-8 flex items-center gap-3">
          <Link href="/login">
            <Button size="lg">
              Get started <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
        </div>

        <div className="mt-16 grid w-full gap-4 sm:grid-cols-3">
          {[
            {
              icon: Sun,
              title: "Brand Brain",
              body: "Your voice, USPs, colors, and offers in one place.",
            },
            {
              icon: Sparkles,
              title: "Creative Studio",
              body: "3–5 complete ad variants from a single brief.",
            },
            {
              icon: Zap,
              title: "Launch-ready",
              body: "Approve and export an ad pack, or push to Meta.",
            },
          ].map(({ icon: Icon, title, body }) => (
            <div
              key={title}
              className="rounded-xl border border-slate-200 bg-white p-5 text-left shadow-sm"
            >
              <Icon className="h-5 w-5 text-emerald-600" />
              <h3 className="mt-3 font-semibold text-slate-900">{title}</h3>
              <p className="mt-1 text-sm text-slate-600">{body}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
