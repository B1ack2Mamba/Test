import type { SupabaseClient } from "@supabase/supabase-js";
import type { AnyTest } from "@/lib/testTypes";

export async function loadTestJsonBySlugAdmin(supabaseAdmin: SupabaseClient, slug: string): Promise<AnyTest | null> {
  const { data, error } = await supabaseAdmin
    .from("tests")
    .select("json, price_rub")
    .eq("slug", slug)
    .maybeSingle();

  if (error || !data?.json) return null;

  const raw = data.json as any;
  const { interpretation: _i, ...t } = raw;
  const test = t as AnyTest;

  // Normalize pricing defaults
  const price = typeof data.price_rub === "number" ? data.price_rub : test.pricing?.interpretation_rub ?? 0;
  const details = test.pricing?.details_rub ?? 49;

  return {
    ...test,
    pricing: { ...test.pricing, interpretation_rub: price, details_rub: details },
    has_interpretation: price > 0,
  };
}
