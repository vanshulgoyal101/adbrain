import { createClient } from "@/lib/supabase/server";
import type { Business, Creative } from "@/lib/types";

/** Current authenticated user, or null. */
export async function getUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/** All businesses owned by the current user (RLS-scoped). */
export async function getBusinesses(): Promise<Business[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("businesses")
    .select("*")
    .order("created_at", { ascending: true });
  return data ?? [];
}

/** The user's first business (v1 is single-business per user). */
export async function getPrimaryBusiness(): Promise<Business | null> {
  const businesses = await getBusinesses();
  return businesses[0] ?? null;
}

export async function getBusinessById(id: string): Promise<Business | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("businesses")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return data ?? null;
}

/** Creatives for a business, newest first. */
export async function getCreatives(businessId: string): Promise<Creative[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("creatives")
    .select("*")
    .eq("business_id", businessId)
    .order("created_at", { ascending: false });
  return data ?? [];
}
