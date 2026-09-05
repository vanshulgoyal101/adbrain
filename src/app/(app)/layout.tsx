import Link from "next/link";
import { redirect } from "next/navigation";
import { Brain } from "lucide-react";
import { Nav } from "@/components/nav";
import { SignOutButton } from "@/components/sign-out-button";
import { LEGAL_LINKS } from "@/lib/legal-links";
import { getUser } from "@/lib/supabase/queries";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getUser();
  if (!user) redirect("/login");

  return (
    <div className="flex flex-1 flex-col md:flex-row">
      <aside className="hidden w-72 shrink-0 flex-col border-r border-slate-200/80 bg-white/90 p-5 backdrop-blur md:flex">
        <Link href="/dashboard" className="mb-8 flex items-center gap-3 px-2 py-1">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-950 text-white shadow-sm">
            <Brain className="h-5 w-5" />
          </span>
          <span className="font-display text-[17px] font-semibold tracking-[-0.02em] text-slate-950">
            AdBrain
          </span>
        </Link>

        <Nav />

        <div className="mt-auto border-t border-slate-100 pt-3">
          <p className="truncate px-3 pb-2 text-xs text-slate-400">
            {user.email}
          </p>
          <SignOutButton />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-slate-200/80 bg-white/90 p-3 backdrop-blur md:hidden">
          <Link href="/dashboard" className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-950 text-white">
              <Brain className="h-5 w-5" />
            </span>
            <span className="font-bold tracking-tight text-slate-900">
              AdBrain
            </span>
          </Link>
          <SignOutButton />
        </header>
        <div className="border-b border-slate-200/80 bg-white/90 px-3 py-2 backdrop-blur md:hidden">
          <Nav orientation="horizontal" />
        </div>

        <main className="flex-1">
          <div className="mx-auto max-w-7xl p-5 md:p-10">{children}</div>
        </main>

        <footer className="border-t border-slate-200 px-6 py-4 md:px-8">
          <nav className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400">
            {LEGAL_LINKS.map((l) => (
              <Link key={l.href} href={l.href} className="hover:text-slate-600 hover:underline">
                {l.label}
              </Link>
            ))}
          </nav>
        </footer>
      </div>
    </div>
  );
}
