import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";

type ErrResp = { ok: false; error: string };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<any | ErrResp>
) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return res
      .status(500)
      .json({ ok: false, error: "Server env missing: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY" });
  }

  const shopId = process.env.YOOKASSA_SHOP_ID;
  const secretKey = process.env.YOOKASSA_SECRET_KEY;
  if (!shopId || !secretKey) {
    return res
      .status(500)
      .json({ ok: false, error: "YooKassa is not configured: set YOOKASSA_SHOP_ID, YOOKASSA_SECRET_KEY" });
  }

  const obj = req.body?.object;
  const paymentId: string | undefined = obj?.id;
  if (!paymentId) {
    // Acknowledge malformed payloads to avoid endless retries.
    return res.status(200).json({ ok: true });
  }

  // Verify payment status by fetching it from YooKassa API (simple safety check).
  const auth = Buffer.from(`${shopId}:${secretKey}`).toString("base64");
  const checkResp = await fetch(`https://api.yookassa.ru/v3/payments/${paymentId}`, {
    method: "GET",
    headers: {
      authorization: `Basic ${auth}`,
    },
  });

  const raw = await checkResp.text();
  let payment: any = null;
  try {
    payment = JSON.parse(raw);
  } catch {
    // ignore
  }

  if (!checkResp.ok || !payment) {
    // Let YooKassa retry later.
    return res
      .status(500)
      .json({ ok: false, error: payment?.description || raw || "Failed to verify payment" });
  }

  const status: string | undefined = payment?.status;
  const userId: string | undefined = payment?.metadata?.user_id;
  const amountStr: string | undefined = payment?.amount?.value;

  // Only credit on succeeded.
  if (status !== "succeeded") {
    if (userId && amountStr) {
      const supabaseAdmin = createClient(url, serviceKey);
      await supabaseAdmin.from("yookassa_topups").upsert({
        payment_id: paymentId,
        user_id: userId,
        amount_kopeks: Math.round(Number(amountStr) * 100),
        status: status || "unknown",
      });
    }

    return res.status(200).json({ ok: true, ignored: true, status });
  }

  if (!userId || !amountStr) {
    return res
      .status(200)
      .json({ ok: true, ignored: true, reason: "missing metadata.user_id or amount" });
  }

  const amountRub = Number(amountStr);
  if (!Number.isFinite(amountRub) || amountRub <= 0) {
    return res.status(200).json({ ok: true, ignored: true, reason: "bad amount" });
  }

  const amountKopeks = Math.round(amountRub * 100);

  const supabaseAdmin = createClient(url, serviceKey);

  // Mark payment paid (for visibility)
  await supabaseAdmin.from("yookassa_topups").upsert({
    payment_id: paymentId,
    user_id: userId,
    amount_kopeks: amountKopeks,
    status: "paid",
    paid_at: new Date().toISOString(),
  });

  // Credit wallet idempotently using unique (user_id, ref) in wallet_ledger.
  const { error } = await supabaseAdmin.rpc("credit_wallet", {
    p_user_id: userId,
    p_amount_kopeks: amountKopeks,
    p_reason: "topup",
    p_ref: `yookassa:${paymentId}`,
  });

  if (error) {
    const msg = error.message || "credit_wallet error";
    // If it's a duplicate credit (replayed webhook), treat as OK.
    if (/duplicate key|unique constraint/i.test(msg)) {
      return res.status(200).json({ ok: true, already: true });
    }
    // Let YooKassa retry.
    return res.status(500).json({ ok: false, error: msg });
  }

  return res.status(200).json({ ok: true, credited: true });
}
