import Link from "next/link";
import { Brain } from "lucide-react";

/** Shared shell for public legal/content pages (privacy, terms). */
export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-full flex-col">
      <header className="mx-auto flex w-full max-w-3xl items-center justify-between p-6">
        <Link href="/" className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600 text-white">
            <Brain className="h-5 w-5" />
          </span>
          <span className="text-lg font-bold tracking-tight">AdBrain</span>
        </Link>
        <Link href="/login" className="text-sm font-medium text-emerald-700 hover:underline">
          Sign in
        </Link>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-8">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">
          {title}
        </h1>
        <p className="mt-2 text-sm text-slate-500">Last updated: {updated}</p>
        <div className="mt-8 max-w-none text-slate-700 [&_a]:text-emerald-700 [&_a]:underline [&_h2]:mt-8 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-slate-900 [&_li]:mt-1 [&_p]:mt-3 [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-6">
          {children}
        </div>
      </main>

      <footer className="border-t border-slate-200 py-8">
        <div className="mx-auto flex w-full max-w-3xl flex-col items-center justify-between gap-3 px-6 text-sm text-slate-500 sm:flex-row">
          <span>© {new Date().getFullYear()} AdBrain. All rights reserved.</span>
          <nav className="flex gap-4">
            <Link href="/privacy" className="hover:underline">
              Privacy
            </Link>
            <Link href="/terms" className="hover:underline">
              Terms
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
