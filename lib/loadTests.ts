import fs from "fs";
import path from "path";
import type { AnyTest } from "@/lib/testTypes";
import { createSupabaseClient, getSupabaseEnv } from "@/lib/supabaseClient";

const TESTS_DIR = path.join(process.cwd(), "data", "tests");

function getAllTestsLocal(): AnyTest[] {
  if (!fs.existsSync(TESTS_DIR)) return [];
  const files = fs.readdirSync(TESTS_DIR).filter((f) => f.endsWith(".json"));
  const tests = files.map((file) => {
    const raw = fs.readFileSync(path.join(TESTS_DIR, file), "utf-8");
    const parsed = JSON.parse(raw) as any;
    const { interpretation: _i, ...t } = parsed;
    const test = t as AnyTest;
    const price = test.pricing?.interpretation_rub ?? 0;
    const details = test.pricing?.details_rub ?? 49;
    return {
      ...test,
      pricing: { ...test.pricing, interpretation_rub: price, details_rub: details },
      has_interpretation: price > 0,
    };
  });
  return tests.filter((t) => t.slug !== "16pf").sort((a, b) => a.title.localeCompare(b.title, "ru"));
}

function getTestBySlugLocal(slug: string): AnyTest | null {
  if (slug === "16pf") return null;
  const filePath = path.join(TESTS_DIR, `${slug}.json`);
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, "utf-8");
  const parsed = JSON.parse(raw) as any;
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

/**
 * Load all tests.
 *
 * Priority:
 * 1) Supabase table `public.tests` (column `json`) — production source of truth.
 * 2) Local folder `data/tests/*.json` — ONLY if Supabase env is not configured (dev-only).
 */
export async function getAllTests(): Promise<AnyTest[]> {
  const env = getSupabaseEnv();
  const isDev = process.env.NODE_ENV !== "production";
  const local = getAllTestsLocal();

  if (!env) return local;

  try {
    const supabase = createSupabaseClient();
    const { data, error } = await supabase
      .from("tests")
      .select("json, price_rub")
      .eq("is_published", true);

    if (error) throw error;

    const dbTests = (data ?? [])
      .map((r: any) => {
        const raw = r?.json as any;
        if (!raw) return null;
        const { interpretation: _i, ...t } = raw;
        const test = t as AnyTest;
        const price = typeof r?.price_rub === "number" ? r.price_rub : test.pricing?.interpretation_rub ?? 0;
        const details = test.pricing?.details_rub ?? 49;
        return {
          ...test,
          pricing: { ...test.pricing, interpretation_rub: price, details_rub: details },
          has_interpretation: price > 0,
        } as AnyTest;
      })
      .filter(Boolean)
      .filter((t: AnyTest) => t.slug !== "16pf") as AnyTest[];

    // Production behavior: DB is source of truth.
    if (!isDev) {
      if (dbTests.length === 0) return [];
      return dbTests.sort((a, b) => a.title.localeCompare(b.title, "ru"));
    }

    // Dev behavior (next dev): merge DB + local to avoid "missing tests" when DB isn't fully seeded.
    // For complex 16PF forms we prefer LOCAL JSON in dev to avoid partial/old DB seeds breaking scoring.
    const map = new Map<string, AnyTest>();
    for (const t of local) {
      if (t?.slug && t.slug !== "16pf") map.set(t.slug, t);
    }
    for (const t of dbTests) {
      if (!t?.slug || t.slug === "16pf") continue;
      const s = String(t.slug);
      // Do NOT override local 16PF forms in dev.
      if ((s === "16pf-a" || s === "16pf-b") && map.has(s)) continue;
      map.set(s, t);
    }

const merged = Array.from(map.values());
    return merged.sort((a, b) => a.title.localeCompare(b.title, "ru"));
  } catch (e) {
    console.warn("Supabase load failed:", e);
    // Dev fallback: local tests keep working even if Supabase is configured but not available.
    if (process.env.NODE_ENV !== "production") return local;
    // Prod: do NOT expose local fallback.
    return [];
  }
}

/**
 * Load one test by slug.
 */
export async function getTestBySlug(slug: string): Promise<AnyTest | null> {
  if (slug === "16pf") return null;

  const env = getSupabaseEnv();
  const isDev = process.env.NODE_ENV !== "production";
  const local = getTestBySlugLocal(slug);

  // Dev preference: always use LOCAL JSON for 16PF forms to keep scoring stable while DB is being tuned/seeded.
  if (isDev && (slug === "16pf-a" || slug === "16pf-b") && local) return local;

  if (!env) return local;

  try {
    const supabase = createSupabaseClient();
    const { data, error } = await supabase
      .from("tests")
      .select("json, price_rub")
      .eq("slug", slug)
      .single();

    if (error) {
      // Dev fallback: missing in DB -> take local.
      return isDev ? local : null;
    }

    const raw = (data as any)?.json as any;
    if (!raw) return isDev ? local : null;

    const { interpretation: _i, ...t } = raw;
    const test = t as AnyTest;
    const price =
      typeof (data as any)?.price_rub === "number" ? (data as any).price_rub : test.pricing?.interpretation_rub ?? 0;
    const details = test.pricing?.details_rub ?? 49;

    return {
      ...test,
      pricing: { ...test.pricing, interpretation_rub: price, details_rub: details },
      has_interpretation: price > 0,
    };
  } catch (e) {
    console.warn("Supabase load failed:", e);
    return isDev ? local : null;
  }
}
