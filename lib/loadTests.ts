import fs from "fs";
import path from "path";
import type { ForcedPairTestV1 } from "@/lib/testTypes";
import { createSupabaseClient, getSupabaseEnv } from "@/lib/supabaseClient";

const TESTS_DIR = path.join(process.cwd(), "data", "tests");

function getAllTestsLocal(): ForcedPairTestV1[] {
  if (!fs.existsSync(TESTS_DIR)) return [];
  const files = fs.readdirSync(TESTS_DIR).filter((f) => f.endsWith(".json"));
  const tests = files.map((file) => {
    const raw = fs.readFileSync(path.join(TESTS_DIR, file), "utf-8");
    const parsed = JSON.parse(raw) as any;
    const { interpretation: _i, ...t } = parsed;
    const test = t as ForcedPairTestV1;
    const price = test.pricing?.interpretation_rub ?? 0;
    return { ...test, pricing: { ...test.pricing, interpretation_rub: price }, has_interpretation: price > 0 };
  });
  return tests.sort((a, b) => a.title.localeCompare(b.title, "ru"));
}

function getTestBySlugLocal(slug: string): ForcedPairTestV1 | null {
  const filePath = path.join(TESTS_DIR, `${slug}.json`);
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, "utf-8");
  const parsed = JSON.parse(raw) as any;
  const { interpretation: _i, ...t } = parsed;
  const test = t as ForcedPairTestV1;
  const price = test.pricing?.interpretation_rub ?? 0;
  return { ...test, pricing: { ...test.pricing, interpretation_rub: price }, has_interpretation: price > 0 };
}

/**
 * Load all tests.
 *
 * Priority:
 * 1) Supabase table `public.tests` (column `json`) — production source of truth.
 * 2) Local folder `data/tests/*.json` — ONLY if Supabase env is not configured (dev-only).
 */
export async function getAllTests(): Promise<ForcedPairTestV1[]> {
  const env = getSupabaseEnv();
  if (!env) return getAllTestsLocal();

  try {
    const supabase = createSupabaseClient();
    const { data, error } = await supabase
      .from("tests")
      .select("json, price_rub")
      .eq("is_published", true);

    if (error) throw error;

    const tests = (data ?? [])
      .map((r: any) => {
        const raw = r?.json as any;
        if (!raw) return null;
        const { interpretation: _i, ...t } = raw;
        const test = t as ForcedPairTestV1;
        const price = typeof r?.price_rub === "number" ? r.price_rub : test.pricing?.interpretation_rub ?? 0;
        return { ...test, pricing: { ...test.pricing, interpretation_rub: price }, has_interpretation: price > 0 } as ForcedPairTestV1;
      })
      .filter(Boolean) as ForcedPairTestV1[];

    // If DB is empty, return empty list (production behavior).
    if (tests.length === 0) return [];

    return tests.sort((a, b) => a.title.localeCompare(b.title, "ru"));
  } catch (e) {
    console.warn("Supabase load failed:", e);
    // If Supabase is configured but failing, do NOT expose local fallback in prod.
    return [];
  }
}

/**
 * Load one test by slug.
 */
export async function getTestBySlug(slug: string): Promise<ForcedPairTestV1 | null> {
  const env = getSupabaseEnv();
  if (!env) return getTestBySlugLocal(slug);

  try {
    const supabase = createSupabaseClient();
    const { data, error } = await supabase
      .from("tests")
      .select("json, price_rub")
      .eq("slug", slug)
      .single();

    if (error) return null;

    const raw = (data as any)?.json as any;
    if (!raw) return null;
    const { interpretation: _i, ...t } = raw;
    const test = t as ForcedPairTestV1;
    const price = typeof (data as any)?.price_rub === "number" ? (data as any).price_rub : test.pricing?.interpretation_rub ?? 0;
    return { ...test, pricing: { ...test.pricing, interpretation_rub: price }, has_interpretation: price > 0 };
  } catch (e) {
    console.warn("Supabase load failed:", e);
    return null;
  }
}
