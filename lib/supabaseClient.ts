import { createClient } from "@supabase/supabase-js";

export function getSupabaseEnv(): { url: string; key: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) return null;
  return { url, key };
}

/**
 * Create a Supabase client using the public (publishable/anon) key.
 * Safe to use in the browser only when RLS policies are enabled.
 */
export function createSupabaseClient() {
  const env = getSupabaseEnv();
  if (!env) {
    throw new Error(
      "Supabase env is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY)."
    );
  }
  return createClient(env.url, env.key);
}
