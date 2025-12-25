import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

type Body = {
  amount_rub?: number;
};

type OkResp = {
  ok: true;
  payment_id: string;
  confirmation_url: string;
};

type ErrResp = { ok: false; error: string };

function getBearer(req: NextApiRequest): string | null {
  const h = req.headers.authorization;
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m?.[1] ?? null;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<OkResp | ErrResp>
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
  const appBaseUrl = process.env.APP_BASE_URL;
  if (!shopId || !secretKey || !appBaseUrl) {
    return res
      .status(500)
      .json({ ok: false, error: "YooKassa is not configured: set YOOKASSA_SHOP_ID, YOOKASSA_SECRET_KEY, APP_BASE_URL" });
  }

  const token = getBearer(req);
  if (!token) {
    return res.status(401).json({ ok: false, error: "Missing Authorization Bearer token" });
  }

  const body = (req.body ?? {}) as Body;
  const rub = Math.floor(Number(body.amount_rub ?? 0));
  if (!Number.isFinite(rub) || rub < 1) {
    return res.status(400).json({ ok: false, error: "amount_rub must be >= 1" });
  }
  if (rub > 500000) {
    return res.status(400).json({ ok: false, error: "amount_rub is too large" });
  }

  const amountValue = (rub).toFixed(2); // rubles
  const idempotenceKey = crypto.randomUUID();

  // Validate user via Supabase
  const supabaseAdmin = createClient(url, serviceKey);
  const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
  if (userErr || !userData?.user) {
    return res.status(401).json({ ok: false, error: "Invalid session" });
  }
  const userId = userData.user.id;

  // Create YooKassa payment (SBP)
  const auth = Buffer.from(`${shopId}:${secretKey}`).toString("base64");
  const returnUrl = `${appBaseUrl.replace(/\/$/, "")}/wallet?paid=1`;

  const createResp = await fetch("https://api.yookassa.ru/v3/payments", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Basic ${auth}`,
      "Idempotence-Key": idempotenceKey,
    },
    body: JSON.stringify({
      amount: { value: amountValue, currency: "RUB" },
      capture: true,
      confirmation: { type: "redirect", return_url: returnUrl },
      payment_method_data: { type: "sbp" },
      description: "Пополнение внутреннего баланса",
      metadata: {
        user_id: userId,
        kind: "wallet_topup",
      },
    }),
  });

  const raw = await createResp.text();
  let json: any = null;
  try {
    json = JSON.parse(raw);
  } catch {
    // ignore
  }

  if (!createResp.ok) {
    const msg = json?.description || json?.message || raw || "YooKassa error";
    return res.status(502).json({ ok: false, error: msg });
  }

  const paymentId: string | undefined = json?.id;
  const confirmationUrl: string | undefined = json?.confirmation?.confirmation_url;

  if (!paymentId || !confirmationUrl) {
    return res.status(502).json({ ok: false, error: "YooKassa response missing id/confirmation_url" });
  }

  // Persist pending topup (optional)
  await supabaseAdmin
    .from("yookassa_topups")
    .upsert({
      payment_id: paymentId,
      user_id: userId,
      amount_kopeks: rub * 100,
      status: "pending",
    });

  return res.status(200).json({ ok: true, payment_id: paymentId, confirmation_url: confirmationUrl });
}
