import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="text-5xl font-bold text-emerald-600">404</p>
      <h1 className="text-xl font-semibold text-slate-900">Page not found</h1>
      <p className="max-w-md text-sm text-slate-600">
        The page you’re looking for doesn’t exist or has moved.
      </p>
      <Link href="/">
        <Button variant="outline">Back home</Button>
      </Link>
    </div>
  );
}
