import fs from "fs";
import path from "path";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AnyTest } from "@/lib/testTypes";

const TESTS_DIR = path.join(process.cwd(), "data", "tests");

function getTestBySlugLocal(slug: string): AnyTest | null {
  if (slug === "16pf") return null;
  const filePath = path.join(TESTS_DIR, `${slug}.json`);
  if (!fs.existsSync(filePath)) return null;

  const rawText = fs.readFileSync(filePath, "utf-8");
  const parsed = JSON.parse(rawText) as any;
  const { interpretation: _i, ...t } = parsed;
  const test = t as AnyTest;

  const price = test.pricing?.interpretation_rub ?? 0;
  const details = test.pricing?.details_rub ?? 49;

  return {
    ...test,
    pricing: { ...test.pricing, interpretation_rub: price, details_rub: details },
    has_interpretation: price > 0,
  };
}

export async function loadTestJsonBySlugAdmin(
  supabaseAdmin: SupabaseClient,
  slug: string
): Promise<AnyTest | null> {
  if (slug === "16pf") return null;

  const isDev = process.env.NODE_ENV !== "production";

  // Dev preference: always use LOCAL JSON for 16PF forms to keep scoring stable while DB is being tuned/seeded.
  if (isDev && (slug === "16pf-a" || slug === "16pf-b")) {
    const local = getTestBySlugLocal(slug);
    if (local) return local;
  }


  try {
    const { data, error } = await supabaseAdmin
      .from("tests")
      .select("json, price_rub")
      .eq("slug", slug)
      .maybeSingle();

    if (error || !data?.json) {
      return isDev ? getTestBySlugLocal(slug) : null;
    }

    const raw = data.json as any;
    const { interpretation: _i, ...t } = raw;
    const test = t as AnyTest;

    // Normalize pricing defaults
    const price =
      typeof (data as any).price_rub === "number" ? (data as any).price_rub : test.pricing?.interpretation_rub ?? 0;
    const details = test.pricing?.details_rub ?? 49;

    return {
      ...test,
      pricing: { ...test.pricing, interpretation_rub: price, details_rub: details },
      has_interpretation: price > 0,
    };
  } catch (e) {
    console.warn("Supabase admin load failed:", e);
    return isDev ? getTestBySlugLocal(slug) : null;
  }
}
