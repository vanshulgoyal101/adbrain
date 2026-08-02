import { Suspense } from "react";
import { Sun } from "lucide-react";
import { LoginForm } from "@/components/login-form";

export default function LoginPage() {
  return (
    <div className="flex min-h-full items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-600 text-white">
            <Sun className="h-6 w-6" />
          </span>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Sign in to AdBrain
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Use a magic link or continue with Google.
          </p>
        </div>
        <Suspense>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}
