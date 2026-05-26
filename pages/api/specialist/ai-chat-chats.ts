import type { NextApiRequest, NextApiResponse } from "next";
import { requireUser } from "@/lib/serverAuth";
import { isSpecialistUser } from "@/lib/specialist";
import { setNoStore } from "@/lib/apiHardening";

const CHAT_SELECT = "id,provider,title,last_provider,last_model,last_user_message,transcript,created_at,updated_at";

function fallbackTitle(input: any) {
  const text = String(input || "").replace(/\s+/g, " ").trim();
  if (!text) return "Новый чат";
  return text.length > 64 ? `${text.slice(0, 64).trim()}...` : text;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  setNoStore(res);

  const auth = await requireUser(req, res, { requireEmail: true });
  if (!auth) return;
  if (!isSpecialistUser(auth.user)) return res.status(403).json({ ok: false, error: "Forbidden" });

  if (req.method === "GET") {
    const provider = String(req.query.provider || "").trim();
    let query = auth.supabaseAdmin
      .from("specialist_ai_chats")
      .select(CHAT_SELECT)
      .eq("specialist_user_id", auth.user.id)
      .order("updated_at", { ascending: false })
      .limit(100);

    if (provider === "openai" || provider === "deepseek") {
      query = query.eq("provider", provider);
    }

    const { data, error } = await query;

    if (error) {
      return res.status(500).json({
        ok: false,
        error: /specialist_ai_chats/i.test(error.message || "")
          ? "В базе нет таблицы specialist_ai_chats. Выполните SQL миграцию supabase/specialist_ai_chat_tasks.sql."
          : error.message,
      });
    }

    return res.status(200).json({ ok: true, chats: data || [] });
  }

  if (req.method === "POST") {
    const provider = String(req.body?.provider || "").trim() === "openai" ? "openai" : "deepseek";
    const title = fallbackTitle(req.body?.title);
    const { data, error } = await auth.supabaseAdmin
      .from("specialist_ai_chats")
      .insert({
        specialist_user_id: auth.user.id,
        provider,
        last_provider: provider,
        title,
        updated_at: new Date().toISOString(),
      })
      .select(CHAT_SELECT)
      .single();

    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.status(200).json({ ok: true, chat: data });
  }

  if (req.method === "PATCH") {
    const chatId = String(req.body?.chat_id || req.query.chat_id || "").trim();
    const title = fallbackTitle(req.body?.title);
    if (!chatId) return res.status(400).json({ ok: false, error: "chat_id is required" });

    const { data, error } = await auth.supabaseAdmin
      .from("specialist_ai_chats")
      .update({ title, updated_at: new Date().toISOString() })
      .eq("id", chatId)
      .eq("specialist_user_id", auth.user.id)
      .select(CHAT_SELECT)
      .maybeSingle();

    if (error) return res.status(500).json({ ok: false, error: error.message });
    if (!data) return res.status(404).json({ ok: false, error: "Chat not found" });
    return res.status(200).json({ ok: true, chat: data });
  }

  if (req.method === "DELETE") {
    const chatId = String(req.body?.chat_id || req.query.chat_id || "").trim();
    if (!chatId) return res.status(400).json({ ok: false, error: "chat_id is required" });

    const { error } = await auth.supabaseAdmin
      .from("specialist_ai_chats")
      .delete()
      .eq("id", chatId)
      .eq("specialist_user_id", auth.user.id);

    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ ok: false, error: "Method not allowed" });
}
