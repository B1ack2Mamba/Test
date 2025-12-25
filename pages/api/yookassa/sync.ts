import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";

type Resp =
  | { ok: true; checked: number; credited: number; updated: number }
  | { ok: false; error: string };

function getBearer(req: NextApiRequest): string | null {
  const h = req.headers.authorization;
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m?.[1] ?? null;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<Resp>
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

  const token = getBearer(req);
  if (!token) {
    return res.status(401).json({ ok: false, error: "Missing Authorization Bearer token" });
  }

  const supabaseAdmin = createClient(url, serviceKey);

  // Identify the user by session token
  const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
  if (userErr || !userData?.user) {
    return res.status(401).json({ ok: false, error: "Invalid session" });
  }

  const userId = userData.user.id;

  // Get up to 20 non-paid topups for this user
  const topups = await supabaseAdmin
    .from("yookassa_topups")
    .select("payment_id,status")
    .eq("user_id", userId)
    .neq("status", "paid")
    .order("created_at", { ascending: false })
    .limit(20);

  // If table doesn't exist or RLS blocks, just return ok (no sync)
  if (topups.error) {
    return res.status(200).json({ ok: true, checked: 0, credited: 0, updated: 0 });
  }

  const list = topups.data ?? [];
  if (list.length === 0) {
    return res.status(200).json({ ok: true, checked: 0, credited: 0, updated: 0 });
  }

  const auth = Buffer.from(`${shopId}:${secretKey}`).toString("base64");

  let checked = 0;
  let credited = 0;
  let updated = 0;

  for (const row of list) {
    const paymentId = row.payment_id as string;
    if (!paymentId) continue;

    checked++;

    const checkResp = await fetch(`https://api.yookassa.ru/v3/payments/${paymentId}`, {
      method: "GET",
      headers: { authorization: `Basic ${auth}` },
    });

    const raw = await checkResp.text();
    let payment: any = null;
    try {
      payment = JSON.parse(raw);
    } catch {
      // ignore
    }

    if (!checkResp.ok || !payment) {
      // keep pending, continue
      continue;
    }

    const status: string | undefined = payment?.status;
    const amountStr: string | undefined = payment?.amount?.value;
    const metaUser: string | undefined = payment?.metadata?.user_id;

    // If payment belongs to a different user for any reason, don't touch
    if (metaUser && metaUser !== userId) continue;

    // Update status in table for visibility
    if (status && status !== row.status) {
      await supabaseAdmin.from("yookassa_topups").update({ status }).eq("payment_id", paymentId);
      updated++;
    }

    if (status !== "succeeded") continue;

    const amountRub = Number(amountStr);
    if (!Number.isFinite(amountRub) || amountRub <= 0) continue;

    const amountKopeks = Math.round(amountRub * 100);

    // Mark paid
    await supabaseAdmin
      .from("yookassa_topups")
      .upsert({
        payment_id: paymentId,
        user_id: userId,
        amount_kopeks: amountKopeks,
        status: "paid",
        paid_at: new Date().toISOString(),
      });

    // Credit wallet idempotently
    const { error } = await supabaseAdmin.rpc("credit_wallet", {
      p_user_id: userId,
      p_amount_kopeks: amountKopeks,
      p_reason: "topup",
      p_ref: `yookassa:${paymentId}`,
    });

    if (!error) {
      credited++;
    } else {
      const msg = error.message || "credit_wallet error";
      if (/duplicate key|unique constraint/i.test(msg)) {
        // Already credited
      } else {
        // Leave it: next sync/webhook will retry
      }
    }
  }

  return res.status(200).json({ ok: true, checked, credited, updated });
}
