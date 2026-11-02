"use client";

import { createAdminClient } from "@/lib/supabase/admin";

export default function ServerOnlyProbe() {
  return <p>{typeof createAdminClient}</p>;
}
