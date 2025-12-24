import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseClient, getSupabaseEnv } from "@/lib/supabaseClient";

let browserClient: SupabaseClient | null = null;

/**
 * Browser-only singleton Supabase client.
 * Returns null if env is not configured.
 */
export function getSupabaseBrowser(): SupabaseClient | null {
  if (typeof window === "undefined") return null;
  const env = getSupabaseEnv();
  if (!env) return null;
  if (!browserClient) browserClient = createSupabaseClient();
  return browserClient;
}
