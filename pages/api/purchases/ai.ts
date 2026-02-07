import type { NextApiRequest, NextApiResponse } from "next";
import { requireUser } from "@/lib/serverAuth";
import { PAYMENTS_ENABLED } from "@/lib/payments";
import { aiInterpretation } from "@/lib/aiInterpretation";

type Body = {
  test_slug?: string;
  test_title?: string;
  op_id?: string;
  result?: any;
};

type OkResp = { ok: true; text: string; balance_kopeks: number; charged_kopeks: number };
type ErrResp = { ok: false; error: string };

const DEFAULT_PRICE_RUB = 0; // UI hides pricing by default. Configure on server if you re-enable billing.

export default async function handler(req: NextApiRequest, res: NextApiResponse<OkResp | ErrResp>) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const auth = await requireUser(req, res);
  if (!auth) return;

  const body = (req.body ?? {}) as Body;
  const testSlug = String(body.test_slug || "").trim();
  const testTitle = String(body.test_title || "").trim();
  if (!testSlug) return res.status(400).json({ ok: false, error: "test_slug is required" });

  const ref = body.op_id ? `ai:${testSlug}:${body.op_id}` : `ai:${testSlug}:${Date.now()}`;

  // Price is driven by the test record in DB (RUB → kopeks). If not present, fallback.
  const { data: testRow } = await auth.supabaseAdmin
    .from("tests")
    .select("details_price_rub,is_published")
    .eq("slug", testSlug)
    .maybeSingle();

  if (testRow && !testRow.is_published) {
    return res.status(403).json({ ok: false, error: "Test is not published" });
  }

  const priceRub = Number(testRow?.details_price_rub ?? DEFAULT_PRICE_RUB);
  const priceKopeks = Number.isFinite(priceRub) ? Math.max(0, Math.round(priceRub * 100)) : 0;

  let balanceKopeks = 0;
  let chargedKopeks = 0;

  if (PAYMENTS_ENABLED && priceKopeks > 0) {
    const { data: debitData, error: debitErr } = await auth.supabaseAdmin.rpc("debit_wallet", {
      p_user_id: auth.user.id,
      p_amount_kopeks: priceKopeks,
      p_reason: "ai_interpretation",
      p_ref: ref,
    });

    if (debitErr) {
      return res.status(400).json({ ok: false, error: debitErr.message || "Failed to charge wallet" });
    }

    balanceKopeks = Number(debitData?.balance_kopeks ?? 0);
    chargedKopeks = Number(debitData?.charged_kopeks ?? priceKopeks);
  } else {
    const { data: w } = await auth.supabaseAdmin
      .from("wallets")
      .select("balance_kopeks")
      .eq("user_id", auth.user.id)
      .maybeSingle();
    balanceKopeks = Number(w?.balance_kopeks ?? 0);
  }

  try {
    const text = await aiInterpretation({
      test_slug: testSlug,
      test_title: testTitle,
      result: body.result,
    });

    return res.status(200).json({ ok: true, text: String(text || ""), balance_kopeks: balanceKopeks, charged_kopeks: chargedKopeks });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "AI failed" });
  }
}
