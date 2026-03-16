import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { buildDisplayName, buildNormalizedFullName, formatHumanNamePart } from "@/lib/nameAuth";

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

  if (!firstName || !lastName) {
    return res.status(400).json({ ok: false, error: "Укажите имя и фамилию." });
  }
  if (password.length < 8) {
    return res.status(400).json({ ok: false, error: "Пароль должен быть не короче 8 символов." });
  }

  const displayName = buildDisplayName(firstName, lastName);
  const normalizedName = buildNormalizedFullName(firstName, lastName);
  const internalEmail = `user.${randomUUID().replace(/-/g, "")}@name-login.local`;

  const supabaseAdmin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const supabaseAnon = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: existing, error: existingError } = await (supabaseAdmin as any)
    .from("auth_name_logins")
    .select("user_id")
    .eq("normalized_name", normalizedName)
    .maybeSingle();

  if (existingError) {
    if (/auth_name_logins/i.test(existingError.message || "")) {
      return res.status(400).json({
        ok: false,
        error: "В базе нет таблицы auth_name_logins. Выполните SQL из supabase/auth_name_logins.sql и повторите.",
      });
    }
    return res.status(500).json({ ok: false, error: existingError.message });
  }

  if (existing?.user_id) {
    return res.status(409).json({
      ok: false,
      error: "Пользователь с таким именем и фамилией уже зарегистрирован. Войдите в аккаунт или используйте регистрацию по почте.",
    });
  }

  const createRes = await supabaseAdmin.auth.admin.createUser({
    email: internalEmail,
    password,
    email_confirm: true,
    user_metadata: {
      role: "participant",
      auth_kind: "name",
      first_name: firstName,
      last_name: lastName,
      display_name: displayName,
      internal_auth_email: internalEmail,
    },
    app_metadata: { role: "participant", auth_kind: "name" },
  });

  if (createRes.error || !createRes.data.user) {
    return res.status(400).json({ ok: false, error: createRes.error?.message || "Не удалось создать аккаунт" });
  }

  const userId = createRes.data.user.id;

  const { error: insertError } = await (supabaseAdmin as any).from("auth_name_logins").insert({
    user_id: userId,
    normalized_name: normalizedName,
    display_name: displayName,
    email: internalEmail,
  });

  if (insertError) {
    await supabaseAdmin.auth.admin.deleteUser(userId).catch(() => null);
    if (/duplicate key|unique/i.test(insertError.message || "")) {
      return res.status(409).json({
        ok: false,
        error: "Пользователь с таким именем и фамилией уже зарегистрирован. Войдите в аккаунт или используйте регистрацию по почте.",
      });
    }
    if (/auth_name_logins/i.test(insertError.message || "")) {
      return res.status(400).json({
        ok: false,
        error: "В базе нет таблицы auth_name_logins. Выполните SQL из supabase/auth_name_logins.sql и повторите.",
      });
    }
    return res.status(500).json({ ok: false, error: insertError.message });
  }

  const signInRes = await supabaseAnon.auth.signInWithPassword({ email: internalEmail, password });
  if (signInRes.error || !signInRes.data.session) {
    return res.status(200).json({
      ok: true,
      created: true,
      login_required: true,
      message: "Аккаунт создан. Теперь войдите по имени, фамилии и паролю.",
    });
  }

  return res.status(200).json({
    ok: true,
    session: signInRes.data.session,
    user: signInRes.data.user,
    display_name: displayName,
  });
}
