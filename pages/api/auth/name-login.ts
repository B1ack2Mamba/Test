import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";
import { buildNormalizedFullName, formatHumanNamePart } from "@/lib/nameAuth";

type Body = {
  first_name?: string;
  last_name?: string;
  password?: string;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !anonKey || !serviceKey) {
    return res.status(500).json({
      ok: false,
      error: "Server env missing: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY",
    });
  }

  const body: Body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  const firstName = formatHumanNamePart(body.first_name || "");
  const lastName = formatHumanNamePart(body.last_name || "");
  const password = String(body.password || "");

  if (!firstName || !lastName || !password) {
    return res.status(400).json({ ok: false, error: "Укажите имя, фамилию и пароль." });
  }

  const normalizedName = buildNormalizedFullName(firstName, lastName);
  const supabaseAdmin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const supabaseAnon = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data, error } = await (supabaseAdmin as any)
    .from("auth_name_logins")
    .select("email,display_name")
    .eq("normalized_name", normalizedName)
    .maybeSingle();

  if (error) {
    if (/auth_name_logins/i.test(error.message || "")) {
      return res.status(400).json({
        ok: false,
        error: "В базе нет таблицы auth_name_logins. Выполните SQL из supabase/auth_name_logins.sql и повторите.",
      });
    }
    return res.status(500).json({ ok: false, error: error.message });
  }

  if (!data?.email) {
    return res.status(404).json({ ok: false, error: "Пользователь не найден. Сначала зарегистрируйтесь." });
  }

  const signInRes = await supabaseAnon.auth.signInWithPassword({ email: String(data.email), password });
  if (signInRes.error || !signInRes.data.session) {
    return res.status(401).json({ ok: false, error: signInRes.error?.message || "Неверный пароль" });
  }

  return res.status(200).json({
    ok: true,
    session: signInRes.data.session,
    user: signInRes.data.user,
    display_name: data.display_name,
  });
}
