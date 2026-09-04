import { Suspense } from "react";
import { Brain } from "lucide-react";
import { LoginForm } from "@/components/login-form";

export const metadata = {
  title: "Sign in",
  description:
    "Sign in to AdBrain to generate on-brand ad creatives and launch Meta lead campaigns.",
  alternates: { canonical: "/login" },
  // A thin auth page shouldn't compete with the landing in search.
  robots: { index: false, follow: true },
};

export default function LoginPage() {
  return (
    <div className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-white">
            <Brain className="h-6 w-6" />
          </span>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Sign in to AdBrain
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Use a magic link, password, or continue with Google.
          </p>
        </div>
        <Suspense>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}
