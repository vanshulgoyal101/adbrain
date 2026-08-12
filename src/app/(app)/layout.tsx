import Link from "next/link";
import { redirect } from "next/navigation";
import { Brain } from "lucide-react";
import { Nav } from "@/components/nav";
import { SignOutButton } from "@/components/sign-out-button";
import { getUser } from "@/lib/supabase/queries";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getUser();
  if (!user) redirect("/login");

  return (
    <div className="flex min-h-full flex-col md:flex-row">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-slate-200 bg-white p-4 md:flex">
        <Link href="/dashboard" className="mb-6 flex items-center gap-2 px-2 py-1">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-white">
            <Brain className="h-5 w-5" />
          </span>
          <span className="text-lg font-bold tracking-tight text-slate-900">
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
        <header className="flex items-center justify-between border-b border-slate-200 bg-white p-3 md:hidden">
          <Link href="/dashboard" className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-white">
              <Brain className="h-5 w-5" />
            </span>
            <span className="font-bold tracking-tight text-slate-900">
              AdBrain
            </span>
          </Link>
          <SignOutButton />
        </header>
        <div className="border-b border-slate-200 bg-white px-3 py-2 md:hidden">
          <Nav orientation="horizontal" />
        </div>

        <main className="flex-1">
          <div className="mx-auto max-w-6xl p-6 md:p-8">{children}</div>
        </main>
      </div>
    </div>
  );
}
