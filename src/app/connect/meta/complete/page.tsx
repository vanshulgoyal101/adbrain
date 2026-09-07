import { MetaConnectCompletion } from "@/components/meta-connect/meta-connect-completion";
import {
  ConnectionAccessError,
  getOwnedConnectionAttempt,
} from "@/lib/meta/connection-access";
import { attemptDtoSchema } from "@/lib/meta/connect-contracts";

export const dynamic = "force-dynamic";

export default async function MetaConnectCompletePage({
  searchParams,
}: {
  searchParams: Promise<{ attemptId?: string }>;
}) {
  const { attemptId } = await searchParams;
  const parsedAttemptId = attemptDtoSchema.shape.attemptId.safeParse(attemptId);
  if (!parsedAttemptId.success) {
    return <CompletionError message="This connection link is invalid or incomplete." />;
  }

  let attempt;
  let errorMessage: string | null = null;
  try {
    attempt = await getOwnedConnectionAttempt(parsedAttemptId.data);
  } catch (error) {
    errorMessage =
      error instanceof ConnectionAccessError && error.code === "UNAUTHENTICATED"
        ? "Sign in to continue this connection."
        : "This connection is not ready to continue. Return to AdBrain and check again.";
  }
  if (attempt) return <MetaConnectCompletion attempt={attempt} />;
  return <CompletionError message={errorMessage ?? "This connection could not be checked."} />;
}

function CompletionError({ message }: { message: string }) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-lg items-center px-6 py-12">
      <section className="w-full rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-lg font-semibold text-slate-900">Connection needs attention</h1>
        <p className="mt-2 text-sm text-slate-600">{message}</p>
        <a href="/settings" className="mt-6 inline-flex h-10 items-center rounded-md bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700">
          Return to Settings
        </a>
      </section>
    </main>
  );
}