import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "@/lib/types";
import { observeIdentity } from "@/lib/observability/context";

/**
 * Supabase client for Server Components, Server Actions, and Route Handlers.
 * Reads/writes the session cookie. Enforces RLS via the anon key + user JWT.
 */
export async function createClient() {
  const cookieStore = await cookies();

  const client = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component where cookies are read-only.
            // The middleware refreshes the session, so this is safe to ignore.
          }
        },
      },
    },
  );
  const getUser = client.auth.getUser.bind(client.auth);
  client.auth.getUser = async (...args: Parameters<typeof getUser>) => {
    const result = await getUser(...args);
    observeIdentity(result.error ? null : result.data.user?.id ?? null);
    return result;
  };
  return client;
}
