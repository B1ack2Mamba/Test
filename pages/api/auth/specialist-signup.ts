import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";

type Body = {
  email?: string;
  password?: string;
  code?: string;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const expectedCode = process.env.SPECIALIST_SIGNUP_CODE;

  if (!url || !serviceKey) {
    return res
      .status(500)
      .json({ ok: false, error: "Server env missing: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY" });
  }
  if (!expectedCode) {
    return res.status(500).json({ ok: false, error: "Server env missing: SPECIALIST_SIGNUP_CODE" });
  }

  const body: Body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  const email = (body.email || "").trim().toLowerCase();
  const password = body.password || "";
  const code = (body.code || "").trim();

  if (!email || !password) return res.status(400).json({ ok: false, error: "Missing email/password" });
  if (code !== expectedCode) return res.status(403).json({ ok: false, error: "Invalid specialist code" });

  const supabaseAdmin = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { role: "specialist" },
    app_metadata: { role: "specialist" },
  });

  if (error) {
    return res.status(400).json({ ok: false, error: error.message });
  }

  return res.status(200).json({ ok: true, userId: data.user?.id });
}
