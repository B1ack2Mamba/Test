import type { NextApiRequest, NextApiResponse } from "next";
import { requireUser } from "@/lib/serverAuth";

type Body = {
  test_slug?: string;
  op_id?: string;
};

type OkResp = { ok: true; content: any; balance_kopeks: number; charged_kopeks: number };
type ErrResp = { ok: false; error: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse<OkResp | ErrResp>) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const auth = await requireUser(req, res);
  if (!auth) return;

  const body = (req.body ?? {}) as Body;
  const testSlug = String(body.test_slug || "").trim();
  if (!testSlug) return res.status(400).json({ ok: false, error: "test_slug is required" });

  const ref = body.op_id ? `author:${testSlug}:${body.op_id}` : `author:${testSlug}:${Date.now()}`;

  // Price is driven by the test record in DB (RUB → kopeks)
  const { data: testRow, error: testErr } = await auth.supabaseAdmin
    .from("tests")
    .select("price_rub,is_published")
    .eq("slug", testSlug)
    .single();

  if (testErr || !testRow) {
    return res.status(404).json({ ok: false, error: testErr?.message || "Test not found" });
  }
  if (!testRow.is_published) {
    return res.status(403).json({ ok: false, error: "Test is not published" });
  }

  const priceRub = Number(testRow.price_rub ?? 0);
  if (!Number.isFinite(priceRub) || priceRub <= 0) {
    return res.status(400).json({ ok: false, error: "This test does not require payment" });
  }
  const priceKopeks = Math.round(priceRub * 100);

  // Charge wallet
  const { data: debitData, error: debitErr } = await auth.supabaseAdmin.rpc("debit_wallet", {
    p_user_id: auth.user.id,
    p_amount_kopeks: priceKopeks,
    p_reason: "author_interpretation",
    p_ref: ref,
  });

  if (debitErr) {
    return res.status(400).json({ ok: false, error: debitErr.message || "Failed to charge wallet" });
  }

  // Fetch protected interpretation content (server-side)
  const { data: row, error: selErr } = await auth.supabaseAdmin
    .from("test_interpretations")
    .select("content")
    .eq("test_slug", testSlug)
    .single();

  if (selErr || !row) {
    return res.status(404).json({ ok: false, error: selErr?.message || "Interpretation not found" });
  }

  const balance = Number(debitData?.balance_kopeks ?? 0);
  const charged = Number(debitData?.charged_kopeks ?? priceKopeks);
  return res.status(200).json({ ok: true, content: row.content, balance_kopeks: balance, charged_kopeks: charged });
}
