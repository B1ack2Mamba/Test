import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";
import { assertAdmin } from "@/lib/serverAdmin";

type Body = {
  user_id?: string;
  // Either amount_kopeks (preferred) or amount_rub
  amount_kopeks?: number;
  amount_rub?: number;
  reason?: string;
  ref?: string;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  // Only the configured admin email can call manual credit endpoint.
  const admin = await assertAdmin(req, res);
  if (!admin) return;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return res.status(500).json({ ok: false, error: "Server env missing: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY" });
  }

  const body = (req.body ?? {}) as Body;
  const userId = body.user_id;
  if (!userId) {
    return res.status(400).json({ ok: false, error: "user_id is required" });
  }

  const amountKopeks =
    typeof body.amount_kopeks === "number"
      ? Math.trunc(body.amount_kopeks)
      : typeof body.amount_rub === "number"
        ? Math.trunc(body.amount_rub * 100)
        : 0;

  if (!Number.isFinite(amountKopeks) || amountKopeks <= 0) {
    return res.status(400).json({ ok: false, error: "amount_kopeks (or amount_rub) must be a positive number" });
  }

  const supabase = createClient(url, serviceKey);
  const { data, error } = await supabase.rpc("credit_wallet", {
    p_user_id: userId,
    p_amount_kopeks: amountKopeks,
    p_reason: body.reason ?? "topup",
    p_ref: body.ref ?? null,
  });

  if (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }

  return res.status(200).json({ ok: true, data });
}
