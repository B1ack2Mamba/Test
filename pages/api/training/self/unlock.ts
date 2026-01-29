import type { NextApiRequest, NextApiResponse } from "next";
import { requireUser } from "@/lib/serverAuth";

const DEFAULT_PRICE_RUB = 5000;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const auth = await requireUser(req, res);
  if (!auth) return;
  const { user, supabaseAdmin } = auth;

  const { attempt_id } = (req.body || {}) as any;
  const attemptId = String(attempt_id || "").trim();
  if (!attemptId) return res.status(400).json({ ok: false, error: "attempt_id is required" });

  const { data: attempt, error: aErr } = await supabaseAdmin
    .from("training_attempts")
    .select("id,user_id,test_slug,result")
    .eq("id", attemptId)
    .maybeSingle();

  if (aErr || !attempt) return res.status(404).json({ ok: false, error: "Attempt not found" });
  if (attempt.user_id !== user.id) return res.status(403).json({ ok: false, error: "Forbidden" });

  // Already unlocked?
  const { data: unlocked } = await supabaseAdmin
    .from("training_self_unlocks")
    .select("paid_kopeks,unlocked_at")
    .eq("attempt_id", attemptId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (unlocked) {
    return res.status(200).json({ ok: true, already: true, result: attempt.result });
  }

  const priceRub = Number(process.env.TRAINING_SELF_REVEAL_PRICE_RUB || DEFAULT_PRICE_RUB);
  const priceKopeks = Math.round(priceRub * 100);

  const ref = `training_self_unlock:${attempt.test_slug}:${attemptId}:${Date.now()}`;

  const { data: debitData, error: debitErr } = await supabaseAdmin.rpc("debit_wallet", {
    p_user_id: user.id,
    p_amount_kopeks: priceKopeks,
    p_reason: "training_self_unlock",
    p_ref: ref,
  });

  if (debitErr) return res.status(400).json({ ok: false, error: debitErr.message || "Failed to charge wallet" });

  await supabaseAdmin.from("training_self_unlocks").insert({
    attempt_id: attemptId,
    user_id: user.id,
    paid_kopeks: priceKopeks,
  });

  return res.status(200).json({
    ok: true,
    already: false,
    result: attempt.result,
    balance_kopeks: Number(debitData?.balance_kopeks ?? 0),
    charged_kopeks: Number(debitData?.charged_kopeks ?? priceKopeks),
  });
}
