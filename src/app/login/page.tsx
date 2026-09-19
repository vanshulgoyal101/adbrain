import { Suspense } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import { LoginForm } from "@/components/login-form";
import { LEGAL_LINKS } from "@/lib/legal-links";

export const metadata = {
  title: "Sign in",
  description:
    "Sign in to AdBrain to create marketing campaigns and follow up with potential customers.",
  alternates: { canonical: "/login" },
  // A thin auth page shouldn't compete with the landing in search.
  robots: { index: false, follow: true },
};

export default function LoginPage() {
  return (
    <div className="flex min-h-dvh flex-1 flex-col bg-background">
      <a href="#sign-in" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-10 focus:rounded-md focus:bg-white focus:p-3">Skip to sign in</a>
      <header className="border-b border-border bg-white">
        <div className="mx-auto flex min-h-20 max-w-7xl items-center justify-between gap-4 px-5 sm:px-8">
          <Link href="/" aria-label="AdBrain home" className="inline-flex min-h-11 items-center gap-2.5 text-xl font-semibold text-slate-900">
            <Image src="/icon.svg" alt="" width={32} height={32} priority />
            AdBrain
          </Link>
          <Link href="/" className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-slate-600 hover:text-blue-700">
            <ArrowLeft size={16} aria-hidden="true" /> Home
          </Link>
        </div>
      </header>
      <main id="sign-in" tabIndex={-1} className="flex flex-1 items-center border-b border-border bg-white px-5 py-10 sm:px-8 sm:py-16">
        <section aria-labelledby="sign-in-title" className="mx-auto w-full max-w-sm">
          <div className="mb-8">
            <p className="mb-3 flex items-center gap-2 text-xs font-semibold text-blue-700"><span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-blue-600" /> Your workspace</p>
            <h1 id="sign-in-title" className="text-3xl font-semibold leading-tight text-slate-900">Sign in to AdBrain</h1>
          </div>
          <Suspense fallback={<div role="status" className="flex min-h-80 items-center justify-center gap-2 text-sm text-slate-500"><Loader2 size={18} aria-hidden="true" className="animate-spin" /> Loading sign in...</div>}>
            <LoginForm />
          </Suspense>
        </section>
      </main>
      <footer className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-x-8 gap-y-2 px-5 py-4 text-xs text-slate-500 sm:px-8">
        <span>AdBrain</span>
        <nav aria-label="Legal" className="flex flex-wrap items-center gap-x-5">
          {LEGAL_LINKS.map(({ href, label }) => <Link key={href} href={href} className="inline-flex min-h-11 items-center hover:text-slate-900">{label}</Link>)}
        </nav>
      </footer>
    </div>
  );
}
