import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";
import { ForcedPairTestSchema } from "@/lib/testSchema";
import { assertAdmin } from "@/lib/serverAdmin";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  // Only the configured admin email can upload tests.
  const admin = await assertAdmin(req, res);
  if (!admin) return;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return res.status(500).json({
      ok: false,
      error:
        "Missing env NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Add SUPABASE_SERVICE_ROLE_KEY to .env.local (server-only).",
    });
  }

  try {
    const rawTest = req.body?.test ?? req.body;
    const test = ForcedPairTestSchema.parse(rawTest) as any;

    const interpretation = test.interpretation;
    const publicTest = { ...test };
    delete publicTest.interpretation;
    // Keep only public fields in tests.json

    const supabase = createClient(url, serviceKey);

    // Default rule: interpretation costs 99 RUB, but only if interpretation content exists.
    // (Prevents charging users for tests without a real interpretation yet.)
    const DEFAULT_INTERPRETATION_PRICE_RUB = 99;
    const priceRubRaw =
      typeof publicTest?.pricing?.interpretation_rub === "number"
        ? publicTest.pricing.interpretation_rub
        : null;

    const priceRub =
      typeof priceRubRaw === "number"
        ? priceRubRaw
        : interpretation
          ? DEFAULT_INTERPRETATION_PRICE_RUB
          : 0;

    const { error } = await supabase
      .from("tests")
      .upsert(
        {
          slug: test.slug,
          title: test.title,
          description: test.description ?? "",
          type: test.type,
          json: publicTest,
          price_rub: priceRub,
          is_published: true,
        },
        { onConflict: "slug" }
      );

    if (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }

    // Upsert interpretation if provided (stored separately, behind RLS paywall)
    if (interpretation) {
      const { error: iErr } = await supabase
        .from("test_interpretations")
        .upsert({ test_slug: test.slug, content: interpretation }, { onConflict: "test_slug" });
      if (iErr) {
        return res.status(500).json({ ok: false, error: iErr.message });
      }
    }

    return res.status(200).json({ ok: true, slug: test.slug });
  } catch (e: any) {
    return res.status(400).json({ ok: false, error: e?.message ?? "Bad request" });
  }
}
